-- LEGACY REFERENCE ONLY: Railway mvp-1.0 DB에 적용하지 않는다.
-- 활성 저장 경계: backend/app/database.py
-- K7 백엔드 저장 명령 카탈로그
-- JSON 입력은 database/contracts의 JSON Schema로 먼저 검증한다.
-- 이 파일은 PREPARE 구문을 트랜잭션에서 파싱한 뒤 ROLLBACK하므로 독립 실행해도 데이터를 변경하지 않는다.
-- FastAPI에서는 각 PREPARE의 SQL 본문을 연결 풀의 바인딩 쿼리로 사용한다.

BEGIN;

-- 1. 상담 세션 생성
-- 동일 external_session_key와 customer_id 재요청은 기존 세션을 반환한다.
-- 같은 키가 다른 고객에 사용되면 결과가 없으므로 API는 409를 반환한다.
PREPARE create_consultation_session (text, bigint, text, timestamptz) AS
WITH inserted AS (
    INSERT INTO consultation_sessions (
        external_session_key,
        customer_id,
        channel,
        started_at
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (external_session_key) DO NOTHING
    RETURNING *
)
SELECT *
FROM inserted
UNION ALL
SELECT s.*
FROM consultation_sessions AS s
WHERE s.external_session_key = $1
  AND s.customer_id = $2
  AND s.channel = $3
  AND s.started_at = $4
  AND NOT EXISTS (SELECT 1 FROM inserted)
LIMIT 1;

-- 2. 마스킹된 STT 발화 저장
-- 세션별 sequence_no가 같은 재요청은 내용까지 같을 때만 기존 행을 반환한다.
PREPARE save_masked_utterance (jsonb) AS
WITH payload AS (
    SELECT $1 AS body
), target_session AS (
    SELECT s.session_id
    FROM consultation_sessions AS s, payload AS p
    WHERE s.external_session_key = p.body ->> 'external_session_key'
), saved AS (
    INSERT INTO utterances (
        session_id,
        speaker_type,
        sequence_no,
        masked_transcript,
        contains_sensitive_data,
        stt_confidence,
        spoken_at
    )
    SELECT
        s.session_id,
        p.body ->> 'speaker_type',
        (p.body ->> 'sequence_no')::integer,
        p.body ->> 'masked_transcript',
        (p.body ->> 'contains_sensitive_data')::boolean,
        (p.body ->> 'stt_confidence')::numeric,
        (p.body ->> 'spoken_at')::timestamptz
    FROM target_session AS s, payload AS p
    ON CONFLICT (session_id, sequence_no) DO NOTHING
    RETURNING *
)
SELECT * FROM saved
UNION ALL
SELECT u.*
FROM utterances AS u, target_session AS s, payload AS p
WHERE u.session_id = s.session_id
  AND u.sequence_no = (p.body ->> 'sequence_no')::integer
  AND u.speaker_type = p.body ->> 'speaker_type'
  AND u.masked_transcript = p.body ->> 'masked_transcript'
  AND u.contains_sensitive_data = (p.body ->> 'contains_sensitive_data')::boolean
  AND u.stt_confidence IS NOT DISTINCT FROM (p.body ->> 'stt_confidence')::numeric
  AND u.spoken_at = (p.body ->> 'spoken_at')::timestamptz
  AND NOT EXISTS (SELECT 1 FROM saved)
LIMIT 1;

-- 3. 감정온도 결과 저장
-- result_key가 같은 재요청은 모든 핵심 결과가 같을 때만 기존 행을 반환한다.
PREPARE save_emotion_temperature_result (jsonb) AS
WITH payload AS (
    SELECT $1 AS body
), target_session AS (
    SELECT s.session_id
    FROM consultation_sessions AS s, payload AS p
    WHERE s.external_session_key = p.body ->> 'external_session_key'
), saved AS (
    INSERT INTO model_analysis_results (
        session_id,
        result_key,
        model_name,
        model_version,
        output_schema_version,
        analysis_status,
        emotion_temperature_score,
        emotion_temperature_level,
        voice_arousal_score,
        voice_dominance_score,
        voice_valence_score,
        negative_activation_score,
        audio_quality,
        failure_code,
        generated_at
    )
    SELECT
        s.session_id,
        p.body ->> 'result_key',
        p.body ->> 'model_name',
        p.body ->> 'model_version',
        p.body ->> 'schema_version',
        p.body ->> 'analysis_status',
        (p.body ->> 'emotion_temperature_score')::numeric,
        p.body ->> 'emotion_temperature_level',
        (p.body ->> 'voice_arousal_score')::numeric,
        (p.body ->> 'voice_dominance_score')::numeric,
        (p.body ->> 'voice_valence_score')::numeric,
        (p.body ->> 'negative_activation_score')::numeric,
        p.body ->> 'audio_quality',
        p.body ->> 'failure_code',
        (p.body ->> 'generated_at')::timestamptz
    FROM target_session AS s, payload AS p
    ON CONFLICT (result_key) DO NOTHING
    RETURNING *
)
SELECT * FROM saved
UNION ALL
SELECT analysis.*
FROM model_analysis_results AS analysis, target_session AS s, payload AS p
WHERE analysis.result_key = p.body ->> 'result_key'
  AND analysis.session_id = s.session_id
  AND analysis.model_name = p.body ->> 'model_name'
  AND analysis.model_version = p.body ->> 'model_version'
  AND analysis.output_schema_version = p.body ->> 'schema_version'
  AND analysis.analysis_status = p.body ->> 'analysis_status'
  AND analysis.emotion_temperature_score IS NOT DISTINCT FROM (p.body ->> 'emotion_temperature_score')::numeric
  AND analysis.emotion_temperature_level IS NOT DISTINCT FROM (p.body ->> 'emotion_temperature_level')
  AND analysis.voice_arousal_score IS NOT DISTINCT FROM (p.body ->> 'voice_arousal_score')::numeric
  AND analysis.voice_dominance_score IS NOT DISTINCT FROM (p.body ->> 'voice_dominance_score')::numeric
  AND analysis.voice_valence_score IS NOT DISTINCT FROM (p.body ->> 'voice_valence_score')::numeric
  AND analysis.negative_activation_score IS NOT DISTINCT FROM (p.body ->> 'negative_activation_score')::numeric
  AND analysis.audio_quality = p.body ->> 'audio_quality'
  AND analysis.failure_code IS NOT DISTINCT FROM (p.body ->> 'failure_code')
  AND analysis.generated_at = (p.body ->> 'generated_at')::timestamptz
  AND NOT EXISTS (SELECT 1 FROM saved)
LIMIT 1;

-- 4. 상담카드 저장 또는 최신 결과로 교체
-- 카드 위험도는 생성 당시 AI 값이며 세션 위험도는 운영 기준값으로 함께 갱신한다.
PREPARE upsert_consultation_card (jsonb) AS
WITH payload AS (
    SELECT $1 AS body
), target AS (
    SELECT
        s.session_id,
        ar.analysis_result_id
    FROM consultation_sessions AS s
    CROSS JOIN payload AS p
    LEFT JOIN model_analysis_results AS ar
        ON ar.result_key = p.body ->> 'analysis_result_key'
       AND ar.session_id = s.session_id
    WHERE s.external_session_key = p.body ->> 'external_session_key'
      AND (
          p.body ->> 'analysis_result_key' IS NULL
          OR ar.analysis_result_id IS NOT NULL
      )
), saved_card AS (
    INSERT INTO ai_consultation_cards (
        session_id,
        analysis_result_id,
        card_schema_version,
        summary,
        customer_request,
        keywords,
        risk_factors,
        urgency_level,
        risk_level,
        related_manual_refs,
        suggested_opening,
        recommended_actions,
        confirmation_items,
        confirmation_status,
        confirmed_at,
        model_name,
        model_version,
        generated_at
    )
    SELECT
        t.session_id,
        t.analysis_result_id,
        p.body ->> 'schema_version',
        p.body ->> 'summary',
        p.body ->> 'customer_request',
        ARRAY(SELECT jsonb_array_elements_text(p.body -> 'keywords')),
        ARRAY(SELECT jsonb_array_elements_text(p.body -> 'risk_factors')),
        p.body ->> 'urgency_level',
        p.body ->> 'risk_level',
        ARRAY(SELECT jsonb_array_elements_text(p.body -> 'related_manual_refs')),
        p.body ->> 'suggested_opening',
        ARRAY(SELECT jsonb_array_elements_text(p.body -> 'recommended_actions')),
        ARRAY(SELECT jsonb_array_elements_text(p.body -> 'confirmation_items')),
        p.body ->> 'confirmation_status',
        (p.body ->> 'confirmed_at')::timestamptz,
        p.body ->> 'model_name',
        p.body ->> 'model_version',
        (p.body ->> 'generated_at')::timestamptz
    FROM target AS t, payload AS p
    ON CONFLICT (session_id) DO UPDATE SET
        analysis_result_id = EXCLUDED.analysis_result_id,
        card_schema_version = EXCLUDED.card_schema_version,
        summary = EXCLUDED.summary,
        customer_request = EXCLUDED.customer_request,
        keywords = EXCLUDED.keywords,
        risk_factors = EXCLUDED.risk_factors,
        urgency_level = EXCLUDED.urgency_level,
        risk_level = EXCLUDED.risk_level,
        related_manual_refs = EXCLUDED.related_manual_refs,
        suggested_opening = EXCLUDED.suggested_opening,
        recommended_actions = EXCLUDED.recommended_actions,
        confirmation_items = EXCLUDED.confirmation_items,
        confirmation_status = EXCLUDED.confirmation_status,
        confirmed_at = EXCLUDED.confirmed_at,
        model_name = EXCLUDED.model_name,
        model_version = EXCLUDED.model_version,
        generated_at = EXCLUDED.generated_at
    RETURNING *
), updated_session AS (
    UPDATE consultation_sessions AS s
    SET inquiry_type = p.body ->> 'inquiry_type',
        risk_level = p.body ->> 'risk_level',
        session_status = 'ready'
    FROM saved_card AS card, payload AS p
    WHERE s.session_id = card.session_id
    RETURNING s.session_id
)
SELECT card.*
FROM saved_card AS card
JOIN updated_session AS s USING (session_id);

-- 5. 기존 최종 라우팅 선택 해제
-- 새 후보를 selected=true로 저장하기 직전에 같은 트랜잭션에서 실행한다.
PREPARE clear_selected_routing (text) AS
UPDATE routing_recommendations AS rr
SET selected = false
FROM consultation_sessions AS s
WHERE s.external_session_key = $1
  AND rr.session_id = s.session_id
  AND rr.selected
RETURNING rr.routing_id;

-- 6. 라우팅 후보 저장
PREPARE upsert_routing_candidate (jsonb) AS
WITH payload AS (
    SELECT $1 AS body
), target AS (
    SELECT
        s.session_id,
        d.department_id,
        c.counselor_id
    FROM consultation_sessions AS s
    CROSS JOIN payload AS p
    JOIN departments AS d
        ON d.department_code = p.body ->> 'department_code'
       AND d.is_active
    LEFT JOIN counselors AS c
        ON c.counselor_code = p.body ->> 'counselor_code'
       AND c.department_id = d.department_id
       AND c.employment_status = 'active'
    WHERE s.external_session_key = p.body ->> 'external_session_key'
      AND (
          p.body ->> 'counselor_code' IS NULL
          OR c.counselor_id IS NOT NULL
      )
)
INSERT INTO routing_recommendations (
    session_id,
    recommended_department_id,
    recommended_counselor_id,
    recommendation_rank,
    confidence,
    rationale,
    selected,
    model_name,
    model_version
)
SELECT
    t.session_id,
    t.department_id,
    t.counselor_id,
    (p.body ->> 'recommendation_rank')::smallint,
    (p.body ->> 'confidence')::numeric,
    p.body ->> 'rationale',
    (p.body ->> 'selected')::boolean,
    p.body ->> 'model_name',
    p.body ->> 'model_version'
FROM target AS t, payload AS p
ON CONFLICT (session_id, recommendation_rank) DO UPDATE SET
    recommended_department_id = EXCLUDED.recommended_department_id,
    recommended_counselor_id = EXCLUDED.recommended_counselor_id,
    confidence = EXCLUDED.confidence,
    rationale = EXCLUDED.rationale,
    selected = EXCLUDED.selected,
    model_name = EXCLUDED.model_name,
    model_version = EXCLUDED.model_version
RETURNING *;

-- 7. 상담 종료 및 과거 상담 이력 생성
-- 선택 라우팅 또는 배정 상담사의 부서가 있어야 이력을 생성한다.
PREPARE complete_consultation_session (text, text, timestamptz) AS
WITH target AS (
    SELECT
        s.session_id,
        s.customer_id,
        s.assigned_counselor_id,
        s.inquiry_type,
        s.risk_level,
        card.summary,
        COALESCE(route.recommended_department_id, c.department_id) AS department_id
    FROM consultation_sessions AS s
    JOIN ai_consultation_cards AS card
        ON card.session_id = s.session_id
    LEFT JOIN routing_recommendations AS route
        ON route.session_id = s.session_id
       AND route.selected
    LEFT JOIN counselors AS c
        ON c.counselor_id = s.assigned_counselor_id
    WHERE s.external_session_key = $1
), completed AS (
    UPDATE consultation_sessions AS s
    SET session_status = 'completed',
        ended_at = $3
    FROM target AS t
    WHERE s.session_id = t.session_id
      AND t.department_id IS NOT NULL
      AND $3 >= s.started_at
      AND (s.session_status <> 'completed' OR s.ended_at = $3)
    RETURNING s.session_id
), inserted AS (
    INSERT INTO consultation_history (
        customer_id,
        source_session_id,
        counselor_id,
        inquiry_type,
        ai_summary,
        resolution_result,
        department_id,
        risk_level,
        consulted_at
    )
    SELECT
        t.customer_id,
        t.session_id,
        t.assigned_counselor_id,
        t.inquiry_type,
        t.summary,
        $2,
        t.department_id,
        t.risk_level,
        $3
    FROM target AS t
    JOIN completed AS c USING (session_id)
    ON CONFLICT (source_session_id) DO NOTHING
    RETURNING *
)
SELECT * FROM inserted
UNION ALL
SELECT h.*
FROM consultation_history AS h
JOIN target AS t ON t.session_id = h.source_session_id
WHERE NOT EXISTS (SELECT 1 FROM inserted)
  AND h.resolution_result = $2
  AND h.consulted_at = $3
LIMIT 1;

-- 독립 실행 검증 예시: 모든 변경은 마지막 ROLLBACK으로 취소된다.
EXECUTE create_consultation_session(
    'K7-COMMAND-VERIFY-0001',
    1,
    'voice',
    timestamptz '2026-07-15 10:00:00+09'
);

EXECUTE save_masked_utterance($json$
{
  "schema_version": "1.0",
  "external_session_key": "K7-COMMAND-VERIFY-0001",
  "sequence_no": 1,
  "speaker_type": "customer",
  "masked_transcript": "착오송금 반환 절차를 문의합니다.",
  "contains_sensitive_data": false,
  "stt_confidence": 0.98,
  "spoken_at": "2026-07-15T01:00:10Z"
}
$json$::jsonb);

EXECUTE save_emotion_temperature_result($json$
{
  "schema_version": "1.0",
  "external_session_key": "K7-COMMAND-VERIFY-0001",
  "result_key": "K7-COMMAND-VERIFY-EMOTION-0001",
  "model_name": "k7-emotion-temperature-model",
  "model_version": "0.1.0",
  "analysis_status": "completed",
  "emotion_temperature_score": 55,
  "emotion_temperature_level": "caution",
  "voice_arousal_score": 55,
  "voice_dominance_score": 50,
  "voice_valence_score": 45,
  "negative_activation_score": 30.25,
  "audio_quality": "normal",
  "failure_code": null,
  "generated_at": "2026-07-15T01:00:30Z"
}
$json$::jsonb);

EXECUTE upsert_consultation_card($json$
{
  "schema_version": "1.0",
  "external_session_key": "K7-COMMAND-VERIFY-0001",
  "analysis_result_key": "K7-COMMAND-VERIFY-EMOTION-0001",
  "inquiry_type": "mistaken_transfer",
  "summary": "착오송금 반환 절차 문의",
  "customer_request": "거래 확인 후 반환지원 안내 요청",
  "keywords": ["착오송금"],
  "risk_factors": ["금전 피해 가능성"],
  "urgency_level": "high",
  "risk_level": "high",
  "related_manual_refs": ["전자금융거래-착오송금-12-1"],
  "suggested_opening": "거래 시각부터 확인하겠습니다.",
  "recommended_actions": ["거래내역 확인", "반환지원 안내"],
  "confirmation_items": ["확정적 반환 표현 금지"],
  "confirmation_status": "pending",
  "confirmed_at": null,
  "model_name": "k7-card-model",
  "model_version": "0.1.0",
  "generated_at": "2026-07-15T01:00:40Z"
}
$json$::jsonb);

EXECUTE upsert_routing_candidate($json$
{
  "schema_version": "1.0",
  "external_session_key": "K7-COMMAND-VERIFY-0001",
  "department_code": "remittance",
  "counselor_code": "AGENT002",
  "recommendation_rank": 1,
  "confidence": 0.96,
  "rationale": "착오송금 담당 부서",
  "selected": true,
  "model_name": "k7-router",
  "model_version": "0.1.0"
}
$json$::jsonb);

EXECUTE complete_consultation_session(
    'K7-COMMAND-VERIFY-0001',
    '반환지원 절차 안내 완료',
    timestamptz '2026-07-15 10:15:00+09'
);

ROLLBACK;
