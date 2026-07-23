"""5단계: RAG — 규정/매뉴얼/절차 문서를 벡터DB(FAISS)에서 검색.

김민기님 RAG 설계 v0.1(2026-07-20, 규정검색-설계-및-분류체계)을 온프레미스 데모 범위에서
반영한 버전.

설계와의 관계(팀 합의: 벡터저장소 pgvector로 통일 + taxonomy 이식):
- **벡터저장소**: 2026-07-21 팀 결정으로 벡터저장소를 pgvector로 통일(모노레포 표준과 일치).
  search_procedures()는 pgvector가 준비되면(app/services/rag_store.py) 그걸 쓰고, 아직
  확장/시드가 없으면 아래 FAISS 경로로 자동 폴백한다. 이 파일의 _DOCS는 pgvector 시드의
  원천이자 폴백 코퍼스로 계속 쓰인다.
- **taxonomy(8대분류)**: 설계 4절의 닫힌 집합 8종을 그대로 이식. 각 청크에 category 태그를
  달아 통화 용건에 맞는 규정만 좁혀 검색(카테고리 필터).
- **청크 출처**: 더미 5개(보이스피싱 절차)를 팀 합의 업무분류(bank.xlsx) 기반 실제 규정
  청크로 교체·확장. 각 청크는 어느 대분류/중분류인지 명시.

아직 안 한 것(설계의 남은 일 = 후속):
- text/table 청크 분리, 엔티티·개정일 태깅, supersede 버전관리는
  하나은행 실물 PDF + 김민기님 ingest.py 도착 후.
- CRD(카드)·INV(연금·투자)는 bank.xlsx에 소스가 없어 설계 4절 중분류 예시를 바탕으로 데모
  청크를 채워뒀다. 다른 청크와 마찬가지로 실물 PDF 도착 시 교체될 데모용 근거다.

임베딩은 settings.use_local_models로 두 가지 중 선택:
- false(기본): OpenAI 임베딩 API(text-embedding-3-small)
- true(온프레미스): Ollama의 bge-m3(로컬, 다국어/한국어 지원)
두 임베딩은 차원이 다르므로 인덱스 캐시도 모드별로 분리한다.
"""

import hashlib
import json
import logging
import pathlib
import shutil
import tempfile

import httpx
import numpy as np
import faiss
from openai import OpenAI

from app.config import Settings
from app.schemas import RagDocument

logger = logging.getLogger(__name__)

_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"
_OLLAMA_EMBEDDING_MODEL = "bge-m3"

# 김민기 설계 4절 — 규정 8대분류(닫힌 집합). AI 용건 분류기의 라벨셋이자 검색 필터.
TAXONOMY: dict[str, str] = {
    "DEP": "수신·예적금",
    "LON": "여신·대출",
    "CRD": "카드·결제",
    "FX": "외환·수출입",
    "EFN": "전자금융·디지털",
    "INV": "연금·신탁·투자",
    "SG": "사고·신고",       # 보이스피싱·분실도난·착오송금 — 긴급 라우팅과 직결
    "ETC": "제도·민원·기타",
}

