"""Classifier feedback lab: rules, optional EXAONE hybrid, and edge-case memory."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.classification.classifier import TASKS, classify_transcript


DEPARTMENT_NAMES = {
    "DEP": "수신·예적금",
    "LON": "여신·대출",
    "CRD": "카드·결제",
    "FX": "외환",
    "EFN": "전자금융",
    "INV": "연금·투자",
    "SG": "사고·신고",
    "ETC": "기타·공통",
}

CODE_TO_DEPARTMENT = {
    "S001": "DEP", "S002": "DEP", "S003": "EFN", "S004": "EFN",
    "S005": "LON", "S006": "ETC",
    **{code: "CRD" for code in TASKS if code.startswith("S") and int(code[1:]) >= 100},
    "S123": "SG",
    "G001": "SG", "G002": "LON", "G003": "EFN", "G004": "ETC",
    "G005": "DEP", "G006": "DEP", "G007": "DEP", "G008": "LON",
    "G009": "LON", "G010": "FX",
    "E001": "SG", "E002": "SG",
}

# RAG 문서 적재 파이프라인과 공유하는 3층 업무 주제 코드입니다.
# S/G/E task_code는 상담 처리 단위이고 business_code는 규정 검색 단위입니다.
CODE_TO_BUSINESS_CODE = {
    "S001": "deposit", "S002": "deposit", "S003": "efn", "S004": "efn",
    "S005": "loan", "S006": "general",
    **{code: "card" for code in TASKS if code.startswith("S") and int(code[1:]) >= 100},
    "S123": "misremit",
    "G001": "misremit", "G002": "loan", "G003": "efn", "G004": "general",
    "G005": "deposit", "G006": "deposit", "G007": "deposit",
    "G008": "loan", "G009": "loan", "G010": "fx",
    "E001": "misremit", "E002": "misremit",
}

VALID_ROUTINGS = {"SIMPLE", "GENERAL", "EMERGENCY"}
VALID_CODES = set(TASKS)
_LOCK = threading.Lock()


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def feedback_path() -> Path:
    configured = os.environ.get("K7_CLASSIFIER_FEEDBACK_PATH")
    return Path(configured) if configured else _project_root() / "data" / "classifier_feedback" / "edge_cases.jsonl"


def session_directory() -> Path:
    configured = os.environ.get("K7_CLASSIFIER_SESSION_DIR")
    return Path(configured) if configured else feedback_path().parent / "sessions"


def start_review_session() -> dict[str, str]:
    now = datetime.now(timezone.utc)
    session_id = f"{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:6]}"
    path = session_directory() / f"review-{session_id}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "event": "session_started",
        "schema_version": "1.0",
        "session_id": session_id,
        "recorded_at": now.isoformat(),
    }
    with _LOCK, path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(metadata, ensure_ascii=False) + "\n")
    # 학습 후보 마스터 파일도 세션 시작 시 생성해 저장 위치를 명확히 한다.
    master = feedback_path()
    master.parent.mkdir(parents=True, exist_ok=True)
    master.touch(exist_ok=True)
    return {"session_id": session_id, "path": str(path), "filename": path.name}


def list_review_sessions() -> list[dict[str, Any]]:
    """기존 검토 파일을 변경하지 않고 최신순으로 보여준다."""
    directory = session_directory()
    if not directory.exists():
        return []
    sessions = []
    for path in directory.glob("review-*.jsonl"):
        stat = path.stat()
        sessions.append({
            "filename": path.name,
            "size": stat.st_size,
            "modified_at": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
        })
    return sorted(sessions, key=lambda item: item["modified_at"], reverse=True)


def append_session_event(session_id: str, event: dict[str, Any]) -> None:
    if not re.fullmatch(r"\d{8}T\d{6}Z-[0-9a-f]{6}", session_id or ""):
        raise ValueError("올바른 검토 세션 ID가 아닙니다")
    path = session_directory() / f"review-{session_id}.jsonl"
    if not path.exists():
        raise ValueError("검토 세션 파일을 찾을 수 없습니다")
    record = {
        "session_id": session_id,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    with _LOCK, path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")


def _read_records() -> list[dict[str, Any]]:
    path = feedback_path()
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def _latest_correction(text: str) -> dict[str, Any] | None:
    normalized = normalize_text(text)
    for record in reversed(_read_records()):
        if record.get("verdict") == "incorrect" and record.get("normalized_text") == normalized:
            return record.get("correction")
    return None


def _decorate(result: dict[str, Any], *, engine: str, correction_applied: bool = False) -> dict[str, Any]:
    code = result["code"]
    # task_code를 단일 기준으로 삼아 RAG 메타데이터와 어긋난 과거 피드백도 정규화한다.
    department = CODE_TO_DEPARTMENT.get(code, "ETC")
    business_code = CODE_TO_BUSINESS_CODE.get(code, "general")
    return {
        "routing": result["classification"],
        "task_code": code,
        "task_name": result.get("name", TASKS.get(code, {}).get("name", "사용자 수정 업무")),
        "department": department,
        "department_name": DEPARTMENT_NAMES.get(department, department),
        "business_code": business_code,
        "handler": result.get("handler", "HUMAN"),
        "reason": result.get("reason", "분류 근거 없음"),
        "matched_keywords": result.get("matched_keywords", []),
        "engine": engine,
        "correction_applied": correction_applied,
    }


def classify_rules(text: str) -> dict[str, Any]:
    correction = _latest_correction(text)
    if correction:
        corrected = {
            "classification": correction["routing"],
            "code": correction.get("task_code") or "G004",
            "name": correction.get("task_name") or "검토 완료 엣지케이스",
            "department": correction["department"],
            "handler": "HUMAN" if correction["routing"] != "SIMPLE" else "AI_CC",
            "reason": correction.get("reason") or "사용자가 검토한 동일 엣지케이스 판정",
            "matched_keywords": [],
        }
        return _decorate(corrected, engine="edge-case-memory", correction_applied=True)
    return _decorate(classify_transcript(text), engine="rules")


def _catalog_text() -> str:
    rows = []
    for code in sorted(TASKS):
        task = TASKS[code]
        department = CODE_TO_DEPARTMENT.get(code, "ETC")
        business_code = CODE_TO_BUSINESS_CODE.get(code, "general")
        rows.append(f"{code} | {task['classification']} | {department} | {business_code} | {task['name']}")
    return "\n".join(rows)


def exaone_status() -> dict[str, Any]:
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("EXAONE_MODEL", "exaone3.5:7.8b")
    try:
        with urllib.request.urlopen(host + "/api/tags", timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        models = [item.get("name", "") for item in payload.get("models", [])]
        available = model in models or any(name.startswith(model.split(":")[0] + ":") for name in models)
        return {"connected": True, "available": available, "host": host, "model": model, "models": models}
    except Exception as error:  # noqa: BLE001 - status endpoint must never fail the demo
        return {"connected": False, "available": False, "host": host, "model": model, "detail": str(error)}


def classify_exaone(text: str) -> dict[str, Any]:
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    model = os.environ.get("EXAONE_MODEL", "exaone3.5:7.8b")
    timeout = float(os.environ.get("EXAONE_TIMEOUT", "30"))
    prompt = f"""너는 은행 고객센터 라우팅 분류기다.
