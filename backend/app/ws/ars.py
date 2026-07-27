"""경량 ARS 제어 채널 — 고객폰·직원콘솔의 "전화 시작/수락/종료" 화면 전환용.

live_stt.py의 완전한 ARS 상태머신(DTMF·drain·orphan-end 등)은 우리 /ws/call과
라우트가 겹쳐 통째로 등록할 수 없다. 이 데모에 필요한 최소 계약만 새로 구현한다:
전화 버튼→call_start, 고객이 #(또는 *)로 발화 종료 신호→intake_complete(박정운
피드백: "전화를 끊었음을 인지할 수 있는 기준" — 침묵·연결끊김 등 암묵적 추정 대신
명시적 키패드 신호로 통일), 직원 수락→agent_connected, 종료→call_end. 프론트 계약은
src/services/arsMobile.ts·arsControl.ts 참고.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

# 소켓이 call_end 없이 그냥 끊겼을 때(와이파이 순단·앱 백그라운드·탭 닫힘) 즉시 종료로
# 치면, 새로고침도 "끊김"이라 통화 복귀 기능을 깨버린다. 그래서 바로 끝내지 않고 이
# 유예 동안 같은 role이 재연결하는지 보고, 못 하면 그때 진짜 종료로 브로드캐스트한다.
# ponytail: 고정 유예(6초)+role당 최신 타이머 1개. 재연결 성공/실패 신호(heartbeat)
# 기반 정교한 판정이 필요해지면 그때 교체.
_DISCONNECT_GRACE_SECONDS = 6.0


@dataclass
class _ArsState:
    active: bool = False
    generation: int = 0
    digits: str = ""
    intake_complete: bool = False
    agent_connected: bool = False
    dtmf_count: int = 0
    final_seq: int = 0
    drained: bool = True
    end_reason: str | None = None
    ended_by: str | None = None


_states: dict[str, _ArsState] = defaultdict(_ArsState)
_clients: dict[str, set[WebSocket]] = defaultdict(set)
_client_roles: dict[WebSocket, str] = {}
_disconnect_timers: dict[str, asyncio.Task] = {}  # f"{call_id}:{role}" -> 대기 중인 종료 타이머


def _payload(state: _ArsState) -> dict:
    return {
        "type": "ars_state",
        "active": state.active,
        "digits": state.digits,
        "intake_complete": state.intake_complete,
        "agent_connected": state.agent_connected,
        "dtmf_count": state.dtmf_count,
        "final_seq": state.final_seq,
        "drained": state.drained,
        "generation": state.generation,
        "end_reason": state.end_reason,
        "ended_by": state.ended_by,
    }


async def _broadcast(call_id: str, message: dict) -> None:
    dead = []
    for ws in list(_clients[call_id]):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients[call_id].discard(ws)


def _role_connected(call_id: str, role: str) -> bool:
    return any(_client_roles.get(ws) == role for ws in _clients[call_id])


def _should_end_after_grace(call_id: str, role: str) -> bool:
    """유예 종료 후 실제로 call_end를 쏴야 하는지: 통화가 아직 active고, 그 role이
    유예 동안 재연결하지 않았을 때만 True (재연결했으면 새로고침 등으로 간주하고 유지)."""
    return _states[call_id].active and not _role_connected(call_id, role)


async def _end_call_after_grace(call_id: str, role: str) -> None:
    try:
        await asyncio.sleep(_DISCONNECT_GRACE_SECONDS)
    except asyncio.CancelledError:
        return
    if not _should_end_after_grace(call_id, role):
        return
    state = _states[call_id]
    state.active = False
    state.end_reason = "customer_disconnected" if role == "mobile" else "agent_disconnected"
    state.ended_by = role
    await _broadcast(
        call_id,
        {
            "type": "call_end",
            "generation": state.generation,
            "end_reason": state.end_reason,
            "ended_by": state.ended_by,
        },
    )


@router.websocket("/ws/ars/{call_id}")
async def ars_socket(websocket: WebSocket, call_id: str, role: str = "mobile") -> None:
    await websocket.accept()
    _clients[call_id].add(websocket)
    _client_roles[websocket] = role
    timer_key = f"{call_id}:{role}"
    pending_end = _disconnect_timers.pop(timer_key, None)
    if pending_end:
        pending_end.cancel()
    state = _states[call_id]
    try:
        while True:
            message = await websocket.receive_json()
            mtype = message.get("type")
            if mtype == "state_request":
                await websocket.send_json(_payload(state))
            elif mtype == "call_start" and not state.active:
                state.generation += 1
                state.active = True
                state.digits = ""
                state.intake_complete = False
                state.agent_connected = False
                state.dtmf_count = 0
                state.drained = True
                state.end_reason = None
                state.ended_by = None
                await _broadcast(call_id, {"type": "call_start", "generation": state.generation})
            elif mtype == "dtmf" and state.active:
                digit = str(message.get("digit", ""))[:1]
                if digit:
                    state.digits = (state.digits + digit)[-24:]
                    state.dtmf_count += 1
                    await _broadcast(
                        call_id,
                        {
                            "type": "dtmf",
                            "digit": digit,
                            "dtmf_seq": state.dtmf_count,
                            "phase": "active" if state.agent_connected else "intake",
                            "captured_at_ms": 0,
                            "persisted": True,
                            "generation": state.generation,
                        },
                    )
                    # #(또는 *) = 고객이 발화를 마쳤다는 명시적 신호. 침묵 타임아웃이나
                    # 연결 끊김 같은 추정이 아니라 이 신호로만 intake_complete를 켠다.
                    if digit in ("#", "*") and not state.intake_complete and not state.agent_connected:
                        state.intake_complete = True
                        await _broadcast(
                            call_id,
                            {
                                "type": "intake_complete",
                                "generation": state.generation,
                                "final_seq": 0,
                                "drained": True,
                            },
                        )
            elif mtype == "agent_connected" and state.active:
                state.agent_connected = True
                state.intake_complete = True
                await _broadcast(
                    call_id, {"type": "agent_connected", "generation": state.generation}
                )
            elif mtype == "call_end" and state.active:
                state.active = False
                state.end_reason = "customer_hangup" if role == "mobile" else "agent_hangup"
                state.ended_by = role
                await _broadcast(
                    call_id,
                    {
                        "type": "call_end",
                        "generation": state.generation,
                        "end_reason": state.end_reason,
                        "ended_by": state.ended_by,
                    },
                )
    except WebSocketDisconnect:
        pass
    finally:
        _clients[call_id].discard(websocket)
        _client_roles.pop(websocket, None)
        if _should_end_after_grace(call_id, role):
            _disconnect_timers[timer_key] = asyncio.create_task(
                _end_call_after_grace(call_id, role)
            )