# 규정 청크. category는 TAXONOMY 코드. text는 팀 합의 업무분류(bank.xlsx)의 세부업무·비고를
# 상담사 안내문 형태로 풀어 쓴 것(원문 대체 아님, 데모용 근거 자리). 실물 PDF 도착 시 교체.
_DOCS: list[dict] = [
    # ── SG(사고·신고) ── 기존 보이스피싱 절차 5개(유지) + 업무분류 추가분
    {
        "doc_id": "sg-001", "category": "SG", "subcategory": "지급정지",
        "title": "지급정지 신청 절차",
        "text": (
            "고객이 보이스피싱으로 인한 계좌이체 피해를 신고하면 즉시 해당 계좌에 대한 "
            "지급정지를 신청해야 한다. 지급정지는 피해자 본인 또는 명의인의 요청으로 접수 가능하며, "
            "경찰 신고 접수번호가 있으면 처리 속도가 빨라진다. 지급정지 등록 자체는 ARS 자동화로도 "
            "가능하나, 지급정지 후 24시간 이내 금융감독원 피해구제 신청 안내는 상담원이 진행한다."
        ),
    },
    {
        "doc_id": "sg-002", "category": "SG", "subcategory": "원격제어",
        "title": "원격제어 앱 설치 피해 대응",
        "text": (
            "고객이 원격제어 앱(예: 팀뷰어 유사 앱)을 설치했다고 답변하면, 즉시 해당 앱 삭제와 "
            "휴대폰 재부팅을 안내하고, 공동인증서 재발급 및 계좌 비밀번호 변경을 함께 안내한다. "
            "통제권을 완전히 상실한 정황이 있으면 사고전문 상담사로 즉시 이관한다."
        ),
    },
    {
        "doc_id": "sg-003", "category": "SG", "subcategory": "인증정보노출",
        "title": "인증정보 노출 시 대응",
        "text": (
            "계좌 비밀번호, 보안카드 번호, OTP, 인증번호 등이 타인에게 노출된 경우, "
            "즉시 비밀번호 변경과 보안카드/OTP 재발급을 안내하고 최근 거래내역을 "
            "함께 확인하여 미승인 거래 여부를 점검한다."
        ),
    },
    {
        "doc_id": "sg-004", "category": "SG", "subcategory": "반복민원",
        "title": "반복 민원 및 이전 해결 실패 사례 처리",
        "text": (
            "동일 사건으로 반복 연락하거나 이전 상담에서 문제가 해결되지 않은 경우, "
            "이전 상담 이력을 먼저 조회하여 중복 안내를 피하고, 숙련 상담사 또는 "
            "전담 부서로 우선 배정한다."
        ),
    },
    {
        "doc_id": "sg-005", "category": "SG", "subcategory": "정보확인",
        "title": "피해 정보 미확정 시 확인 절차",
        "text": (
            "피해 금액, 송금 시각, 지급정지 여부 등 핵심 정보가 확인되지 않은 상태로 "
            "상담이 시작되면, 상담사는 통화 초반에 해당 항목을 우선적으로 확인하도록 안내한다."
        ),
    },
    {
        "doc_id": "sg-006", "category": "SG", "subcategory": "명의도용·해킹",
        "title": "명의도용·해킹 신고 대응",
        "text": (
            "인증서나 계좌가 무단으로 발급·개설된 정황이 있으면 명의도용·해킹으로 보고 "
            "고객 명의 전체 거래를 긴급 정지한다. 사고 접수 후 무단 개설 계좌·발급 인증서 목록을 "
            "확인하고, 신규 거래 차단과 인증수단 전면 재발급을 안내한다."
        ),
    },
    {
        "doc_id": "sg-007", "category": "SG", "subcategory": "착오송금반환",
        "title": "착오송금(오송금) 반환 청구",
        "text": (
            "고객이 실수로 잘못 송금(착오송금)했다고 신고하면, 수취인 동의 기반 자율 반환 절차와 "
            "예금보험공사 착오송금 반환지원 제도를 함께 안내한다. 송금 일시·금액·수취 계좌를 "
            "확인하고, 반환이 지연되면 관련 서류 접수 방법을 안내한다."
        ),
    },
    {
        "doc_id": "sg-008", "category": "SG", "subcategory": "피싱종합대응",
        "title": "피싱 피해 종합 대응 체크리스트",
        "text": (
            "피싱 피해 접수 시 ①사기 계좌와 본인 계좌 지급정지 ②스마트폰 비대면 채널 일시정지 "
            "③보안매체·카드 정지 ④피해 사실 전산 접수(공인) 순으로 조치한다. 피해 사실을 전산에 "
            "기록해 공인해야 이후 피해구제 신청의 근거가 된다."
        ),
    },
    {
        "doc_id": "sg-009", "category": "SG", "subcategory": "이상금융거래",
        "title": "이상금융거래 신고 처리",
        "text": (
            "고객이 본인이 하지 않은 의심 거래를 신고하면 이상금융거래로 접수하고, 해당 거래 채널을 "
            "점검한다. 필요 시 계좌·카드 일시 정지와 인증수단 재발급을 안내하고, 미승인 거래 목록을 "
            "함께 확인한다."
        ),
    },
    # ── LON(여신·대출) ──
    {
        "doc_id": "lon-001", "category": "LON", "subcategory": "만기연장·약정변경",
        "title": "대출 만기 연장·중도상환·약정변경 상담",
        "text": (
            "대출 만기 연장·중도상환·약정변경·실행일 변경 상담이다. 단순 만기 연장은 ARS로도 "
            "가능하나, 금리·한도 등 조건 변경이나 실행일 변경은 서류 보완과 심사 절차가 필요하므로 "
            "상담원이 처리한다. 필요한 서류와 심사 소요 기간을 안내한다."
        ),
    },
    {
        "doc_id": "lon-002", "category": "LON", "subcategory": "금리·한도조회",
        "title": "대출 금리 및 한도 조회",
        "text": (
            "고객이 보유·신규 대출의 적용 금리와 한도를 문의하면, 상품별 기준금리·가산금리 구조와 "
            "한도 산정 기준을 안내한다. 중도상환 조건 문의가 이어지면 중도상환수수료 부과 여부를 "
            "함께 확인한다."
        ),
    },
    {
        "doc_id": "lon-003", "category": "LON", "subcategory": "한도제한계좌해제",
        "title": "한도제한계좌 해제 및 이체한도 증액",
        "text": (
            "한도제한계좌 해제 문의 시, 일일 이체한도와 일시적 이체한도를 구분해 안내한다. "
            "주택 계약 등 목돈 이체가 필요한 경우 앱에서 임시 증액하는 방법 또는 증빙 서류 제출 "
            "방법을 안내한다."
        ),
    },
    {
        "doc_id": "lon-004", "category": "LON", "subcategory": "맞춤형상품추천",
        "title": "맞춤형 대출 상품 추천",
        "text": (
            "고객 상황에 맞는 대출 상품 추천은 앱에서 가능하나 ARS로는 제공되지 않는다. "
            "소득·담보·기존 대출 현황을 확인해 적합 상품군을 안내하고, 상세 조건은 심사를 통해 "
            "확정됨을 고지한다."
        ),
    },
    # ── DEP(수신·예적금) ──
    {
        "doc_id": "dep-001", "category": "DEP", "subcategory": "만기해지·재예치",
        "title": "예적금 만기 해지 및 재예치",
        "text": (
            "예적금 만기 해지 및 재예치 상담은 앱에서 가능하나 ARS로는 제공되지 않는다. "
            "만기 도래 예적금의 해지 예상 금액과 재예치 시 적용 금리를 안내하고, 자동 재예치 설정 "
            "여부를 확인한다."
        ),
    },
    # ── FX(외환·수출입) ──
    {
        "doc_id": "fx-001", "category": "FX", "subcategory": "해외송금추적",
        "title": "해외송금 오입력 자금 추적",
        "text": (
            "해외송금 정보 오입력으로 중간에 자금이 묶인 경우, 상담원이 중개 은행에 전문(SWIFT "
            "메시지)을 보내 자금을 추적한다. 송금 일시·금액·수취 은행 정보를 확인하고 추적 소요 "
            "기간을 안내한다."
        ),
    },
    {
        "doc_id": "fx-002", "category": "FX", "subcategory": "송금사유·서류",
        "title": "해외송금 사유 확인 및 서류 보완",
        "text": (
            "해외송금 사유 확인과 서류 보완은 비대면 접수가 가능하다. 팩스 또는 모바일 서류제출 "
            "URL 문자를 통해 증빙 서류를 안내·접수한다. 송금 목적별 필요 서류를 안내한다."
        ),
    },
    {
        "doc_id": "fx-003", "category": "FX", "subcategory": "송금취소·수취확인",
        "title": "해외송금 취소 요청 및 수취 확인",
        "text": (
            "해외송금 취소 요청 및 수취 확인 문의를 처리한다. 송금 진행 단계에 따라 취소 가능 여부가 "
            "달라지므로 현재 처리 상태를 확인한 뒤, 취소 가능 시 절차와 소요 기간을, 이미 수취된 "
            "경우 수취 은행 확인 방법을 안내한다."
        ),
    },
    # ── EFN(전자금융·디지털) ──
    {
        "doc_id": "efn-001", "category": "EFN", "subcategory": "공동인증서",
        "title": "공동인증서 등록오류·폐기",
        "text": (
            "공동인증서 등록 오류 또는 폐기 요청을 처리한다. 오류 유형(등록 실패, 만료, 타 기관 "
            "발급분 미등록)을 확인하고 재등록 또는 폐기 후 재발급 절차를 안내한다."
        ),
    },
    {
        "doc_id": "efn-002", "category": "EFN", "subcategory": "OTP",
        "title": "OTP 신고 해제 및 시간 보정",
        "text": (
            "분실 신고했던 OTP의 신고 해제 또는 OTP 시간 보정 요청을 처리한다. 다만 잠금 상태는 "
            "영업점에서 수동으로 풀어야 하므로, 잠김인 경우 가까운 영업점 방문을 안내한다."
        ),
    },
    {
        "doc_id": "efn-003", "category": "EFN", "subcategory": "이체비번오류",
        "title": "이체 비밀번호 연속 오류 해제",
        "text": (
            "이체 비밀번호 연속 오류로 잠긴 경우 해제를 진행한다. 앱 비대면 신분증 확인 인식이 "
            "실패하면 화상 통화 또는 추가 본인확인을 통해 해제한다."
        ),
    },
    {
        "doc_id": "efn-004", "category": "EFN", "subcategory": "휴면계좌",
        "title": "휴면계좌 거래 중지 해제",
        "text": (
            "휴면계좌의 거래 중지 해제는 앱에서도 가능하지만 전화 상담으로도 처리할 수 있다. "
            "본인확인 후 거래 재개 절차와 재활성화 후 유의사항을 안내한다."
        ),
    },
    # ── CRD(카드·결제) ── bank.xlsx엔 없어 설계 4절 중분류 예시 기반 데모 청크
    {
        "doc_id": "crd-001", "category": "CRD", "subcategory": "카드승인",
        "title": "카드 승인 거절·오류 대응",
        "text": (
            "카드 승인이 거절되면 사유(한도 초과, 카드 정지, 해외거래 차단, 부정사용 의심)를 "
            "먼저 확인한다. 일시적 한도 초과면 결제한도 조정 또는 즉시결제를 안내하고, 해외거래 "
            "차단이면 해외 이용 등록 절차를 안내한다."
        ),
    },
    {
        "doc_id": "crd-002", "category": "CRD", "subcategory": "결제한도",
        "title": "카드 결제한도 조회 및 상향",
        "text": (
            "일시불·할부·월 결제한도를 조회하고 상향 신청을 안내한다. 상향은 이용실적과 심사에 "
            "따라 결정되며, 임시 상향과 상시 상향을 구분해 필요한 서류와 처리 기간을 안내한다."
        ),
    },
    {
        "doc_id": "crd-003", "category": "CRD", "subcategory": "카드론·현금서비스",
        "title": "카드론·현금서비스 상담",
        "text": (
            "카드론(장기카드대출)과 현금서비스(단기카드대출)의 이용 가능 한도·적용 금리·상환 "
            "방식을 안내한다. 중도상환 가능 여부와 연체 시 불이익을 함께 고지한다."
        ),
    },
    {
        "doc_id": "crd-004", "category": "CRD", "subcategory": "자동납부",
        "title": "카드 자동납부 등록·변경",
        "text": (
            "카드 결제대금 자동납부(자동이체)의 결제일과 출금 계좌 등록·변경을 처리한다. "
            "변경 신청 시점에 따라 이번 달 청구분 반영 여부가 달라질 수 있어 적용 시점을 안내한다."
        ),
    },
    {
        "doc_id": "crd-005", "category": "CRD", "subcategory": "카드해지·재발급",
        "title": "카드 해지 및 분실 재발급",
        "text": (
            "카드 해지 시 잔여 포인트 소멸·연회비 정산·자동납부 이전을 안내한다. 분실·도난은 "
            "즉시 카드 정지 후 재발급을 안내하고, 부정사용 정황이 있으면 사고(SG) 절차로 연계한다."
        ),
    },
    # ── INV(연금·신탁·투자) ── bank.xlsx엔 없어 설계 4절 중분류 예시 기반 데모 청크
    {
        "doc_id": "inv-001", "category": "INV", "subcategory": "IRP·퇴직연금",
        "title": "IRP 가입·이전 상담",
        "text": (
            "개인형 퇴직연금(IRP) 가입·이전 상담이다. 세액공제 한도와 중도인출 제한, 운용관리·"
            "자산관리 수수료 구조를 안내한다. 타 기관 IRP 이전은 현물이전 가능 여부를 함께 확인한다."
        ),
    },
    {
        "doc_id": "inv-002", "category": "INV", "subcategory": "디폴트옵션",
        "title": "퇴직연금 디폴트옵션(사전지정운용) 안내",
        "text": (
            "퇴직연금 디폴트옵션(사전지정운용제도)의 상품 지정·변경을 안내한다. 운용 지시가 없을 때 "
            "적용되는 사전지정 상품과 위험등급을 확인하고, 변경 시 반영 시점을 안내한다."
        ),
    },
    {
        "doc_id": "inv-003", "category": "INV", "subcategory": "펀드",
        "title": "펀드 가입·환매 상담",
        "text": (
            "펀드 가입 시 투자성향 진단과 상품 위험등급 적합성을 확인한다. 환매는 상품별 환매 "
            "소요일(영업일 기준)과 기준가 적용일, 환매수수료 부과 여부를 안내한다."
        ),
    },
    {
        "doc_id": "inv-004", "category": "INV", "subcategory": "신탁",
        "title": "신탁 상품 상담",
        "text": (
            "신탁 상품의 유형(금전신탁·재산신탁 등)과 수수료, 중도 해지 조건을 안내한다. "
            "원금 비보장 상품인 경우 투자 위험을 명확히 고지한다."
        ),
    },
    # ── ETC(제도·민원·기타) ── 민원 + 금융복지
    {
        "doc_id": "etc-001", "category": "ETC", "subcategory": "민원·피해보상",
        "title": "은행 이용 중 피해보상 요구",
        "text": (
            "은행 이용 과정에서 발생한 피해에 대한 보상 요구 민원을 접수한다. 피해 경위와 요구 "
            "사항을 확인해 정식 민원으로 등록하고, 처리 절차와 회신 예정 시점을 안내한다."
        ),
    },
    {
        "doc_id": "etc-002", "category": "ETC", "subcategory": "민원·불편사항",
        "title": "은행 이용 중 불편사항 접수",
        "text": (
            "은행 이용 중 불편사항을 접수한다. 불편 내용을 구체적으로 확인해 담당 부서로 전달하고, "
            "개선·회신 여부를 안내한다."
        ),
    },
    {
        "doc_id": "etc-003", "category": "ETC", "subcategory": "금융복지·압류계좌",
        "title": "압류계좌 최저생계비 상담",
        "text": (
            "압류계좌는 ARS 처리가 불가하며 상담원이 안내한다. 압류방지통장 또는 예외적으로 출금 "
            "가능한 최저생계비 금액 설정 방법을 안내하고, 필요한 증빙과 신청 절차를 함께 안내한다."
        ),
    },
    {
        "doc_id": "etc-004", "category": "ETC", "subcategory": "금융복지·정부지원금",
        "title": "정부지원금 계좌 안내",
        "text": (
            "정부지원금 수급 계좌 관련 문의를 처리한다. 수급 계좌의 현재 상태를 확인한 뒤, 입금 "
            "가능 여부와 압류방지 여부 등 필요한 사항을 안내한다."
        ),
    },
]

