from app.classification import classify_transcript


def assert_code(text: str, expected: str) -> None:
    assert classify_transcript(text)["code"] == expected


def test_emergency_requires_context() -> None:
    assert_code("검사라고 하면서 개인정보를 묻고 송금하라고 했어요", "E001")
    assert_code("제가 하지 않은 해외 결제가 있어요", "E002")
    assert_code("검찰청 위치를 알고 싶어요", "G004")


def test_simple_boundaries() -> None:
    assert_code("내 계좌에 얼마 있어?", "S001")
    assert_code("오늘 서울역 근처 은행 몇 시까지 해?", "S006")
    assert_code("송금 처리 여부를 확인하고 싶어요", "S003")
    assert_code("송금 처리 여부를 확인하려는데 오류가 났어요", "G004")


def test_ars_catalog() -> None:
    assert_code("이번 달 카드값 얼마인지 알려줘", "S101")
    assert_code("체크카드 한도 조회하고 싶어요", "S104")
    assert_code("포인트를 조회하고 싶어요", "S113")
    assert classify_transcript("직원에게 카드 한도 상담 받고 싶어요")["classification"] == "GENERAL"
