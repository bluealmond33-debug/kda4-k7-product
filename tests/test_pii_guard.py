"""개인정보 가드(주제 11·12) 회귀 테스트.

특히 **STT가 숫자를 쉼표로 끊어 적는다**는 점이 중요하다. 하이픈·공백만 구분자로
보면 실제 통화에서 계좌번호가 그대로 통과한다(2026-07-23 시연에서 상담사 화면에
노출된 사고).
"""

from app.services.pii_guard import detect_pii, mask_transcript


# ── 쉼표 구분 숫자 (STT 실제 출력 형태) ────────────────────────────────

def test_쉼표로_끊어진_계좌번호를_마스킹한다():
    text = "계좌번호 불러드릴게요 111,222,334 예금주는 본인 확인됐고요"

    masked, hits = mask_transcript(text)

    assert "111,222,334" not in masked
    assert any(h.type == "account" for h in hits)


def test_시연_전사문에서_계좌번호가_노출되지_않는다():
    """2026-07-23 시연에서 실제로 상담사 화면에 노출된 전사문 그대로."""
    text = (
        "저기요 지금 부산인데요 제 카드가 방금 해외에서 250달러 결제했다는 문자가 "
        "왔어요 전 지금 한국에 있는데 이거 돈 아닌 것 같아요 빨리 정지시켜주세요 "
        "계좌번호 불러드릴게요 111,222,334 예금주는 본인 확인됐고요 이체한도는 "
        "500만원까지입니다"
    )

    masked, _ = mask_transcript(text)

    assert "111,222,334" not in masked


def test_쉼표로_끊어진_카드번호를_마스킹한다():
    text = "카드번호는 1234,5678,9012,3456 입니다"

    masked, hits = mask_transcript(text)

    assert "1234,5678,9012,3456" not in masked
    assert any(h.type == "card" for h in hits)


# ── 기존 동작 회귀 (구분자 확장이 기존 탐지를 깨지 않아야 한다) ──────────

def test_하이픈_계좌번호는_뒤_4자리만_남긴다():
    masked, hits = mask_transcript("계좌 110-234-567890 입니다")

    assert masked == "계좌 ***-***-**7890 입니다"
    assert [h.type for h in hits] == ["account"]


def test_주민등록번호와_전화번호를_각각_마스킹한다():
    masked, hits = mask_transcript("주민번호 900101-1234567 이고 전화는 010-1234-5678")

    assert masked == "주민번호 900101-1****** 이고 전화는 010-****-5678"
    assert {h.type for h in hits} == {"rrn", "phone"}


def test_금액은_개인정보로_보지_않는다():
    """'1,000,000원' 같은 금액이 계좌번호로 오탐되면 요약이 망가진다."""
    hits = detect_pii("이체한도는 1,000,000원 입니다")

    assert not any(h.type == "account" for h in hits)