# ── 김동희 규정 RAG 통합 (하나은행 예금·대출·외환·연금 규정 1,153청크) ──
# 팀 표준은 pgvector이나, 미준비 시 이 FAISS 폴백 코퍼스에 실제 규정 청크를 합쳐
# 데모에서 진짜 규정 검색이 되게 한다. chunks 파일 없으면 위 시드만 쓴다(무해).
def _load_regulation_chunks() -> list[dict]:
    path = pathlib.Path(__file__).resolve().parent / "rag_data" / "regulation_chunks.jsonl"
    if not path.is_file():
        return []
    docs: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue
        text = (c.get("text") or "").strip()
        if not text:
            continue
        docs.append({
            "doc_id": c.get("chunk_id") or c.get("doc_id"),
            "category": c.get("department"),       # DEP(수신)/LON(여신)/FX(외환)/INV(연금)
            "subcategory": c.get("business_code"),
            "title": c.get("title") or c.get("doc_id") or "규정",
            "text": text,
            # ── 원본 메타 보존 (2026-07-23) ──
            # 규정 API(/api/v1/regulations/*)가 프론트 계약(chunk_id·page·kind·section·
            # categories·version)을 그대로 채우려면 이 필드들이 필요하다. 위 5개는 FAISS
            # 인덱스 매핑용으로 그대로 두고(하위 호환), 메타만 덧붙인다.
            "chunk_id": c.get("chunk_id"),
            "source_doc_id": c.get("doc_id"),      # 문서 단위 ID(청크 여럿이 공유)
            "filename": c.get("filename"),
            "doc_type": c.get("doc_type"),
            "categories": c.get("categories") or [],
            "version": c.get("version") or "v1",
            "effective_date": c.get("effective_date"),
            "status": c.get("status") or "active",
            "page": c.get("page") or 1,
            "kind": c.get("kind") or "text",
            "section": c.get("section"),
        })
    logger.info("규정 RAG 청크 %d개 로드(김동희)", len(docs))
    return docs