고객 발화를 아래 카탈로그 중 정확히 하나로 분류한다.
기관명 한 단어만으로 긴급 처리하지 말고 사칭 주체와 금전·민감정보 요구 문맥을 함께 본다.
본인 미승인 출금·결제·송금은 긴급이다. 순수 조회는 단순, 문제·복합·상담사 요청은 일반이다.
카탈로그:\n{_catalog_text()}
JSON만 출력: {{"code":"G004","reason":"한국어 한 문장 근거"}}"""
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"고객 발화:\n{text}"},
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_ctx": 4096},
    }
    request = urllib.request.Request(
        host + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            envelope = json.loads(response.read().decode("utf-8"))
        content = json.loads(envelope["message"]["content"])
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, KeyError) as error:
        raise RuntimeError(f"EXAONE 연결 또는 JSON 해석 실패: {error}") from error

    code = str(content.get("code", "G004")).upper()
    if code not in TASKS:
        code = "G004"
    result = {**TASKS[code], "reason": content.get("reason") or "EXAONE 문맥 분류", "matched_keywords": []}
    return _decorate(result, engine="exaone")


def classify_hybrid(text: str) -> dict[str, Any]:
    base = classify_rules(text)
    if base["correction_applied"]:
        return {**base, "hybrid_stage": "reviewed-edge-case"}
    if base["routing"] == "EMERGENCY":
        return {**base, "engine": "rules(emergency-floor)", "hybrid_stage": "emergency-floor"}
    trigger_codes = {
        item.strip().upper()
        for item in os.environ.get("HYBRID_LLM_CODES", "G004").split(",")
        if item.strip()
    }
    if base["task_code"] not in trigger_codes:
        return {**base, "hybrid_stage": "rules-confident"}
    try:
        result = classify_exaone(text)
        return {**result, "engine": "hybrid(exaone)", "hybrid_stage": "exaone-review", "rules_fallback_code": base["task_code"]}
    except RuntimeError as error:
        return {
            **base,
            "engine": "rules(exaone-unavailable)",
            "hybrid_stage": "safe-fallback",
            "reason": f"{base['reason']} · EXAONE 미연결로 규칙 결과 유지",
            "exaone_error": str(error),
        }


def save_feedback(payload: dict[str, Any]) -> dict[str, Any]:
    text = str(payload.get("text", "")).strip()
    verdict = payload.get("verdict")
    if not text or verdict not in {"correct", "incorrect"}:
        raise ValueError("text와 verdict(correct/incorrect)가 필요합니다")

    correction = payload.get("correction") if verdict == "incorrect" else None
    if verdict == "incorrect":
        if not isinstance(correction, dict):
            raise ValueError("잘못된 판정에는 correction이 필요합니다")
        routing = correction.get("routing")
        task_code = str(correction.get("task_code") or "G004").upper()
        if routing not in VALID_ROUTINGS:
            raise ValueError("수정 routing이 올바르지 않습니다")
        if task_code not in VALID_CODES:
            raise ValueError("수정 업무 코드가 카탈로그에 없습니다")
        if TASKS[task_code]["classification"] != routing:
            raise ValueError("처리 유형과 업무 코드의 S/G/E 구분이 일치하지 않습니다")
        department = CODE_TO_DEPARTMENT.get(task_code, "ETC")
        business_code = CODE_TO_BUSINESS_CODE.get(task_code, "general")
        correction = {
            "routing": routing,
            "department": department,
            "business_code": business_code,
            "task_code": task_code,
            "task_name": correction.get("task_name") or TASKS[task_code]["name"],
            "handler": "AI_CC" if routing == "SIMPLE" else "HUMAN",
            "reason": str(correction.get("reason") or "사용자 검토로 수정"),
        }

    record = {
        "schema_version": "1.0",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "text": text,
        "normalized_text": normalize_text(text),
        "source": payload.get("source", "manual-text"),
        "prediction": payload.get("prediction"),
        "verdict": verdict,
        "correction": correction,
        "tags": list(dict.fromkeys(payload.get("tags") or ["human-reviewed", "edge-case"])),
        "note": str(payload.get("note") or ""),
    }
    path = feedback_path()
    saved_for_training = verdict == "incorrect"
    if saved_for_training:
        path.parent.mkdir(parents=True, exist_ok=True)
        with _LOCK, path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {
        "saved": saved_for_training,
        "path": str(path) if saved_for_training else None,
        "record": record,
        "stats": feedback_stats(),
    }


def feedback_stats() -> dict[str, int]:
    # 과거 버전에서 저장된 correct 행도 통계·학습 후보에서는 제외한다.
    records = [item for item in _read_records() if item.get("verdict") == "incorrect"]
    return {
        "total": len(records),
        "correct": 0,
        "incorrect": len(records),
        "reusable_edge_cases": len({item.get("normalized_text") for item in records}),
    }


def task_catalog() -> list[dict[str, str]]:
    return [
        {
            "code": code,
            "name": task["name"],
            "routing": task["classification"],
            "department": CODE_TO_DEPARTMENT.get(code, "ETC"),
            "business_code": CODE_TO_BUSINESS_CODE.get(code, "general"),
        }
        for code, task in sorted(TASKS.items())
    ]


def training_records() -> list[dict[str, Any]]:
    exported = []
    for item in _read_records():
        if item.get("verdict") != "incorrect":
            continue
        prediction = item.get("prediction") or {}
        correction = item.get("correction") or {}
        label = correction
        task_code = label.get("task_code")
        exported.append({
            "text": item.get("text"),
            "routing": label.get("routing"),
            "department": CODE_TO_DEPARTMENT.get(task_code, "ETC"),
            "business_code": CODE_TO_BUSINESS_CODE.get(task_code, "general"),
            "task_code": task_code,
            "handler": label.get("handler") or ("AI_CC" if label.get("routing") == "SIMPLE" else "HUMAN"),
            "reason": correction.get("reason") or item.get("note") or prediction.get("reason"),
            "tags": item.get("tags", []),
            "reviewed_at": item.get("recorded_at"),
        })
    return exported
