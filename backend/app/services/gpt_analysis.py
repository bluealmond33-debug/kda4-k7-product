"""3단계 GPT 파트: 상담 내용 요약, 담당 부서 분류, 금융 위험/필수확인 정보 추출.

⚠️ 임시 구현 — 원래 이 파트(음성 감정 분석 → 상담 내용 요약 → 담당 부서 라우팅 → Urgency
Score)는 전형진·김설빈 팀 담당(팀 R&R 최종안 기준)이다. 지금 이 GPT 기반 구현은 전체 파이프라인이
end-to-end로 돌아가는 걸 보여주기 위한 자리채움일 뿐, 그쪽 팀의 키워드사전 기반 로직으로 교체될
예정이다. 그쪽 산출물(JSON 또는 함수) 도착하면 이 파일 내용을 교체하면 된다.
"""

import json

from openai import OpenAI

from app.config import settings
from app.routing.taxonomy import normalize_department
from app.schemas import GptAnalysis, RiskFlags

_SYSTEM_PROMPT = """\
너는 보이스피싱 대응 금융 콜센터의 사전 브리핑 보조 AI다.
고객 상담 전사문을 읽고 아래 JSON 스키마 그대로 구조화된 정보를 추출한다.
플래그는 전사문에서 명시적으로 확인되는 경우에만 true로 표시하고,
확인할 수 없으면 false(모른다는 의미)로 남겨라. 과도한 추측을 하지 마라.

department는 **아래 7개 중 하나를 그대로** 답한다. 목록에 없는 이름을 새로 만들지 마라 —
라우팅과 규정검색이 이 이름으로 필터하므로, 목록 밖 이름이 오면 필터가 조용히 풀린다.
애매하면 가장 가까운 것을 고르고, 정말 못 정하겠으면 "수신·예적금"으로 답한다.
수신·예적금, 여신·대출, 카드·결제, 외환·수출입, 전자금융·디지털, 연금·신탁·투자, 사고·신고
(보이스피싱·명의도용·지급정지 등 사고·신고성 건은 반드시 "사고·신고")
"""

_RISK_FLAGS_SCHEMA = {
    "type": "object",
    "properties": {
        "actual_damage_occurred": {"type": "boolean", "description": "실제 금전 피해가 이미 발생했는지"},
        "credential_exposed": {"type": "boolean", "description": "계좌/카드 비밀번호, 인증번호 등 인증정보가 타인에게 노출됐는지"},
        "remote_app_installed": {"type": "boolean", "description": "원격제어 앱을 설치했는지"},
        "control_lost": {"type": "boolean", "description": "휴대폰/계좌 등에 대한 통제권을 상실했는지"},
        "protection_measures_incomplete": {"type": "boolean", "description": "지급정지 등 보호조치가 아직 완료되지 않았는지"},
        "damage_amount_unknown": {"type": "boolean", "description": "피해 금액을 아직 파악하지 못했는지"},
        "transfer_time_unknown": {"type": "boolean", "description": "송금 시각을 아직 파악하지 못했는지"},
        "payment_hold_status_unknown": {"type": "boolean", "description": "지급정지 여부를 아직 파악하지 못했는지"},
        "protection_status_unknown": {"type": "boolean", "description": "보호조치 완료 여부를 아직 파악하지 못했는지"},
        "other_critical_info_missing": {"type": "boolean", "description": "그 외 핵심 정보가 누락됐는지"},
        "multiple_issues_present": {"type": "boolean", "description": "여러 업무/문의가 동시에 존재하는지"},
        "multiple_procedures_applicable": {"type": "boolean", "description": "적용해야 할 절차가 여러 개인지"},
        "repeat_contact_same_case": {"type": "boolean", "description": "동일 사건으로 반복 연락한 것인지"},
        "prior_resolution_failed": {"type": "boolean", "description": "이전 상담에서 해결이 실패했는지"},
    },
    "required": [
        "actual_damage_occurred", "credential_exposed", "remote_app_installed",
        "control_lost", "protection_measures_incomplete", "damage_amount_unknown",
        "transfer_time_unknown", "payment_hold_status_unknown", "protection_status_unknown",
        "other_critical_info_missing", "multiple_issues_present", "multiple_procedures_applicable",
        "repeat_contact_same_case", "prior_resolution_failed",
    ],
    "additionalProperties": False,
}

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "상담 내용 2~3문장 요약"},
        "department": {"type": "string", "description": "담당 부서 (수신·예적금/여신·대출/카드·결제/외환·수출입/전자금융·디지털/연금·신탁·투자/사고·신고 중 하나)"},
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "상담 핵심 키워드 3~6개 (예: 이체 오류, 미승인 결제, 환불 요청)",
        },
        "risk_flags": _RISK_FLAGS_SCHEMA,
    },
    "required": ["summary", "department", "keywords", "risk_flags"],
    "additionalProperties": False,
}


def analyze_transcript(client: OpenAI, transcript: str) -> GptAnalysis:
    response = client.chat.completions.create(
        model=settings.openai_chat_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "gpt_analysis", "schema": _RESPONSE_SCHEMA, "strict": True},
        },
    )

    payload = json.loads(response.choices[0].message.content)
    return GptAnalysis(
        summary=payload["summary"],
        department=normalize_department(payload["department"]),
        keywords=payload["keywords"],
        risk_flags=RiskFlags(**payload["risk_flags"]),
    )