_DOCS.extend(_load_regulation_chunks())


# ── 코퍼스 조회 헬퍼 (규정 API 전용) ────────────────────────────────────────
# _DOCS는 "청크 리스트"다. 김동희 청크는 source_doc_id로 문서 단위가 묶이고,
# 상단의 시드 더미(sg-001 등)는 문서=청크 1:1이라 doc_id를 그대로 문서 ID로 쓴다.

def document_id_of(chunk: dict) -> str:
    """청크가 속한 문서 ID. 실규정은 source_doc_id, 시드 더미는 자기 doc_id."""
    return chunk.get("source_doc_id") or chunk["doc_id"]


def get_chunk(doc_id: str) -> dict | None:
    """검색 결과(RagDocument.doc_id)에 원본 메타를 다시 붙이기 위한 역조회."""
    return _CHUNK_BY_ID.get(doc_id)


def get_document(doc_id: str) -> dict | None:
    """문서 메타 + 페이지순 청크 전체. 없으면 None.

    프론트 '원문 열람 시트'(RegulationDoc)가 기대하는 형태로 조립한다.
    """
    chunks = [c for c in _DOCS if document_id_of(c) == doc_id]
    if not chunks:
        return None
    head = chunks[0]
    ordered = sorted(chunks, key=lambda c: (c.get("page") or 1, c.get("chunk_id") or ""))
    return {
        "doc_id": doc_id,
        "title": head.get("title") or doc_id,
        "doc_type": head.get("doc_type") or "규정",
        "categories": head.get("categories") or ([head["category"]] if head.get("category") else []),
        "version": head.get("version") or "v1",
        "effective_date": head.get("effective_date"),
        "source_file": head.get("filename") or f"{doc_id}.pdf",
        "chunks": [
            {
                "chunk_id": c.get("chunk_id") or c["doc_id"],
                "page": c.get("page") or 1,
                "kind": c.get("kind") or "text",
                "section": c.get("section") or c.get("subcategory"),
                "text": c["text"],
            }
            for c in ordered
        ],
    }


