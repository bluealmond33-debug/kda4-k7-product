"""긴급 게이트 — LLM 앞단의 규칙 recall floor (카드 라우터 1단계).

보이스피싱·이상거래처럼 놓치면 금전 사고로 이어지는 발화를 LLM 응답을
기다리지 않고 규칙으로 먼저 잡는다. 여기 걸리면 무조건 SG(사고·신고) 긴급.

규칙 출처(원문 근거, hippo):
- 00 Inbox/2026-07-21-분류기-긴급미탐-핫픽스: 안전계좌·명령형 송금 요구·주체 '수사관'
- 00 Inbox/2026-07-21-routing-edge-cases-contrast-pairs: 판정 원리·하드네거티브
  - A1 기관 사칭: 주체 단독 언급은 정상, 위협·요구가 함께일 때만 긴급
  - A2 부정 표현: "보이스피싱 아니고요"처럼 부정형이면 신호 무효
  - A3 입금 vs 출금: 제3자가 보낸 입금(착오송금)은 일반, 본인 미승인 출금만 긴급
  - A5 민감어 단독: 인증번호·비밀번호 단독 언급은 긴급 아님
- "본인이 부인하는 출금"은 긴급(안전 우선) — 오너 정책 결정(보고서 §A3)

설계 원칙: precision보다 recall(놓치면 사고). 단, 신호 '조합'을 요구해
긴급 큐 오염(과탐)을 막는다. 명령형 요구만 잡고 과거형("보내줬어요")은 제외.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 사칭 주체 — 사법·감독기관은 전화로 계좌·송금·개인정보를 요구하지 않는다
IMPERSONATION_ACTORS = (
    "검찰청",
    "검찰",
    "검사",
    "경찰서",
    "경찰",
    "수사관",
    "금융감독원",
    "금감원",
)

# 명령형 송금·민감정보 요구 (과거형 '보내줬어요'는 제외 — 정상 발화 오탐 방지)
SENSITIVE_DEMANDS = (
    "돈을 보내",
    "돈 보내",
    "보내라",
    "보내래",
    "보내달",
    "보내 달",
    "송금해",
    "송금하라",
    "이체해",
    "이체하라",
    "입금해",
    "입금하라",
    "비밀번호를 알려",
    "비밀번호 알려",
    "인증번호를 알려",
    "인증번호 알려",
    "인증번호 불러",
)

# 위협 — 체포·수사·범죄 연루 협박
THREATS = (
    "체포",
    "구속",
    "영장",
    "범죄에 연루",
    "범죄 연루",
    "수사 대상",
    "형사 처벌",
)

# 피싱 정황어 — 단독으로는 긴급 아님, 주체·요구·위협과 함께일 때만
PHISHING_SCAM_TERMS = ("안전계좌", "안전 계좌")

# 명시적 피해 신고 — 부정형이 아니면 그 자체로 긴급
PHISHING_EXPLICIT = ("보이스피싱", "피싱을 당", "피싱 당", "사기를 당", "사기 당")

# 본인 미승인 출금(이상거래): 부인 표현 + 출금 방향 표현이 함께일 때
DENIAL_TERMS = (
    "하지도 않은",
    "하지 않은",
    "안 쓴",
    "쓴 적 없",
    "쓴 적이 없",
    "사용하지 않은",
    "사용한 적 없",
    "결제한 적 없",
    "모르는 결제",
    "모르는 출금",
    "본인 모르게",
)
OUTFLOW_TERMS = ("출금", "결제", "빠져나갔", "빠져나감", "이체됐", "이체가 됐", "인출")

# 원격제어앱 설치 — 통제권 상실 신호
REMOTE_CONTROL_TERMS = ("원격제어", "원격 제어", "원격조종", "팀뷰어", "애니데스크")
INSTALL_TERMS = ("깔았", "깔라", "설치")

# 부정 마커 — 신호어 바로 뒤 짧은 창 안에 있으면 그 신호 무효 (원리 A2)
_NEGATION_MARKERS = ("아니", "아닌", "아니고", "아니에요", "아닙니다", "아니라")
_NEGATION_WINDOW = 8  # 신호어 끝에서 이만큼 안의 부정 마커만 무효로 인정


@dataclass(frozen=True)
class EmergencyGateResult:
    is_emergency: bool
    signals: tuple[str, ...] = field(default_factory=tuple)
    reason: str | None = None


def _match(text: str, term: str) -> bool:
    """부정형이 붙지 않은 신호어 등장 여부. ("보이스피싱 아니고요" → 무효)"""
    start = text.find(term)
    while start != -1:
        window = text[start + len(term) : start + len(term) + _NEGATION_WINDOW]
        if not any(marker in window for marker in _NEGATION_MARKERS):
            return True
        start = text.find(term, start + 1)
    return False


def _matched_terms(text: str, terms: tuple[str, ...]) -> list[str]:
    return [term for term in terms if _match(text, term)]


def check_emergency(text: str) -> EmergencyGateResult:
    """발화 텍스트를 규칙으로 검사해 긴급(SG) 여부를 즉시 판정한다."""
    normalized = " ".join((text or "").split())
    if not normalized:
        return EmergencyGateResult(is_emergency=False)

    actors = _matched_terms(normalized, IMPERSONATION_ACTORS)
    demands = _matched_terms(normalized, SENSITIVE_DEMANDS)
    threats = _matched_terms(normalized, THREATS)
    scam_terms = _matched_terms(normalized, PHISHING_SCAM_TERMS)
    explicit = _matched_terms(normalized, PHISHING_EXPLICIT)
    denial = _matched_terms(normalized, DENIAL_TERMS)
    outflow = _matched_terms(normalized, OUTFLOW_TERMS)
    remote = _matched_terms(normalized, REMOTE_CONTROL_TERMS)
    install = _matched_terms(normalized, INSTALL_TERMS)

    signals: list[str] = []
    reasons: list[str] = []

    # ① 명시적 피해 신고 ("보이스피싱 당한 것 같아요")
    if explicit:
        signals += [f"명시신고:{term}" for term in explicit]
        reasons.append("피해 신고 표현")
    # ② 기관 사칭 + (요구 또는 위협) — 주체 단독은 잡지 않음 (원리 A1)
    if actors and (demands or threats):
        signals += [f"사칭주체:{term}" for term in actors]
        signals += [f"요구:{term}" for term in demands]
        signals += [f"위협:{term}" for term in threats]
        reasons.append("기관 사칭 + 금전·정보 요구/위협")
    # ③ 안전계좌 등 정황어 + 보조 신호 — 정황어 단독은 잡지 않음
    elif scam_terms and (actors or demands or threats):
        signals += [f"피싱정황:{term}" for term in scam_terms]
        signals += [f"보조신호:{term}" for term in actors + demands + threats]
        reasons.append("피싱 정황어 + 보조 신호")
    # ④ 본인 미승인 출금 — 부인 + 출금 방향 (입금 착오송금은 해당 없음, 원리 A3)
    if denial and outflow:
        signals += [f"부인:{denial[0]}", f"출금:{outflow[0]}"]
        reasons.append("본인 미승인 출금 정황(이상거래)")
    # ⑤ 원격제어앱 설치 — 통제권 상실
    if remote and install:
        signals += [f"원격제어:{remote[0]}"]
        reasons.append("원격제어앱 설치 정황")

    if not reasons:
        return EmergencyGateResult(is_emergency=False)
    return EmergencyGateResult(
        is_emergency=True,
        signals=tuple(dict.fromkeys(signals)),
        reason=" / ".join(reasons),
    )
