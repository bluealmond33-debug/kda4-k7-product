"""Deterministic first-pass routing with an optional local topic model."""

from app.classification.ars_catalog import ARS_SIMPLE_TASKS, ARS_TASK_KEYWORDS


def _task(code: str, name: str, classification: str, handler: str) -> dict:
    return {"code": code, "name": name, "classification": classification, "handler": handler}


BASE_SIMPLE_TASKS = [
    _task("S001", "잔액 조회", "SIMPLE", "AI_CC"),
    _task("S002", "거래 내역 조회", "SIMPLE", "AI_CC"),
    _task("S003", "이체 결과 확인", "SIMPLE", "AI_CC"),
    _task("S004", "이체 한도 조회", "SIMPLE", "AI_CC"),
    _task("S005", "대출 잔액 조회", "SIMPLE", "AI_CC"),
    _task("S006", "영업시간 안내", "SIMPLE", "AI_CC"),
]
GENERAL_TASKS = [
    _task("G001", "착오송금 상담", "GENERAL", "HUMAN"),
    _task("G002", "대출 문의", "GENERAL", "HUMAN"),
    _task("G003", "금융거래한도·제한계좌", "GENERAL", "HUMAN"),
    _task("G004", "기타·복합 상담", "GENERAL", "HUMAN"),
    _task("G005", "거래내역·잔액 상담", "GENERAL", "HUMAN"),
    _task("G006", "자동이체 상담", "GENERAL", "HUMAN"),
    _task("G007", "만기·연장·해지·수신", "GENERAL", "HUMAN"),
    _task("G008", "이자·연체금액", "GENERAL", "HUMAN"),
    _task("G009", "부수거래 금리감면", "GENERAL", "HUMAN"),
    _task("G010", "환전 문의", "GENERAL", "HUMAN"),
]
EMERGENCY_TASKS = [
    _task("E001", "보이스피싱 신고", "EMERGENCY", "HUMAN"),
    _task("E002", "이상거래 신고", "EMERGENCY", "HUMAN"),
]
TASKS = {task["code"]: task for task in BASE_SIMPLE_TASKS + ARS_SIMPLE_TASKS + GENERAL_TASKS + EMERGENCY_TASKS}

SIMPLE_KEYWORDS = {
    "S001": ["잔액 조회", "잔액 확인", "계좌에 얼마", "통장에 얼마"],
    "S002": ["거래 내역 조회", "입출금 내역 확인"],
    "S003": ["이체 결과 확인", "송금 결과 확인", "송금 처리 여부"],
    "S004": ["이체 한도 조회", "송금 한도 확인"],
    "S005": ["대출 잔액 조회", "남은 대출금 확인"],
    "S006": ["영업시간", "몇 시까지", "문 여는 시간"],
    **ARS_TASK_KEYWORDS,
}
SIMPLE_BLOCKERS = [
    "문제", "이상", "오류", "실패", "취소", "분쟁", "반환", "잘못", "도난", "사기",
    "명의도용", "본인 아님", "내가 안", "상담사", "직원", "민원", "제한", "정지", "신고",
]
PHISHING_EXPLICIT = ["보이스피싱", "전화금융사기", "대포통장"]
IMPERSONATION_ACTORS = ["검사", "검찰", "경찰", "수사기관", "금융감독원", "금감원", "정부기관"]
SENSITIVE_DEMANDS = ["송금", "이체", "개인정보", "주민번호", "계좌번호", "비밀번호", "인증번호", "OTP", "앱 설치"]
UNAUTHORIZED = ["내가 안", "제가 안", "하지 않은", "모르는", "본인 아닌", "승인하지 않은", "기억 없는"]
TRANSACTIONS = ["결제", "출금", "이체", "송금", "거래", "인출"]
ABNORMAL_EXPLICIT = ["이상거래", "명의도용"]
GENERAL_KEYWORDS = {
    "G001": ["착오송금", "잘못 송금", "잘못 보낸", "송금 반환"],
    "G002": ["대출 조건", "대출 금리", "대출 한도", "상환 조건", "대출 상담"],
    "G003": ["계좌 제한", "계좌 정지", "거래 정지", "거래 제한", "압류"],
}
TOPIC_TO_CODE = {
    "중계요청/착오송금": "G001", "대출문의, 만기/연장/조회등": "G002",
    "금융거래한도/비대면한도계좌": "G003", "기타(은행)": "G004",
    "거래내역/잔액조회": "G005", "자동이체조회": "G006",
    "만기,연장/해지,수신": "G007", "이자/연체금액": "G008",
    "부수거래금리감면": "G009", "환전문의": "G010",
}


def _matches(text: str, keywords: list[str]) -> list[str]:
    compact = text.replace(" ", "")
    return [word for word in keywords if word in text or word.replace(" ", "") in compact]


def _result(code: str, matches: list[str], reason: str, **extra) -> dict:
    return {**TASKS[code], "matched_keywords": list(dict.fromkeys(matches)), "reason": reason, **extra}


def classify_transcript(transcript: str) -> dict:
    text = " ".join(transcript.lower().split())
    explicit = _matches(text, PHISHING_EXPLICIT)
    actors = _matches(text, IMPERSONATION_ACTORS)
    demands = _matches(text, SENSITIVE_DEMANDS)
    if explicit or (actors and demands):
        return _result("E001", explicit + actors + demands, "사칭 주체와 금전·민감정보 요구 문맥 감지")

    abnormal = _matches(text, ABNORMAL_EXPLICIT)
    unauthorized = _matches(text, UNAUTHORIZED)
    transactions = _matches(text, TRANSACTIONS)
    if abnormal or (unauthorized and transactions):
        return _result("E002", abnormal + unauthorized + transactions, "본인 미승인 거래 문맥 감지")

    blockers = _matches(text, SIMPLE_BLOCKERS)
    if not blockers:
        candidates = [(code, _matches(text, words)) for code, words in SIMPLE_KEYWORDS.items()]
        candidates = [(code, words) for code, words in candidates if words]
        if len(candidates) == 1:
            code, words = candidates[0]
            return _result(code, words, "명확한 단일 조회·안내 의도이며 예외 징후 없음")
        if len(candidates) > 1:
            return _result("G004", [w for _, words in candidates for w in words], "여러 업무 의도가 함께 감지됨")

    try:
        from app.classification.topic_classifier import predict_bank_topic

        topic = predict_bank_topic(text)
    except (ImportError, FileNotFoundError, RuntimeError):
        topic = None
    if topic and topic["accepted"]:
        code = TOPIC_TO_CODE.get(topic["topic"], "G004")
        return _result(code, blockers, "로컬 은행 주제 모델의 고확신 분류", bank_topic=topic["topic"], topic_margin=topic["margin"])

    for code, keywords in GENERAL_KEYWORDS.items():
        words = _matches(text, keywords)
        if words:
            return _result(code, words + blockers, "인간 상담이 필요한 업무 표현 감지")
    return _result("G004", blockers, "불명확한 발화는 안전하게 일반 상담으로 분류")