def corpus_stats() -> dict[str, int]:
    """활성 문서·청크 실측 수 — 관리자 콘솔 'DB·지식베이스' 패널용."""
    return {
        "documents": len({document_id_of(c) for c in _DOCS}),
        "chunks": len(_DOCS),
    }


_CHUNK_BY_ID: dict[str, dict] = {c["doc_id"]: c for c in _DOCS}


# doc 순서 == 인덱스 벡터 순서. 이 리스트로 검색결과 idx를 원문에 매핑한다.
_index_cache: dict[str, faiss.IndexFlatIP] = {}
_INDEX_DIR = pathlib.Path(__file__).resolve().parent / "rag_data"


def _embed_openai(settings: Settings, texts: list[str]) -> np.ndarray:
    client = OpenAI(api_key=settings.openai_api_key)
    response = client.embeddings.create(model=_OPENAI_EMBEDDING_MODEL, input=texts)
    vectors = np.array([item.embedding for item in response.data], dtype="float32")
    faiss.normalize_L2(vectors)
    return vectors


def _embed_ollama(settings: Settings, texts: list[str]) -> np.ndarray:
    response = httpx.post(
        f"{settings.ollama_base_url}/api/embed",
        json={"model": _OLLAMA_EMBEDDING_MODEL, "input": texts},
        timeout=60,
    )
    response.raise_for_status()
    vectors = np.array(response.json()["embeddings"], dtype="float32")
    faiss.normalize_L2(vectors)
    return vectors


