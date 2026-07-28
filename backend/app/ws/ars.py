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
import logging
from collections import defaultdict
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.routing_classifier import fast_auth_policy

logger = logging.getLogger(__name__)
router = APIRouter()

# 소켓이 call_end 없이 그냥 끊겼을 때(와이파이 순단·앱 백그라운드·탭 닫힘) 즉시 종료로
# 치면, 새로고침도 "끊김"이라 통화 복귀 기능을 깨버린다. 그래서 바로 끝내지 않고 이
# 유예 동안 같은 role이 재연결하는지 보고, 못 하면 그때 진짜 종료로 브로드캐스트한다.
# ponytail: 고정 유예(6초)+role당 최신 타이머 1개. 재연결 성공/실패 신호(heartbeat)
# 기반 정교한 판정이 필요해지면 그때 교체.
_DISCONNECT_GRACE_SECONDS = 6.0

# 본인인증 — ponytail: 데모 기간 한정, 8자리만 채우면 값 무관 통과(요청: 라이브 데모 중
# 실제 생년월일이 아니면 인증이 막히는 일이 없게, 2026-07-28). 원래는 YYYYMMDD 형식
# 타당성만 봤다(mismatch/재입력 흐름 시연용) — 되돌리려면 날짜 범위 검증만 복원하면 된다.
def _is_plausible_birthdate(digits: str) -> bool:
    return len(digits) == 8 and digits.isdigit()


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
    # 본인인증(형진님 2026-07-23 검토안) — 접수 종료용 digits/intake_complete와 완전히
    # 분리된 별도 버퍼. awaiting_auth 동안 들어오는 dtmf는 여기로만 쌓인다.
    awaiting_auth: bool = False
    auth_digits: str = ""
    auth_verified: bool = False
    # 실제 라우팅 결과(부서·업무코드) — 직원 화면(/analyze-text, 로컬 LLM 포함)에서만
    # 계산되는데, 고객 폰은 이 분석을 직접 돌리지 않아 접수 시점 픽스처값(예: "주택담보대출
    # 만기연장")에 계속 머물러 있었다(2026-07-28 현장 피드백: 후처리 문자 내용이 실제 상담과
    # 안 맞음). 직원 화면이 계산되는 대로 여기로 보내면, 고객 폰(통화종료 문자 등)도 같은
    # 값을 그대로 쓸 수 있다.
    department: str | None = None
    business_type: str | None = None
    task_code: str | None = None
    task_name: str | None = None


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
        "awaiting_auth": state.awaiting_auth,
        "auth_digit_count": len(state.auth_digits),
        "auth_verified": state.auth_verified,
        "department": state.department,
        "business_type": state.business_type,
        "task_code": state.task_code,
        "task_name": state.task_name,
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


def get_auth_verified(call_id: str) -> bool:
    """통화 종료 시점의 본인인증 완료 여부 — call.py가 DB 저장 직전에 읽어간다."""
    return _states[call_id].auth_verified


def get_intake_complete(call_id: str) -> bool:
    """접수(#/*) 완료 여부 — call.py가 발화 도착마다 빠른 인증 트리거를 걸지 판단할 때 읽는다."""
    return _states[call_id].intake_complete


async def _check_intake_auth(call_id: str) -> None:
    """접수완료(#/*) 순간 접수 발화 전체를 한 번에 규칙 기반으로 판정해 필요하면 인증을
    시작한다. call.py를 임포트해야 하는데 call.py가 이미 이 모듈(ars)을 임포트하므로,
    순환 임포트를 피하려고 함수 안에서만 지연 임포트한다."""
    from app.ws import call as call_module

    session = call_module.registry._sessions.get(call_id)
    if session is None:
        return
    accumulated = " ".join(p for p in session.masked_parts if p).strip()
    if not accumulated:
        return
    try:
        policy = fast_auth_policy(accumulated)
    except Exception:
        logger.warning("[통화 %s] 접수완료 인증정책 판정 실패(무시)", call_id, exc_info=True)
        return
    if policy == "REQUIRED":
        session.auth_trigger_sent = True
        await trigger_auth_if_required(call_id)


