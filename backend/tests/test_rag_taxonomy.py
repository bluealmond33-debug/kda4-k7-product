from app.rag import taxonomy


def test_eight_closed_categories() -> None:
    assert set(taxonomy.CATEGORIES) == {
        "DEP", "LON", "CRD", "FX", "EFN", "INV", "SG", "ETC"
    }
    assert taxonomy.CATEGORY_CODES == frozenset(taxonomy.CATEGORIES)


def test_category_validation_accepts_codes_and_none() -> None:
    assert taxonomy.is_valid_category("LON") is True
    assert taxonomy.is_valid_category(None) is True  # None = 필터 없음
    assert taxonomy.is_valid_category("XX") is False
    assert taxonomy.is_valid_category("lon") is False  # 대소문자 구분


def test_label_falls_back_to_code() -> None:
    assert taxonomy.label("SG") == "사고·신고"
    assert taxonomy.label("UNKNOWN") == "UNKNOWN"