def _embed(settings: Settings, texts: list[str]) -> np.ndarray:
    if settings.use_local_models:
        return _embed_ollama(settings, texts)
    return _embed_openai(settings, texts)


def _corpus_fingerprint() -> str:
    """코퍼스 내용 지문. 영속 인덱스가 지금 코퍼스로 만들어졌는지 판별한다.

    개수(index.ntotal)만 보면 재전처리로 **내용만** 바뀐 경우(청크 수는 그대로)를 놓쳐
    낡은 벡터를 새 문서에 붙여 검색하게 된다 — 에러 없이 결과만 틀린다.
    """
    digest = hashlib.sha256()
    for doc in _DOCS:
        digest.update(str(doc.get("doc_id", "")).encode("utf-8"))
        digest.update(b"\x00")
        digest.update(str(doc.get("text", "")).encode("utf-8"))
        digest.update(b"\x01")
    return digest.hexdigest()[:16]


def _ensure_index(settings: Settings) -> faiss.IndexFlatIP:
    cache_key = "local" if settings.use_local_models else "cloud"
    if cache_key in _index_cache:
        return _index_cache[cache_key]

    # 디스크 영속 인덱스가 지금 코퍼스와 일치하면 로드(1,153청크 재임베딩 회피 — 재시작 빠름).
    # FAISS(Windows)는 비ASCII 경로 IO에 실패("Illegal byte sequence")하므로 ASCII 임시경로를 경유한다.
    persist = _INDEX_DIR / f"faiss_{cache_key}.index"
    stamp = _INDEX_DIR / f"faiss_{cache_key}.fingerprint"
    tmp = pathlib.Path(tempfile.gettempdir()) / f"_karina_faiss_{cache_key}.index"
    fingerprint = _corpus_fingerprint()
    if persist.is_file():
        try:
            saved = stamp.read_text(encoding="utf-8").strip() if stamp.is_file() else None
            shutil.copy(str(persist), str(tmp))
            index = faiss.read_index(str(tmp))
            tmp.unlink(missing_ok=True)
            if index.ntotal == len(_DOCS) and saved == fingerprint:
                _index_cache[cache_key] = index
                return index
            logger.info(
                "FAISS 인덱스가 현재 코퍼스와 불일치 — 재빌드 (청크 %d→%d, 지문 %s→%s)",
                index.ntotal, len(_DOCS), saved, fingerprint,
            )
        except Exception:
            logger.warning("FAISS 인덱스 로드 실패 — 재빌드", exc_info=True)

    # 배치 임베딩 — 큰 코퍼스를 Ollama에 한 번에 넣지 않는다(64개씩).
    texts = [doc["text"] for doc in _DOCS]
    vectors = np.vstack(
        [_embed(settings, texts[i:i + 64]) for i in range(0, len(texts), 64)]
    ).astype("float32")

    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)
    try:
        _INDEX_DIR.mkdir(parents=True, exist_ok=True)
        faiss.write_index(index, str(tmp))      # ASCII 임시경로에 쓰고
        shutil.move(str(tmp), str(persist))     # 유니코드 이동은 파이썬이 처리
        # 지문은 인덱스를 쓴 **뒤에** 남긴다 — 중간에 실패하면 지문이 없어 다음 기동에 재빌드된다.
        stamp.write_text(fingerprint, encoding="utf-8")
    except Exception:
        logger.warning("FAISS 인덱스 영속 실패(무해 — 다음 기동 시 재빌드)", exc_info=True)
    _index_cache[cache_key] = index
    return index