async def trigger_auth_if_required(call_id: str) -> None:
    """call.py가 발화 도착 즉시(키워드 기반, LLM 대기 없이) 호출한다 — auth_start 클라이언트
    메시지 핸들러와 동일 로직이지만 서버가 먼저 판단해서 능동적으로 시작한다는 점만 다르다.
    이미 대기 중이거나 완료됐거나 통화가 아직 active가 아니면 조용히 무시(멱등)."""
    state = _states[call_id]
    if not state.active or state.awaiting_auth or state.auth_verified:
        return
    state.awaiting_auth = True
    state.auth_digits = ""
    await _broadcast(call_id, {"type": "auth_start", "generation": state.generation})


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
                state.awaiting_auth = False
                state.auth_digits = ""
                state.auth_verified = False
                state.department = None
                state.business_type = None
                state.task_code = None
                state.task_name = None
                await _broadcast(call_id, {"type": "call_start", "generation": state.generation})
            elif mtype == "routing_update" and state.active:
                # 직원 화면(/analyze-text 완료 후)이 실제 분류 결과를 보내면 고객 폰에도
                # 같은 값을 반영한다 — 후처리 문자·화면이 접수 시점 픽스처가 아니라 실제
                # 상담 내용을 따라가게 한다(2026-07-28 현장 피드백).
                state.department = str(message.get("department") or "") or None
                state.business_type = str(message.get("business_type") or "") or None
                state.task_code = str(message.get("task_code") or "") or None
                state.task_name = str(message.get("task_name") or "") or None
                await _broadcast(
                    call_id,
                    {
                        "type": "routing_update",
                        "department": state.department,
                        "business_type": state.business_type,
                        "task_code": state.task_code,
                        "task_name": state.task_name,
                        "generation": state.generation,
                    },
                )
            elif mtype == "auth_start" and state.active and not state.awaiting_auth:
                # 본인인증 생년월일 수집 시작 — 접수 종료(digits/intake_complete)와는
                # 별도 버퍼(auth_digits)로 받는다. 분석 결과 auth_policy=REQUIRED일 때
                # 고객 쪽(useCallFlow)이 안내 음성 재생과 함께 이 메시지를 보낸다.
                state.awaiting_auth = True
                state.auth_digits = ""
                state.auth_verified = False
                await _broadcast(
                    call_id, {"type": "auth_start", "generation": state.generation}
                )
            elif mtype == "dtmf" and state.active and state.awaiting_auth:
                digit = str(message.get("digit", ""))[:1]
                if digit and digit.isdigit():
                    state.auth_digits = (state.auth_digits + digit)[:8]
                    count = len(state.auth_digits)
                    if count >= 8:
                        if _is_plausible_birthdate(state.auth_digits):
                            state.awaiting_auth = False
                            state.auth_verified = True
                            # 데모용 — 대조할 실제 고객원장이 없어 형식이 맞으면 그대로
                            # '확인 완료'로 처리한다(형진님 문서: 데모의 생년월일 인증은
                            # 실제 운영 인증수단이 아니라 흐름 시연용). 로그엔 자릿수만.
                            logger.info("auth digits collected: call_id=%s count=%d", call_id, count)
                            await _broadcast(
                                call_id,
                                {
                                    "type": "auth_complete",
                                    "digits": state.auth_digits,
                                    "generation": state.generation,
                                },
                            )
                        else:
                            # 13월·32일처럼 형식 자체가 말이 안 되면 불일치로 보고 재입력을
                            # 받는다 — awaiting_auth는 계속 True로 둬서 이어서 누를 수 있게.
                            state.auth_digits = ""
                            logger.info("auth digits rejected(format): call_id=%s", call_id)
                            await _broadcast(
                                call_id,
                                {"type": "auth_mismatch", "generation": state.generation},
                            )
                    else:
                        await _broadcast(
                            call_id,
                            {
                                "type": "auth_progress",
                                "count": count,
                                "generation": state.generation,
                            },
                        )
                elif digit in ("#", "*") and len(state.auth_digits) < 8:
                    # 8자리 다 안 채우고 종료 신호를 보내면 리마인드만 하고 계속 기다린다.
                    await _broadcast(
                        call_id,
                        {
                            "type": "auth_incomplete",
                            "count": len(state.auth_digits),
                            "generation": state.generation,
                        },
                    )
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
                        # 본인인증 판정은 여기, 접수완료 순간 딱 한 번만 한다(2026-07-28 현장
                        # 피드백: "말 다 끝나고 본인인증으로 넘어가야 하는데" — call.py의 발화
                        # 도착마다 도는 빠른 트리거는 #를 누르면 실기기 마이크를 더 안 잡아서
                        # (시뮬레이션 대화로 전환) 그 뒤로 아예 안 불린다. 여기서 접수 발화
                        # 전체를 한 번에 판정해야 실제로 걸린다.
                        await _check_intake_auth(call_id)
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
