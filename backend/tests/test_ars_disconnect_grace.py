"""ars.py 재연결-유예 판정 테스트.

실제 asyncio 타이머(_end_call_after_grace)는 라이브 테스트로 검증하고, 여기선 그
판정 근거인 "재연결했으면 종료 보류 / 안 했으면 종료" 순수 로직(_should_end_after_grace)만
확인한다 — 새로고침(끊김→재연결)이 통화를 끊어버리면 안 된다는 게 핵심 회귀 포인트.
"""

from app.ws import ars


def _reset(call_id: str) -> None:
    ars._states.pop(call_id, None)
    ars._clients.pop(call_id, None)


def test_reconnected_role_skips_end():
    call_id = "test-call-reconnect"
    _reset(call_id)
    ars._states[call_id].active = True
    fake_ws = object()
    ars._clients[call_id].add(fake_ws)
    ars._client_roles[fake_ws] = "mobile"

    assert ars._should_end_after_grace(call_id, "mobile") is False


def test_truly_disconnected_role_ends_call():
    call_id = "test-call-gone"
    _reset(call_id)
    ars._states[call_id].active = True

    assert ars._should_end_after_grace(call_id, "mobile") is True


def test_already_inactive_call_does_not_end_again():
    call_id = "test-call-inactive"
    _reset(call_id)
    ars._states[call_id].active = False

    assert ars._should_end_after_grace(call_id, "mobile") is False


def test_other_role_disconnecting_does_not_affect_this_role():
    call_id = "test-call-other-role"
    _reset(call_id)
    ars._states[call_id].active = True
    fake_ws = object()
    ars._clients[call_id].add(fake_ws)
    ars._client_roles[fake_ws] = "desktop"

    # desktop만 남아있고 mobile은 없음 -> mobile 쪽 유예 판정은 종료(True)여야 한다.
    assert ars._should_end_after_grace(call_id, "mobile") is True