def register_chunks(settings: Settings, chunks: list[dict]) -> int:
    """새로 적재된 규정 청크를 코퍼스·FAISS 인덱스에 즉시 반영한다.

    업로드 직후 바로 검색되게 하려고 전체 재빌드(1,187청크 재임베딩) 대신 새 벡터만
    `index.add()` 한다 — _DOCS 순서와 인덱스 순서가 일치해야 하므로 append 순서를 지킨다.
    현재 임베딩 모드(local/cloud)의 인덱스만 갱신하고, 반대편은 캐시·영속파일을 버려
    다음 사용 시 재빌드되게 한다(모델이 다르면 벡터를 섞을 수 없다).
    """
    if not chunks:
        return 0

    _DOCS.extend(chunks)
    _CHUNK_BY_ID.update({c["doc_id"]: c for c in chunks})

    cache_key = "local" if settings.use_local_models else "cloud"
    for other in [k for k in list(_index_cache) if k != cache_key]:
        _index_cache.pop(other, None)
        (_INDEX_DIR / f"faiss_{other}.index").unlink(missing_ok=True)
        (_INDEX_DIR / f"faiss_{other}.fingerprint").unlink(missing_ok=True)

    index = _index_cache.get(cache_key)
    if index is None:
        # 아직 인덱스가 없으면 다음 검색 때 새 코퍼스 전체로 자연히 빌드된다.
        (_INDEX_DIR / f"faiss_{cache_key}.index").unlink(missing_ok=True)
        (_INDEX_DIR / f"faiss_{cache_key}.fingerprint").unlink(missing_ok=True)
        return len(chunks)

    vectors = np.vstack(
        [_embed(settings, [c["text"] for c in chunks[i:i + 64]])
         for i in range(0, len(chunks), 64)]
    ).astype("float32")
    index.add(vectors)

    # 영속 인덱스도 갱신 — 안 하면 ntotal != len(_DOCS)라 다음 기동 시 전체 재빌드된다.
    # (FAISS Windows 비ASCII 경로 회피는 _ensure_index와 동일한 임시경로 경유 방식)
    try:
        tmp = pathlib.Path(tempfile.gettempdir()) / f"_karina_faiss_{cache_key}.index"
        faiss.write_index(index, str(tmp))
        shutil.move(str(tmp), str(_INDEX_DIR / f"faiss_{cache_key}.index"))
        # 지문도 함께 갱신 — 안 하면 다음 기동에서 불일치로 판정돼 전체 재임베딩된다.
        (_INDEX_DIR / f"faiss_{cache_key}.fingerprint").write_text(
            _corpus_fingerprint(), encoding="utf-8"
        )
    except Exception:
        logger.warning("FAISS 인덱스 영속 실패(무해 — 다음 기동 시 재빌드)", exc_info=True)

    logger.info("규정 청크 %d개 인덱스 반영 (총 %d)", len(chunks), len(_DOCS))
    return len(chunks)


# 질의 키워드 → 부서 대분류 추론(김동희 taxonomy). 관련성 향상용 소프트 필터.
_DEPT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "INV": ("연금", "irp", "퇴직연금", "isa", "노후", "개인형퇴직"),
    "LON": ("대출", "여신", "상환", "이자", "신용대출", "담보", "중도상환"),
    "FX": ("외환", "환전", "외화", "달러", "해외송금", "환율"),
    "DEP": ("예금", "적금", "청약", "통장", "입출금", "발행어음", "만기", "수신"),
}


# 추론 부서 가점. 코사인 점수(대략 0.5~0.8) 대비 작게 잡아 "동점이면 해당 부서 우선"
# 정도로만 작동하게 한다. 크면 배제와 다를 바 없어져 관련성 높은 타 부서를 밀어낸다.
_INFERRED_BOOST = 0.05


def _infer_categories(query: str) -> list[str] | None:
    """질의에서 부서 대분류를 추론한다. 매칭 없으면 None(전체 검색)."""
    low = query.lower()
    hits = [code for code, kws in _DEPT_KEYWORDS.items() if any(k in low for k in kws)]
    return hits or None


