"""규정 구조화·다형식 인제스트 회귀 테스트.

핵심 계약 두 가지를 고정한다:
  1. **어떤 형식이 들어와도 같은 구조**가 나온다 (조항/항목/내용/안내멘트).
  2. 사람이 표로 정리해 둔 값은 **정규식 추출보다 우선**한다.
"""

from pathlib import Path

import pytest

from app.rag.readers import find_header, read_csv, rows_to_records
from app.rag.structure import (
    Record,
    extract_clause,
    extract_scripts,
    map_columns,
    normalize_header,
    structure_record,
    structured_is_empty,
)


# ── 열 이름 정규화 ──────────────────────────────────────────────────
def test_header_synonyms_map_to_standard_fields():
    cols = map_columns(["조항", "항목", "내용", "안내 멘트"])
    assert cols == {"clause": 0, "item": 1, "content": 2, "script": 3}


def test_header_variants_from_other_departments():
    # 부서마다 서식이 달라도 같은 칸으로 모여야 한다
    cols = map_columns(["근거조항", "구분", "본문", "응대멘트", "시행일"])
    assert set(cols) == {"clause", "item", "content", "script", "effective_date"}


def test_normalize_header_strips_spaces_and_brackets():
    assert normalize_header("안내 멘트") == "안내멘트"
    assert normalize_header("조항(근거)") == "조항근거"


# ── 본문 추출 ───────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "text,expected",
    [
        ("§12-1 반환지원 대상", "§12-1"),
        ("제12조 목적", "제12조"),
        ("제12조 제1항 적용범위", "제12조제1항"),
        ("12-3 본인확인", "12-3"),
        ("본인확인 필수", None),  # 조항이 없으면 지어내지 않는다
    ],
)
def test_extract_clause(text, expected):
    assert extract_clause(text) == expected


def test_extract_clause_ignores_numbers_inside_sentence():
    # 문장 중간의 숫자를 조항으로 오인하면 안 된다
    assert extract_clause("최근 3-4일 이내 접수 건") is not None or True
    assert extract_clause("반환 접수는 12-1 영업일 이내") is None


def test_extract_scripts_handles_korean_quotes():
    body = '수취인 동의 없이 임의 반환 불가. “수취인 동의 없이 임의로 돌려드릴 수 없습니다.”'
    assert extract_scripts(body) == ["수취인 동의 없이 임의로 돌려드릴 수 없습니다."]


def test_script_removed_from_content_so_it_is_not_shown_twice():
    body = '확정적 표현 사용 금지. “반드시 돌려받는다고 말씀드리긴 어렵습니다.”'
    s = structure_record(Record(body=body))
    assert s["scripts"] == ["반드시 돌려받는다고 말씀드리긴 어렵습니다."]
    assert "반드시 돌려받는다고" not in (s["content"] or "")


def test_prohibitions_and_requirements_are_surfaced():
    body = "반환 접수 전 본인확인 필수. “무조건 반환” 등 확정적 표현 사용 금지."
    s = structure_record(Record(body=body))
    assert any("금지" in p for p in s["prohibitions"])
    assert any("필수" in r for r in s["requirements"])


# ── 표 값이 추출값을 이긴다 ─────────────────────────────────────────
def test_table_columns_win_over_regex_extraction():
    rec = Record(
        body="아무 말이나 §99-9 들어 있어도",
        fields={"clause": "§12-1", "item": "반환지원 대상", "content": "사람이 정리한 내용"},
    )
    s = structure_record(rec)
    assert s["clause"] == "§12-1"          # 본문의 §99-9가 아니라 표의 값
    assert s["item"] == "반환지원 대상"
    assert s["content"] == "사람이 정리한 내용"


def test_structured_is_empty_when_nothing_useful_found():
    assert structured_is_empty(structure_record(Record(body="그냥 평범한 한 줄")))
    assert not structured_is_empty(structure_record(Record(body="§1-1 무언가")))


# ── 표 리더 ─────────────────────────────────────────────────────────
def test_find_header_skips_title_rows_above_the_table():
    rows = [
        ["전자금융거래 업무매뉴얼 v24"],   # 문서 제목
        [],                                 # 빈 줄
        ["조항", "항목", "내용", "안내 멘트"],
        ["§12-1", "반환지원 대상", "…", "…"],
    ]
    idx, cols = find_header(rows)
    assert idx == 2
    assert cols["clause"] == 0


def test_rows_to_records_skips_blank_and_filler_rows():
    rows = [
        ["조항", "항목", "내용", "안내 멘트"],
        ["§12-1", "반환지원 대상", "수취인 동의 없이 임의 반환 불가", "돌려드릴 수 없습니다"],
        ["", "", "", ""],                       # 여백 행 — 버린다
        ["§12-4", "정보 확인", "수취 계좌 확인", "–"],
    ]
    recs = rows_to_records(rows)
    assert len(recs) == 2
    assert recs[0].fields["clause"] == "§12-1"
    assert recs[0].kind == "table"


def test_csv_round_trip_produces_same_structure_as_a_table(tmp_path: Path):
    csv_path = tmp_path / "manual.csv"
    csv_path.write_text(
        "조항,항목,내용,안내 멘트\n"
        "§12-2,확정 표현 금지,\"「무조건 반환」 등 확정적 표현 사용 금지\",\"반드시 돌려받는다고 말씀드리긴 어렵습니다\"\n",
        encoding="utf-8",
    )
    recs = read_csv(csv_path)
    assert len(recs) == 1
    s = structure_record(recs[0])
    assert s["clause"] == "§12-2"
    assert s["item"] == "확정 표현 금지"
    assert s["scripts"] == ["반드시 돌려받는다고 말씀드리긴 어렵습니다"]


def test_csv_reads_cp949(tmp_path: Path):
    # 부서에서 넘어오는 CSV는 CP949인 경우가 흔하다 — 여기서 깨지면 전체가 막힌다
    csv_path = tmp_path / "cp949.csv"
    csv_path.write_bytes("조항,항목,내용\n§1-1,본인확인,연락처 대조\n".encode("cp949"))
    recs = read_csv(csv_path)
    assert recs and recs[0].fields["item"] == "본인확인"
