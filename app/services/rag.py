"""5단계: RAG — 규정/매뉴얼/절차 문서를 벡터DB(FAISS)에서 검색.

⚠️ 임시 구현 — 원래 RAG·브리핑 카드 로직은 김민기 담당(팀 R&R 최종안 기준). 이 파일과 더미 규정
문서 5개는 파이프라인이 end-to-end로 돌아가는 걸 보여주기 위한 자리채움이며, 김민기 팀 산출물
(실제 사내 규정·매뉴얼 인덱스, 체크리스트 로직) 도착하면 교체될 예정.

Windows에 C++ 빌드 도구 없이도 설치되도록 chromadb 대신 faiss-cpu(prebuilt wheel)를 사용한다.
임베딩은 OpenAI 임베딩 API(text-embedding-3-small)로 생성하고, 인덱스는 프로세스 메모리에 캐시한다.

MVP는 더미 규정 텍스트 몇 개만 넣어서 파이프라인 동작을 확인한다.
실제 서비스에서는 사내 규정집·업무 매뉴얼 문서를 청크 단위로 적재해야 한다.
"""

import numpy as np
import faiss
from openai import OpenAI

from app.schemas import RagDocument

_EMBEDDING_MODEL = "text-embedding-3-small"

_DUMMY_DOCS = [
    {
        "doc_id": "proc-001",
        "title": "지급정지 신청 절차",
        "text": (
            "고객이 보이스피싱으로 인한 계좌이체 피해를 신고하면 즉시 해당 계좌에 대한 "
            "지급정지를 신청해야 한다. 지급정지는 피해자 본인 또는 명의인의 요청으로 접수 가능하며, "
            "경찰 신고 접수번호가 있으면 처리 속도가 빨라진다. 지급정지 후 24시간 이내 "
            "금융감독원 피해구제 신청을 안내한다."
        ),
    },
    {
        "doc_id": "proc-002",
        "title": "원격제어 앱 설치 피해 대응",
        "text": (
            "고객이 원격제어 앱(예: 팀뷰어 유사 앱)을 설치했다고 답변하면, 즉시 해당 앱 삭제와 "
            "휴대폰 재부팅을 안내하고, 공동인증서 재발급 및 계좌 비밀번호 변경을 함께 안내한다. "
            "통제권을 완전히 상실한 정황이 있으면 사고전문 상담사로 즉시 이관한다."
        ),
    },
    {
        "doc_id": "proc-003",
        "title": "인증정보 노출 시 대응",
        "text": (
            "계좌 비밀번호, 보안카드 번호, OTP, 인증번호 등이 타인에게 노출된 경우, "
            "즉시 비밀번호 변경과 보안카드/OTP 재발급을 안내하고 최근 거래내역을 "
            "함께 확인하여 미승인 거래 여부를 점검한다."
        ),
    },
    {
        "doc_id": "proc-004",
        "title": "반복 민원 및 이전 해결 실패 사례 처리",
        "text": (
            "동일 사건으로 반복 연락하거나 이전 상담에서 문제가 해결되지 않은 경우, "
            "이전 상담 이력을 먼저 조회하여 중복 안내를 피하고, 숙련 상담사 또는 "
            "전담 부서로 우선 배정한다."
        ),
    },
    {
        "doc_id": "proc-005",
        "title": "피해 정보 미확정 시 확인 절차",
        "text": (
            "피해 금액, 송금 시각, 지급정지 여부 등 핵심 정보가 확인되지 않은 상태로 "
            "상담이 시작되면, 상담사는 통화 초반에 해당 항목을 우선적으로 확인하도록 안내한다."
        ),
    },
]

_index: faiss.IndexFlatIP | None = None
_doc_lookup: list[dict] = []


def _embed(client: OpenAI, texts: list[str]) -> np.ndarray:
    response = client.embeddings.create(model=_EMBEDDING_MODEL, input=texts)
    vectors = np.array([item.embedding for item in response.data], dtype="float32")
    faiss.normalize_L2(vectors)
    return vectors


def _ensure_index(client: OpenAI) -> None:
    global _index, _doc_lookup

    if _index is not None:
        return

    vectors = _embed(client, [doc["text"] for doc in _DUMMY_DOCS])
    dimension = vectors.shape[1]

    index = faiss.IndexFlatIP(dimension)
    index.add(vectors)

    _index = index
    _doc_lookup = _DUMMY_DOCS


def search_procedures(client: OpenAI, query: str, top_k: int = 3) -> list[RagDocument]:
    _ensure_index(client)
    assert _index is not None

    query_vector = _embed(client, [query])
    scores, indices = _index.search(query_vector, top_k)

    documents = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0:
            continue
        doc = _doc_lookup[idx]
        documents.append(
            RagDocument(
                doc_id=doc["doc_id"],
                title=doc["title"],
                excerpt=doc["text"],
                score=round(float(score), 3),
            )
        )

    return documents
