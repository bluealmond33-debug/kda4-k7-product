from __future__ import annotations

import re

from app.services.routing.ars_catalog import ARS_SIMPLE_TASKS, ARS_TASK_KEYWORDS

DEPARTMENTS = {
    1: "일반 상담",
    5: "긴급 상담",
}

BASE_SIMPLE_TASKS = [
    {"code": "S001", "name": "잔액 조회", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
    {"code": "S002", "name": "거래 내역 조회", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
    {"code": "S003", "name": "이체 결과 확인", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
    {"code": "S004", "name": "이체 한도 조회", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
    {"code": "S005", "name": "대출 잔액 조회", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
    {"code": "S006", "name": "영업시간 안내", "department_id": 1, "classification": "SIMPLE", "handler": "AI_CC"},
]
SIMPLE_TASKS = BASE_SIMPLE_TASKS + ARS_SIMPLE_TASKS

GENERAL_TASKS = [
    {"code": "G001", "name": "중계요청·착오송금 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G002", "name": "대출 문의", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G003", "name": "금융거래한도·비대면한도계좌", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G004", "name": "기타·복합 은행 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G005", "name": "거래내역·잔액 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G006", "name": "자동이체 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G007", "name": "만기·연장·해지·수신", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G008", "name": "이자·연체금액", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G009", "name": "부수거래 금리감면", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G010", "name": "환전 문의", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G011", "name": "주택청약 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G012", "name": "연금·IRP 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
    {"code": "G013", "name": "카드 이용 상담", "department_id": 1, "classification": "GENERAL", "handler": "HUMAN"},
]

EMERGENCY_TASKS = [
    {"code": "E001", "name": "보이스피싱 신고", "department_id": 5, "classification": "EMERGENCY", "handler": "HUMAN"},
    {"code": "E002", "name": "이상거래 신고", "department_id": 5, "classification": "EMERGENCY", "handler": "HUMAN"},
]

TASK_CATALOG = SIMPLE_TASKS + GENERAL_TASKS + EMERGENCY_TASKS
TASK_NAMES = {task["code"]: task["name"] for task in TASK_CATALOG}
TASKS_BY_CODE = {task["code"]: task for task in TASK_CATALOG}

BANK_TOPIC_TO_TASK_CODE = {
    "중계요청/착오송금": "G001",
    "대출문의(만기/연장/조회등)": "G002",
    "금융거래한도/비대면한도계좌": "G003",
    "기타(은행)": "G004",
    "거래내역/잔액조회": "G005",
    "자동이체조회": "G006",
    "만기,연장/해지,수신": "G007",
    "이자/연체금액": "G008",
    "부수거래금리감면": "G009",
    "환전문의": "G010",
}

PHISHING_EXPLICIT = ["보이스피싱", "전화금융사기", "대포통장"]
IMPERSONATION_ACTORS = [
    "검사", "검찰", "경찰", "수사기관", "금융감독원", "금감원",
    "은행 직원", "은행원", "정부기관",
]
SENSITIVE_DEMANDS = [
    "송금", "이체", "현금 전달", "개인정보", "주민번호", "계좌번호",
    "비밀번호", "인증번호", "otp", "보안카드", "앱 설치", "원격제어",
]
THREAT_OR_URGENCY = [
    "범죄 연루", "계좌 동결", "계좌 정지", "체포", "수사", "지금 바로",
    "즉시", "빨리", "비밀", "전화 끊지",
]
UNAUTHORIZED_SIGNALS = [
    "내가 안 한", "제가 안 한", "하지 않은", "모르는", "본인 아닌",
    "본인이 아닌", "승인하지 않은", "기억 없는", "쓴 적 없는", "사용한 적 없는",
]
TRANSACTION_SIGNALS = ["결제", "출금", "이체", "송금", "거래", "인출"]
ABNORMAL_EXPLICIT = ["이상거래", "이상 거래", "명의도용", "명의 도용"]

# 해외 승인 알림 + 즉시 정지 요청 = 카드 부정사용 신고. 고객이 "내가 안 한"이라고
# 직접 말하지 않고 위치 모순("전 지금 한국에 있는데")으로 표현하는 경우가 많아
# UNAUTHORIZED_SIGNALS만으로는 놓친다(2026-07-23 시연 전사문에서 확인).
# 사이에 금액이 끼므로("해외에서 250달러 결제") 인접 매칭이 아닌 근접 매칭을 쓴다.
FOREIGN_CHARGE_PATTERN = re.compile(r"(해외|국외|외국)[^.!?]{0,15}?(결제|승인|출금|인출)")
# 단순 문의와 가르는 축 — '정지'가 아니라 **본인이 정지를 요청**하는 표현만 본다.
# ("혹시 정지된 건가요" 같은 질문은 여기 걸리지 않는다.)
STOP_REQUEST_SIGNALS = ["정지시켜", "정지해주", "차단해", "차단시켜", "막아주", "중지시켜"]

TASK_KEYWORDS = {
    "E001": ["보이스피싱", "금융감독원", "검찰", "경찰", "안전계좌", "인증번호", "개인정보"],
    "E002": ["내가 안 한", "본인이 아닌", "모르는 결제", "모르는 출금", "모르는 이체", "해외 결제", "이상거래", "명의도용"],
    "S001": [
        "잔액 조회", "잔액 확인", "잔액 알려", "얼마 남았", "남은 금액",
        "계좌에 얼마", "통장에 얼마", "내 계좌 얼마", "내 통장 얼마",
        "돈 얼마나 있어", "돈 얼마 있어",
    ],
    "S002": ["거래 내역 조회", "거래내역 조회", "입출금 내역 조회", "거래 내역 확인", "입출금 내역 확인"],
    "S003": ["이체 결과 확인", "송금 결과 확인", "이체 완료 여부", "송금 완료 여부", "송금 처리 여부"],
    "S004": ["이체 한도 조회", "송금 한도 조회", "이체 한도 확인", "송금 한도 확인", "하루 이체 한도"],
    "S005": ["대출 잔액 조회", "대출 잔액 확인", "남은 대출금 확인", "대출 얼마나 남았"],
    "S006": [
        "영업시간 안내", "영업시간 알려", "은행 몇 시까지", "은행은 몇 시까지",
        "은행이 몇 시까지", "창구 몇 시까지", "창구는 몇 시까지", "은행 문 여는 시간",
    ],
    # 원래 격식체("착오송금") 위주였는데, 고객은 보통 "실수로 다른 계좌번호로 보내버렸어요"
    # 처럼 말해서 하나도 안 걸렸다(현장 피드백: 라우팅이 G004로 빠져 규정검색도 엉뚱하게 감).
    "G001": [
        "착오송금", "잘못 송금", "잘못 보낸", "송금 반환", "돌려받",
        "실수로 보내", "실수로 송금", "실수로 이체", "다른 계좌번호로 보내",
        "다른 계좌로 잘못", "계좌번호를 잘못", "엉뚱한 계좌", "잘못된 계좌로",
    ],
    "G002": ["대출 조건", "대출 금리", "대출 한도", "상환 조건", "대출 상담"],
    "G003": ["계좌 제한", "계좌 이용 제한", "계좌 정지", "계좌가 정지", "거래 정지", "거래가 정지", "거래 제한", "계좌 잠", "압류"],
    # G005~G013: ML 주제 분류 모델(topic_classifier)이 확신 못 할 때의 규칙 기반 폴백.
    # G004(기타·복합)는 의도된 최종 catch-all이라 여기 넣지 않는다 — 아래 classify_transcript의
    # G004 없는 별도 폴백 루프에서만 검사된다. G011~G013은 학습된 ML 모델의 라벨 집합에
    # 아예 없는 신규 업무라(docs/TASK_TAGS.md 신규 제안 3개) 키워드 규칙에만 의존한다.
    # find_matches는 리터럴 부분일치라 "자동이체를 등록"처럼 단어 사이에 조사(을/를/이/가)가
    # 끼면 "자동이체 등록"과 매칭되지 않는다(S123 카드분실 케이스와 동일한 문제, 위 주석 참고).
    # 조사 유무 두 형태를 함께 나열하거나, 다른 코드와 안 겹치는 단일 명사 어간을 쓴다.
    "G005": [
        "거래내역이 이상", "거래 내역이 이상", "잔액이 이상", "잔액이 안 맞",
        "거래내역이 안 맞", "통장 정리", "거래내역서 발급", "거래내역 정정", "잔액 오류",
    ],
    "G006": ["자동이체", "정기이체"],
    "G007": [
        "예금 만기", "적금 만기", "정기예금 만기", "정기적금 만기",
        "예금이 만기", "적금이 만기",
        "예금 해지", "적금 해지", "정기예금 해지", "정기적금 해지",
        "예금을 해지", "적금을 해지", "정기예금을 해지", "정기적금을 해지",
        "예금 연장", "적금 연장", "예금을 연장", "적금을 연장",
    ],
    "G008": ["연체", "이자가 얼마", "이자는 얼마", "이자 얼마"],
    "G009": [
        "금리 감면", "금리를 감면", "우대금리", "금리 우대", "금리를 우대",
        "금리 할인", "금리를 할인",
    ],
    "G010": ["환전", "환율", "환전 수수료", "외화 환전", "달러 환전", "엔화 환전"],
    "G011": ["주택청약", "청약통장", "청약저축", "청약 계좌", "청약 자격", "청약 신청"],
    "G012": ["연금저축", "개인연금", "퇴직연금", "irp", "연금 계좌", "연금 상담"],
    "G013": ["카드 상담", "카드 관련", "카드 상담사", "카드 상담원", "카드 종합", "카드 복합"],
    **ARS_TASK_KEYWORDS,
}

SIMPLE_BLOCKERS = [
    "문제", "이상", "오류", "실패", "취소", "분쟁", "반환", "잘못",
    "못 받", "안 됨", "안돼", "사라", "피해", "사기", "명의도용",
    "본인 아님", "내가 안 한", "상담사", "직원", "민원", "제한", "정지", "잠김",
]

# These words are part of the official voice-ARS intent itself. Other blockers
# (for example 오류, 분쟁 or 상담사) still force human GENERAL handling.
SIMPLE_ALLOWED_BLOCKERS = {
    "S122": {"정지"},
    "S123": {"신고"},
}

CLASSIFICATION_RULES = [
    {
        "classification": "EMERGENCY",
        "label": "긴급 상담",
        "order": 1,
        "criterion": "보이스피싱 또는 본인 미승인 이상거래 징후가 명확한 상담",
        "result": "긴급 상담 대기열에 최우선 배정",
    },
    {
        "classification": "SIMPLE",
        "label": "단순 업무",
        "order": 2,
        "criterion": "명확한 단일 조회·안내 표현이 있고 문제·오류·분쟁·명의도용·상담사 요청이 없는 상담",
        "result": "ARS·AI CC 처리 가능 안내",
    },
    {
        "classification": "GENERAL",
        "label": "일반 상담",
        "order": 3,
        "criterion": "긴급도 아니고 단순 업무만으로 종결하기 어려운 상담 또는 분류가 불명확한 상담",
        "result": "일반 상담 대기열에 배정",
    },
]


def find_matches(text: str, keywords: list[str]) -> list[str]:
    compact_text = text.replace(" ", "")
    return [
        keyword for keyword in keywords
        if keyword in text or keyword.replace(" ", "") in compact_text
    ]


def classify_transcript(transcript: str) -> dict:
    text = " ".join(transcript.lower().split())

    phishing_explicit = find_matches(text, PHISHING_EXPLICIT)
    actors = find_matches(text, IMPERSONATION_ACTORS)
    demands = find_matches(text, SENSITIVE_DEMANDS)
    threats = find_matches(text, THREAT_OR_URGENCY)
    if phishing_explicit or (actors and demands) or (actors and threats and demands):
        task = TASKS_BY_CODE["E001"]
        matches = list(dict.fromkeys(phishing_explicit + actors + demands + threats))
        return {
            **task,
            "matched_keywords": matches,
            "reason": "보이스피싱 직접 표현 또는 사칭 주체와 민감정보·금전 요구가 함께 감지됨",
        }

    abnormal_explicit = find_matches(text, ABNORMAL_EXPLICIT)
    unauthorized = find_matches(text, UNAUTHORIZED_SIGNALS)
    transactions = find_matches(text, TRANSACTION_SIGNALS)
    # 해외 승인 알림 + 즉시 정지 요청 — 본인 아님을 간접 표현하는 신고를 잡는다.
    foreign_charge = FOREIGN_CHARGE_PATTERN.search(text)
    stop_requests = find_matches(text, STOP_REQUEST_SIGNALS)
    if abnormal_explicit or (unauthorized and transactions) or (foreign_charge and stop_requests):
        task = TASKS_BY_CODE["E002"]
        foreign_matches = ["".join(foreign_charge.groups())] if foreign_charge and stop_requests else []
        matches = list(dict.fromkeys(
            abnormal_explicit + unauthorized + transactions + foreign_matches + stop_requests
        ))
        return {
            **task,
            "matched_keywords": matches,
            "reason": "명의도용·이상거래 직접 표현 또는 본인 미승인 거래 문맥이 감지됨",
        }

    blockers = find_matches(text, SIMPLE_BLOCKERS)
    simple_candidates = []
    for code in (task["code"] for task in SIMPLE_TASKS):
        if code == "S001" and "대출" in text:
            continue
        matches = find_matches(text, TASK_KEYWORDS[code])
        allowed_blockers = SIMPLE_ALLOWED_BLOCKERS.get(code, set())
        disallowed_blockers = [word for word in blockers if word not in allowed_blockers]
        if matches and not disallowed_blockers:
            simple_candidates.append((code, matches))
    if len(simple_candidates) == 1:
        code, matches = simple_candidates[0]
        task = TASKS_BY_CODE[code]
        return {**task, "matched_keywords": matches, "reason": "공식 말로하는 ARS의 단일 자동처리 업무이며 예외 징후가 없음"}
    if len(simple_candidates) > 1:
        task = TASKS_BY_CODE["G004"]
        matches = [keyword for _, keywords in simple_candidates for keyword in keywords]
        return {**task, "matched_keywords": matches, "reason": "여러 업무 의도가 함께 감지되어 일반 상담으로 분류"}

    try:
        from app.services.routing.topic_classifier import predict_bank_topic

        topic_result = predict_bank_topic(text)
    except (ImportError, FileNotFoundError, RuntimeError):
        topic_result = None
    if topic_result and topic_result["accepted"]:
        task = TASKS_BY_CODE[BANK_TOPIC_TO_TASK_CODE.get(topic_result["topic"], "G004")]
        return {
            **task,
            "matched_keywords": blockers,
            "bank_topic": topic_result["topic"],
            "topic_margin": topic_result["margin"],
            "reason": "로컬 은행 데이터 학습 모델이 높은 확신도로 일반 업무 주제를 분류",
        }

    for code in (
        "G001", "G002", "G003", "G005", "G006", "G007", "G008", "G009", "G010",
        "G011", "G012", "G013",
    ):
        matches = find_matches(text, TASK_KEYWORDS[code])
        if matches:
            task = TASKS_BY_CODE[code]
            reason = "단순 처리 제외 단어 감지" if blockers else "인간 상담이 필요한 업무 표현 감지"
            return {**task, "matched_keywords": matches + blockers, "reason": reason}

    task = TASKS_BY_CODE["G004"]
    return {
        **task,
        "matched_keywords": blockers,
        "reason": "명확한 단순·긴급 기준에 해당하지 않아 안전하게 일반 상담으로 분류",
    }