def search_procedures(
    settings: Settings,
    query: str,
    top_k: int = 3,
    categories: list[str] | None = None,
) -> list[RagDocument]:
    """규정 청크를 벡터 검색. categories가 주어지면 그 대분류(taxonomy 코드)로 좁힌다.

    벡터저장소 통일(2026-07-21): pgvector가 준비돼 있으면(확장+시드) 팀 표준 pgvector
    하이브리드 검색을 쓰고, 아직 없으면 기존 FAISS로 자동 폴백한다. 어느 경로든 반환
    타입(list[RagDocument])과 필터 의미는 동일하다 — pipeline.py 호출부는 바뀌지 않는다.

    categories 필터는 김민기 설계 4절의 핵심 — 통화 용건 대분류에 맞는 규정만 추천.
    예: 긴급(EMERGENCY) 통화면 categories=["SG"]로 사고·신고 규정만. None이면 전체 검색.

    호출자가 지정한 categories는 **하드 필터**지만, 질의에서 추론한 부서는 **소프트 가점**만
    준다(2026-07-23). 하드로 쓰면 "카드가 해외에서 250달러 결제" 같은 문장에서 '달러' 한
    단어가 FX를 고정시켜, 관련성이 훨씬 높은 카드(CRD) 규정이 후보에서 통째로 배제된다.
    """
    boost_categories = None
    if categories is None:
        # 추론은 가점용으로만 쓴다(연금→INV 등 관련성↑). 배제하지 않는다.
        boost_categories = _infer_categories(query)

    from app.services import rag_store  # 지연 import — 순환참조 회피

    if rag_store.pgvector_ready(settings):
        try:
            # pgvector 경로는 추론 가점을 적용하지 않는다 — 하드 필터만 넘겨 배제를 피한다.
            return rag_store.search_regulations(settings, query, top_k, categories)
        except Exception:  # pgvector 경로 실패 시 데모가 끊기지 않게 FAISS로 폴백
            logger.warning("pgvector 검색 실패 — FAISS로 폴백", exc_info=True)
    return _search_faiss(settings, query, top_k, categories, boost_categories)


def _search_faiss(
    settings: Settings,
    query: str,
    top_k: int = 3,
    categories: list[str] | None = None,
    boost_categories: list[str] | None = None,
) -> list[RagDocument]:
    """FAISS(인메모리) 폴백 검색. pgvector 미준비 시 사용. 코퍼스가 작아 전체를
    점수순으로 받아 파이썬에서 필터 후 top_k를 취한다(필터 정확).

    categories = 호출자가 지정한 **하드 필터**(그 부서만).
    boost_categories = 질의에서 추론한 부서의 **소프트 가점**(배제하지 않는다).
    """
    index = _ensure_index(settings)

    allowed = {c.upper() for c in categories} if categories else None
    boosted = {c.upper() for c in boost_categories} if boost_categories else set()

    query_vector = _embed(settings, [query])
    # 필터가 있으면 후보가 걸러지므로 전체를 훑어 점수순으로 확보한다.
    search_k = len(_DOCS)
    scores, indices = index.search(query_vector, search_k)

    # (정렬점수, 원점수, 코퍼스 인덱스) — RagDocument는 최종 top_k만 만든다.
    ranked: list[tuple[float, float, int]] = []
    spare: list[tuple[float, float, int]] = []   # 하드 필터에 걸러진 것(빈손 방지용)
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0:
            continue
        category = _DOCS[idx].get("category")
        raw = float(score)
        if allowed is not None and category not in allowed:
            spare.append((raw, raw, idx))
            continue
        ranked.append((raw + (_INFERRED_BOOST if category in boosted else 0.0), raw, idx))

    ranked.sort(key=lambda row: row[0], reverse=True)
    picked = ranked[:top_k]
    if len(picked) < top_k:   # 지정 부서 후보가 모자라면 관련성 순으로 채운다(빈손 방지)
        picked = picked + spare[: top_k - len(picked)]

    # 가점은 "무엇을 고를지"에만 쓰고, 내보내는 순서는 원점수 기준으로 되돌린다.
    # 그래야 화면에 표시되는 score가 정렬과 어긋나 보이지 않는다.
    picked.sort(key=lambda row: row[1], reverse=True)

    return [
        RagDocument(
            doc_id=_DOCS[idx]["doc_id"],
            title=_DOCS[idx]["title"],
            excerpt=_DOCS[idx]["text"],
            score=round(raw, 3),
            category=_DOCS[idx].get("category"),
            subcategory=_DOCS[idx].get("subcategory"),
        )
        for _rank, raw, idx in picked
    ]
