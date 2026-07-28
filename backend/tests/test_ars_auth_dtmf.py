"""app/ws/ars.py 본인인증(생년월일 8자리) DTMF 흐름 테스트 (2026-07-28).

이 파일이 검증하는 두 가지는 사용자 요청에서 직접 나왔다:
1. 8자리를 다 누르면 #을 누르지 않아도 그 자리에서 바로 인증이 완료돼야 한다.
2. 인증 완료 시점에는 "본인 확인이 완료되었습니다..." 안내만 남고 다른 안내가 끼어들 여지가
   없어야 한다(서버 쪽에서 확인 가능한 부분 — 프론트 오디오 우선순위 자체는 arsDialogue.ts의
   takeOverArsAudio가 별도로 보장한다).

무거운 모델 임포트(torch·lightgbm·opensmile 등)가 딸린 app.main을 그대로 띄우면 이 랩탑에서
스레드풀 충돌로 SIGSEGV가 나는 경우가 있어(demo-up.sh 참고), 그 완화책과 동일하게 각 런타임을
스레드 1개로 강제한 뒤에 임포트한다.
"""

import os

for _var in (
    "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS", "MKL_NUM_THREADS",
):
    os.environ.setdefault(_var, "1")

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.ws import ars


def _reset(call_id: str) -> None:
    ars._states.pop(call_id, None)
    ars._clients.pop(call_id, None)


def _start_and_authenticate(ws, digits: str = "19900101") -> None:
    ws.send_json({"type": "call_start"})
    ws.receive_json()
    ws.send_json({"type": "auth_start"})
    ws.receive_json()
    for digit in digits:
        ws.send_json({"type": "dtmf", "digit": digit})
        ws.receive_json()


def test_8자리를_다_누르면_해시_없이_그_자리에서_인증이_완료된다() -> None:
    call_id = f"auth-8digit-{uuid4()}"
    _reset(call_id)
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as ws:
                ws.send_json({"type": "call_start"})
                ws.receive_json()
                ws.send_json({"type": "auth_start"})
                ws.receive_json()

                digits = "19900101"
                events = []
                for digit in digits:
                    ws.send_json({"type": "dtmf", "digit": digit})
                    events.append(ws.receive_json())

                # 8번째 자리(마지막 digit)를 누른 바로 그 응답이 auth_complete여야 한다 —
                # #을 별도로 누르는 9번째 메시지가 필요 없다.
                assert [e["type"] for e in events[:7]] == ["auth_progress"] * 7
                assert events[7]["type"] == "auth_complete"
                assert events[7]["digits"] == digits

        assert ars.get_auth_verified(call_id) is True
    finally:
        _reset(call_id)


def test_인증_완료_후_상태는_대기중이_아니라_완료로_남는다() -> None:
    call_id = f"auth-state-{uuid4()}"
    _reset(call_id)
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as ws:
                _start_and_authenticate(ws)
                ws.send_json({"type": "state_request"})
                snapshot = ws.receive_json()
                assert snapshot["type"] == "ars_state"
                assert snapshot["awaiting_auth"] is False
                assert snapshot["auth_verified"] is True
                assert snapshot["auth_digit_count"] == 8
    finally:
        _reset(call_id)


def test_8자리_미만에서_해시를_누르면_리마인드만_하고_계속_대기한다() -> None:
    """조기에 #을 누르는 경우 — 인증을 끊지 않고 "8자리 다 눌러주세요"만 보낸다."""
    call_id = f"auth-early-hash-{uuid4()}"
    _reset(call_id)
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as ws:
                ws.send_json({"type": "call_start"})
                ws.receive_json()
                ws.send_json({"type": "auth_start"})
                ws.receive_json()

                for digit in "199":
                    ws.send_json({"type": "dtmf", "digit": digit})
                    ws.receive_json()

                ws.send_json({"type": "dtmf", "digit": "#"})
                reminder = ws.receive_json()
                assert reminder["type"] == "auth_incomplete"
                assert reminder["count"] == 3

                ws.send_json({"type": "state_request"})
                snapshot = ws.receive_json()
                assert snapshot["awaiting_auth"] is True
                assert snapshot["auth_digit_count"] == 3  # 자리 유지 — 리셋되지 않는다
    finally:
        _reset(call_id)


def test_형식이_틀린_생년월일은_재입력을_요청하고_자리를_비운다() -> None:
    call_id = f"auth-mismatch-{uuid4()}"
    _reset(call_id)
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as ws:
                ws.send_json({"type": "call_start"})
                ws.receive_json()
                ws.send_json({"type": "auth_start"})
                ws.receive_json()

                events = []
                for digit in "19981332":  # 13월 32일 — 있을 수 없는 날짜
                    ws.send_json({"type": "dtmf", "digit": digit})
                    events.append(ws.receive_json())

                assert events[-1]["type"] == "auth_mismatch"

                ws.send_json({"type": "state_request"})
                snapshot = ws.receive_json()
                assert snapshot["awaiting_auth"] is True
                assert snapshot["auth_digit_count"] == 0  # 재입력을 위해 비워짐
                assert snapshot["auth_verified"] is False
    finally:
        _reset(call_id)


def test_인증_완료_후에는_숫자입력이_인증_이벤트를_다시_트리거하지_않는다() -> None:
    """8자리 인증이 끝난 뒤 이어지는 dtmf는(설령 #이라도) 일반 접수 입력으로만 처리돼야
    한다 — auth_progress·auth_incomplete 같은 인증 관련 안내가 다시 뜨면 안 된다."""
    call_id = f"auth-post-complete-{uuid4()}"
    _reset(call_id)
    try:
        with TestClient(app) as client:
            with client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as ws:
                _start_and_authenticate(ws)

                ws.send_json({"type": "dtmf", "digit": "5"})
                event = ws.receive_json()
                assert event["type"] == "dtmf"
                assert event["digit"] == "5"

                ws.send_json({"type": "state_request"})
                snapshot = ws.receive_json()
                assert snapshot["awaiting_auth"] is False
                assert snapshot["auth_verified"] is True
    finally:
        _reset(call_id)
