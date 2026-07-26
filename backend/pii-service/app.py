"""KARI-NA pii-service — 개인정보 격리 서버 (온프레미스 데모)

설계: docs/superpowers/specs/2026-07-21-live-call-streaming-stt-design.md §4.4
핵심 원칙:
  - 고객 식별정보·계좌·거래내역·본인인증은 **오직 이 서비스**만 보유한다.
  - **AI 백엔드(backend/)는 이 서비스를 호출하지 않는다.** 상담사(agent) 웹만, 그것도
    본인인증 성공 이후에 호출한다 → "AI는 대화 내용만 보고 민감정보 원문엔 손대지 않는다".
  - 자체 저장소(SQLite `pii.db`)를 쓴다. AI 백엔드는 이 DB에 연결 문자열/자격증명이 없다
    → 별도 프로세스 + 별도 포트 + 별도 데이터스토어로 실제 접근 경계가 생긴다.
  - 데모용 **가상 고객 데이터만** 시드한다(실제 개인정보 절대 금지).

실행(호스트):
  cd pii-service
  ../backend/.venv/Scripts/python.exe -m uvicorn app:app --host 0.0.0.0 --port 8100
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = Path(__file__).resolve().parent / "pii.db"

# 프론트(상담사 웹)만 접근. AI 백엔드(8000)는 여기 없음 — 의도적.
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.11.135:5173",
    "http://192.168.137.1:5173",  # 핫스팟 전환 대비
    "http://localhost:4173",       # vite preview(프로덕션 빌드)
    "http://127.0.0.1:4173",
    "http://192.168.11.135:4173",
]

# --- 데모 가상 고객 (프론트 demoContent.ts CUSTOMER/SHEETS와 동일 모양) ---
_DEMO_CUSTOMER = {
    "id": "c1",
    "name": "이정민",
    "masked": "이*민",
    "phoneMasked": "010-****-4821",
    "type": "개인 고객",
    # 본인확인 대조 정답(가상). 원문은 응답으로 절대 반환하지 않는다.
    # birth는 프론트가 **8자리(YYYYMMDD)**로 보낸다 — 화면 안내도 "생년월일 여덟 자리"다.
    # 여기 6자리로 두면 서비스가 떠 있을 때만 대조가 실패해(꺼져 있으면 프론트 폴백이 통과)
    # 재현이 까다로운 어긋남이 된다. src/data/demoContent.ts의 authAnswers와 같은 값을 쓴다.
    "auth": {"phone": "4821", "birth": "19990303", "account": "4821"},
    "accounts": {
        "title": "보유 계좌 및 카드 현황",
        "file": "고객보유상품_조회.xlsx",
        "sheet": "보유상품",
        "cols": [
            {"l": "구분", "w": 70}, {"l": "상품명", "w": 180}, {"l": "번호", "w": 160},
            {"l": "상태", "w": 70}, {"l": "개설일", "w": 96},
        ],
        "rows": [
            ["입출금", "키움 주거래 통장", "***-**-4821", "정상", "2019.03.11"],
            ["적금", "키움 자유적금", "***-**-7745", "정상", "2022.06.01"],
            ["체크카드", "키움 체크카드", "****-****-**-2231", "정상", "2019.03.11"],
            ["대출", "신용대출", "***-**-9902", "정상", "2024.01.20"],
        ],
    },
    "history": {
        "title": "과거 상담 이력",
        "file": "상담이력_조회.xlsx",
        "sheet": "2026",
        "cols": [
            {"l": "날짜", "w": 96}, {"l": "채널", "w": 64}, {"l": "상담 유형", "w": 170},
            {"l": "결과", "w": 80}, {"l": "담당 상담사", "w": 100},
        ],
        "rows": [
            ["2026.07.02", "전화", "카드 › 분실신고", "완결", "김하나"],
            ["2026.05.18", "챗봇", "수신 › 이체한도 상향", "완결", "자동화"],
            ["2026.03.09", "전화", "전자금융 › OTP 재발급", "완결", "박지성"],
            ["2026.02.14", "전화", "대출 › 상환일정 문의", "완결", "이수민"],
            ["2025.12.30", "앱", "수신 › 예금 만기 안내", "완결", "자동화"],
            ["2025.11.07", "전화", "카드 › 한도 상향", "완결", "김하나"],
        ],
    },
}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_and_seed() -> None:
    """자체 저장소 생성 + 가상 고객 시드(멱등)."""
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pii_customers (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                masked        TEXT NOT NULL,
                phone_masked  TEXT NOT NULL,
                type          TEXT NOT NULL,
                auth_phone    TEXT NOT NULL,
                auth_birth    TEXT NOT NULL,
                auth_account  TEXT NOT NULL,
                accounts_json TEXT NOT NULL,
                history_json  TEXT NOT NULL
            )
            """
        )
        c = _DEMO_CUSTOMER
        conn.execute(
            """
            INSERT INTO pii_customers
                (id, name, masked, phone_masked, type,
                 auth_phone, auth_birth, auth_account, accounts_json, history_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, masked=excluded.masked, phone_masked=excluded.phone_masked,
                type=excluded.type, auth_phone=excluded.auth_phone, auth_birth=excluded.auth_birth,
                auth_account=excluded.auth_account, accounts_json=excluded.accounts_json,
                history_json=excluded.history_json
            """,
            (
                c["id"], c["name"], c["masked"], c["phoneMasked"], c["type"],
                c["auth"]["phone"], c["auth"]["birth"], c["auth"]["account"],
                json.dumps(c["accounts"], ensure_ascii=False),
                json.dumps(c["history"], ensure_ascii=False),
            ),
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _init_and_seed()
    yield


app = FastAPI(title="KARI-NA pii-service (개인정보 격리 서버)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VerifyRequest(BaseModel):
    method: str  # "phone" | "birth" | "account"
    value: str   # 사용자가 입력한 자릿수


class VerifyResponse(BaseModel):
    verified: bool
    customer_id: str | None = None


@app.get("/health")
def health() -> dict:
    with _connect() as conn:
        n = conn.execute("SELECT count(*) FROM pii_customers").fetchone()[0]
    return {"status": "ok", "service": "pii-service", "customers": n}


@app.post("/verify", response_model=VerifyResponse)
def verify(body: VerifyRequest) -> VerifyResponse:
    """본인인증 — 입력한 자릿수를 저장된 대조값과 비교. 원문은 반환하지 않는다."""
    col = {"phone": "auth_phone", "birth": "auth_birth", "account": "auth_account"}.get(body.method)
    if not col:
        raise HTTPException(status_code=400, detail="method must be phone|birth|account")
    digits = "".join(ch for ch in (body.value or "") if ch.isdigit())
    with _connect() as conn:
        row = conn.execute(f"SELECT id, {col} AS answer FROM pii_customers").fetchone()
    if row and digits and digits == row["answer"]:
        return VerifyResponse(verified=True, customer_id=row["id"])
    return VerifyResponse(verified=False, customer_id=None)


def _require_customer(customer_id: str) -> sqlite3.Row:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM pii_customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="customer not found")
    return row


@app.get("/customers/{customer_id}")
def get_customer(customer_id: str) -> dict:
    """마스킹된 고객정보. 원문 인증값(auth_*)은 절대 노출하지 않는다."""
    r = _require_customer(customer_id)
    return {
        "id": r["id"], "name": r["name"], "masked": r["masked"],
        "phoneMasked": r["phone_masked"], "type": r["type"],
    }


@app.get("/customers/{customer_id}/accounts")
def get_accounts(customer_id: str) -> dict:
    return json.loads(_require_customer(customer_id)["accounts_json"])


@app.get("/customers/{customer_id}/history")
def get_history(customer_id: str) -> dict:
    return json.loads(_require_customer(customer_id)["history_json"])
