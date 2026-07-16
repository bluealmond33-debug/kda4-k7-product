-- LEGACY REFERENCE ONLY: Railway mvp-1.0 DB에 적용하지 않는다.
-- 활성 조회 경계: backend/app/database.py
-- KDA K7 주요 조회 쿼리
-- 이 파일은 schema.sql -> seed.sql 실행 후 전체를 검증할 수 있도록 구성했다.
-- PREPARE 본문의 $1, $2 ... 자리에 FastAPI DB 드라이버 바인딩 값을 전달한다.

BEGIN;
DEALLOCATE ALL;

-- 1. 고객 기본정보 조회
-- 민감정보 검색용 해시는 결과에 노출하지 않는다.
PREPARE get_customer_basic (bigint) AS
SELECT
    c.customer_id,
    c.customer_number,
    c.full_name_masked,
    c.phone_masked,
    c.account_number_masked,
    c.birth_year,
    c.birth_date_masked,
    c.customer_status,
    c.created_at,
    c.updated_at
FROM customers AS c
WHERE c.customer_id = $1;

-- 2. 고객의 최근 상담내역 5건 조회
PREPARE get_recent_consultation_history (bigint) AS
SELECT
    h.history_id,
    h.inquiry_type,
    h.ai_summary,
    h.resolution_result,
    d.department_code,
    d.department_name,
    h.risk_level,
    h.consulted_at,
    co.counselor_code,
    co.counselor_name
FROM consultation_history AS h
JOIN departments AS d
    ON d.department_id = h.department_id
LEFT JOIN counselors AS co
    ON co.counselor_id = h.counselor_id
WHERE h.customer_id = $1
ORDER BY h.consulted_at DESC, h.history_id DESC
LIMIT 5;

-- 3. 고객의 현재 유효한 주의정보 조회
PREPARE get_customer_cautions (bigint) AS
SELECT
    cc.caution_id,
    cc.caution_type,
    cc.reason,
    cc.severity,
    cc.caution_status,
    cc.registered_at,
    cc.expires_at,
    co.counselor_code AS registered_by_code
FROM customer_cautions AS cc
LEFT JOIN counselors AS co
    ON co.counselor_id = cc.registered_by
WHERE cc.customer_id = $1
  AND cc.caution_status = 'active'
  AND (cc.expires_at IS NULL OR cc.expires_at > CURRENT_TIMESTAMP)
ORDER BY
    CASE cc.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
    END,
    cc.registered_at DESC;

-- 4. 현재 상담 세션 + AI 상담카드 + 선택된 라우팅 + 마스킹 발화 통합 조회
-- 외부 API 경로와 동일하게 external_session_key를 받는다.
PREPARE get_current_session_card (text) AS
SELECT
    s.session_id,
    s.external_session_key,
    s.customer_id,
    c.customer_number,
    c.full_name_masked,
    c.phone_masked,
    c.account_number_masked,
    s.inquiry_type,
    s.session_status,
    s.risk_level AS session_risk_level,
    s.started_at,
    co.counselor_id,
    co.counselor_code,
    co.counselor_name,
    card.card_id,
    card.card_schema_version,
    card.summary,
    card.customer_request,
    card.keywords,
    card.risk_factors,
    card.urgency_level,
    card.risk_level AS card_risk_level,
    card.related_manual_refs,
    card.suggested_opening,
    card.recommended_actions,
    card.confirmation_items,
    card.confirmation_status,
    card.confirmed_at,
    card.generated_at,
    analysis.analysis_status,
    analysis.emotion_temperature_score,
    analysis.emotion_temperature_level,
    analysis.voice_arousal_score,
    analysis.voice_dominance_score,
    analysis.voice_valence_score,
    analysis.negative_activation_score,
    analysis.audio_quality,
    analysis.failure_code,
    route.routing_id,
    route.recommendation_rank,
    route.confidence AS routing_confidence,
    route.rationale AS routing_rationale,
    route.department_code AS recommended_department_code,
    route.department_name AS recommended_department_name,
    route.counselor_code AS recommended_counselor_code,
    route.counselor_name AS recommended_counselor_name,
    route.selected AS routing_selected,
    (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'caution_type', cc.caution_type,
                    'reason', cc.reason,
                    'severity', cc.severity,
                    'registered_at', cc.registered_at,
                    'expires_at', cc.expires_at
                )
                ORDER BY
                    CASE cc.severity
                        WHEN 'critical' THEN 1
                        WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3
                        ELSE 4
                    END,
                    cc.registered_at DESC
            ),
            '[]'::jsonb
        )
        FROM customer_cautions AS cc
        WHERE cc.customer_id = s.customer_id
          AND cc.caution_status = 'active'
          AND (cc.expires_at IS NULL OR cc.expires_at > CURRENT_TIMESTAMP)
    ) AS customer_cautions,
    history_data.recent_consultations,
    utterance_data.masked_utterances
FROM consultation_sessions AS s
JOIN customers AS c
    ON c.customer_id = s.customer_id
LEFT JOIN counselors AS co
    ON co.counselor_id = s.assigned_counselor_id
LEFT JOIN ai_consultation_cards AS card
    ON card.session_id = s.session_id
LEFT JOIN model_analysis_results AS analysis
    ON analysis.analysis_result_id = card.analysis_result_id
LEFT JOIN LATERAL (
    SELECT
        rr.routing_id,
        rr.recommendation_rank,
        rr.confidence,
        rr.rationale,
        rr.selected,
        d.department_code,
        d.department_name,
        rc.counselor_code,
        rc.counselor_name
    FROM routing_recommendations AS rr
    JOIN departments AS d
        ON d.department_id = rr.recommended_department_id
    LEFT JOIN counselors AS rc
        ON rc.counselor_id = rr.recommended_counselor_id
    WHERE rr.session_id = s.session_id
    ORDER BY rr.selected DESC, rr.recommendation_rank
    LIMIT 1
) AS route ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'inquiry_type', recent.inquiry_type,
                'ai_summary', recent.ai_summary,
                'resolution_result', recent.resolution_result,
                'department_name', recent.department_name,
                'risk_level', recent.risk_level,
                'consulted_at', recent.consulted_at
            )
            ORDER BY recent.consulted_at DESC, recent.history_id DESC
        ),
        '[]'::jsonb
    ) AS recent_consultations
    FROM (
        SELECT
            h.history_id,
            h.inquiry_type,
            h.ai_summary,
            h.resolution_result,
            d.department_name,
            h.risk_level,
            h.consulted_at
        FROM consultation_history AS h
        JOIN departments AS d
            ON d.department_id = h.department_id
        WHERE h.customer_id = s.customer_id
        ORDER BY h.consulted_at DESC, h.history_id DESC
        LIMIT 5
    ) AS recent
) AS history_data ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'sequence_no', u.sequence_no,
                'speaker_type', u.speaker_type,
                'masked_transcript', u.masked_transcript,
                'spoken_at', u.spoken_at
            )
            ORDER BY u.sequence_no
        ),
        '[]'::jsonb
    ) AS masked_utterances
    FROM utterances AS u
    WHERE u.session_id = s.session_id
) AS utterance_data ON true
WHERE s.external_session_key = $1;

-- 5. 상담사 권한 확인
-- 세 번째 값은 필요한 최소 권한: masked_read, read, manage 중 하나다.
PREPARE check_counselor_permission (bigint, text, text) AS
WITH access_rank(access_level, rank_value) AS (
    VALUES ('masked_read'::text, 1), ('read'::text, 2), ('manage'::text, 3)
), active_permission AS (
    SELECT cp.access_level
    FROM counselor_permissions AS cp
    JOIN counselors AS c
        ON c.counselor_id = cp.counselor_id
       AND c.employment_status = 'active'
    WHERE cp.counselor_id = $1
      AND cp.permission_scope = $2
      AND cp.revoked_at IS NULL
      AND cp.valid_from <= CURRENT_TIMESTAMP
      AND (cp.valid_until IS NULL OR cp.valid_until > CURRENT_TIMESTAMP)
    LIMIT 1
)
SELECT
    COALESCE(granted.rank_value >= required.rank_value, false) AS has_permission,
    permission.access_level
FROM (SELECT $3::text AS required_level) AS requested
LEFT JOIN access_rank AS required
    ON required.access_level = requested.required_level
LEFT JOIN active_permission AS permission
    ON true
LEFT JOIN access_rank AS granted
    ON granted.access_level = permission.access_level;

-- 6. 고객정보 조회로그 저장
-- 권한 조회 결과가 denied여도 감사 목적으로 로그를 남긴다.
PREPARE insert_customer_access_log (
    bigint,
    bigint,
    bigint,
    text,
    text,
    text,
    text,
    inet
) AS
INSERT INTO access_logs (
    counselor_id,
    customer_id,
    session_id,
    information_scope,
    action_type,
    access_purpose,
    result_status,
    request_id,
    source_ip
) VALUES ($1, $2, $3, $4, 'view', $5, $6, $7, $8)
RETURNING
    access_log_id,
    counselor_id,
    customer_id,
    session_id,
    information_scope,
    action_type,
    access_purpose,
    result_status,
    request_id,
    created_at;

-- 7. 기간 내 문의 유형별 상담 건수 집계
PREPARE count_consultations_by_inquiry_type (timestamptz, timestamptz) AS
SELECT
    h.inquiry_type,
    count(*) AS consultation_count,
    count(*) FILTER (WHERE h.risk_level IN ('high', 'critical')) AS high_risk_count
FROM consultation_history AS h
WHERE h.consulted_at >= $1
  AND h.consulted_at < $2
GROUP BY h.inquiry_type
ORDER BY consultation_count DESC, h.inquiry_type;

-- 8. 기준시각 이후 생성된 고위험 현재 상담 조회
PREPARE get_high_risk_consultations (timestamptz, integer) AS
SELECT
    s.session_id,
    s.external_session_key,
    s.customer_id,
    c.customer_number,
    c.full_name_masked,
    s.inquiry_type,
    s.session_status,
    s.risk_level,
    s.started_at,
    card.summary,
    card.urgency_level,
    analysis.emotion_temperature_score,
    analysis.emotion_temperature_level,
    d.department_code AS recommended_department_code,
    d.department_name AS recommended_department_name
FROM consultation_sessions AS s
JOIN customers AS c
    ON c.customer_id = s.customer_id
LEFT JOIN ai_consultation_cards AS card
    ON card.session_id = s.session_id
LEFT JOIN model_analysis_results AS analysis
    ON analysis.analysis_result_id = card.analysis_result_id
LEFT JOIN routing_recommendations AS selected_route
    ON selected_route.session_id = s.session_id
   AND selected_route.selected
LEFT JOIN departments AS d
    ON d.department_id = selected_route.recommended_department_id
WHERE s.risk_level IN ('high', 'critical')
  AND s.created_at >= $1
ORDER BY
    CASE s.risk_level WHEN 'critical' THEN 1 ELSE 2 END,
    s.started_at ASC
LIMIT $2;

-- 9. 상담 세션별 라우팅 후보와 최종 선택 결과 조회
PREPARE get_session_routing_results (text) AS
SELECT
    s.session_id,
    s.external_session_key,
    rr.routing_id,
    rr.recommendation_rank,
    rr.confidence,
    rr.rationale,
    rr.selected,
    d.department_code,
    d.department_name,
    co.counselor_code,
    co.counselor_name,
    rr.model_name,
    rr.model_version,
    rr.created_at
FROM consultation_sessions AS s
JOIN routing_recommendations AS rr
    ON rr.session_id = s.session_id
JOIN departments AS d
    ON d.department_id = rr.recommended_department_id
LEFT JOIN counselors AS co
    ON co.counselor_id = rr.recommended_counselor_id
WHERE s.external_session_key = $1
ORDER BY rr.selected DESC, rr.recommendation_rank;

-- 10. React 계약과 동일한 중첩 JSON 응답 생성
PREPARE get_consultation_card_response (text) AS
SELECT jsonb_build_object(
    'schema_version', '1.0',
    'data', jsonb_build_object(
        'external_session_key', s.external_session_key,
        'session_status', s.session_status,
        'customer', jsonb_build_object(
            'customer_number', c.customer_number,
            'full_name_masked', c.full_name_masked,
            'phone_masked', c.phone_masked,
            'account_number_masked', c.account_number_masked
        ),
        'customer_cautions', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'caution_type', cc.caution_type,
                        'reason', cc.reason,
                        'severity', cc.severity,
                        'registered_at', cc.registered_at,
                        'expires_at', cc.expires_at
                    )
                    ORDER BY
                        CASE cc.severity
                            WHEN 'critical' THEN 1
                            WHEN 'high' THEN 2
                            WHEN 'medium' THEN 3
                            ELSE 4
                        END,
                        cc.registered_at DESC
                ),
                '[]'::jsonb
            )
            FROM customer_cautions AS cc
            WHERE cc.customer_id = s.customer_id
              AND cc.caution_status = 'active'
              AND (cc.expires_at IS NULL OR cc.expires_at > CURRENT_TIMESTAMP)
        ),
        'emotion_temperature', jsonb_build_object(
            'status', COALESCE(analysis.analysis_status, 'pending'),
            'score', analysis.emotion_temperature_score,
            'level', analysis.emotion_temperature_level,
            'label_ko', CASE analysis.emotion_temperature_level
                WHEN 'stable' THEN '안정'
                WHEN 'caution' THEN '주의'
                WHEN 'elevated' THEN '고조'
                ELSE NULL
            END,
            'audio_quality', analysis.audio_quality,
            'failure_code', analysis.failure_code,
            'signals', COALESCE(to_jsonb(card.risk_factors), '[]'::jsonb)
        ),
        'consultation_card', CASE
            WHEN card.card_id IS NULL THEN NULL
            ELSE jsonb_build_object(
                'schema_version', card.card_schema_version,
                'inquiry_type', s.inquiry_type,
                'summary', card.summary,
                'customer_request', card.customer_request,
                'keywords', to_jsonb(card.keywords),
                'risk_factors', to_jsonb(card.risk_factors),
                'urgency_level', card.urgency_level,
                'risk_level', card.risk_level,
                'related_manual_refs', to_jsonb(card.related_manual_refs),
                'suggested_opening', card.suggested_opening,
                'recommended_actions', to_jsonb(card.recommended_actions),
                'confirmation_items', to_jsonb(card.confirmation_items),
                'confirmation_status', card.confirmation_status
            )
        END,
        'routing_result', CASE
            WHEN route.routing_id IS NULL THEN NULL
            ELSE jsonb_build_object(
                'department_code', route.department_code,
                'department_name', route.department_name,
                'counselor_code', route.counselor_code,
                'counselor_name', route.counselor_name,
                'recommendation_rank', route.recommendation_rank,
                'confidence', route.confidence,
                'rationale', route.rationale,
                'selected', route.selected
            )
        END,
        'recent_consultations', history_data.recent_consultations,
        'masked_utterances', utterance_data.masked_utterances
    )
) AS response_body
FROM consultation_sessions AS s
JOIN customers AS c
    ON c.customer_id = s.customer_id
LEFT JOIN ai_consultation_cards AS card
    ON card.session_id = s.session_id
LEFT JOIN model_analysis_results AS analysis
    ON analysis.analysis_result_id = card.analysis_result_id
LEFT JOIN LATERAL (
    SELECT
        rr.routing_id,
        rr.recommendation_rank,
        rr.confidence,
        rr.rationale,
        rr.selected,
        d.department_code,
        d.department_name,
        co.counselor_code,
        co.counselor_name
    FROM routing_recommendations AS rr
    JOIN departments AS d
        ON d.department_id = rr.recommended_department_id
    LEFT JOIN counselors AS co
        ON co.counselor_id = rr.recommended_counselor_id
    WHERE rr.session_id = s.session_id
    ORDER BY rr.selected DESC, rr.recommendation_rank
    LIMIT 1
) AS route ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'inquiry_type', recent.inquiry_type,
                'ai_summary', recent.ai_summary,
                'resolution_result', recent.resolution_result,
                'department_name', recent.department_name,
                'risk_level', recent.risk_level,
                'consulted_at', recent.consulted_at
            ) ORDER BY recent.consulted_at DESC, recent.history_id DESC
        ),
        '[]'::jsonb
    ) AS recent_consultations
    FROM (
        SELECT
            h.history_id,
            h.inquiry_type,
            h.ai_summary,
            h.resolution_result,
            d.department_name,
            h.risk_level,
            h.consulted_at
        FROM consultation_history AS h
        JOIN departments AS d
            ON d.department_id = h.department_id
        WHERE h.customer_id = s.customer_id
        ORDER BY h.consulted_at DESC, h.history_id DESC
        LIMIT 5
    ) AS recent
) AS history_data ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'sequence_no', u.sequence_no,
                'speaker_type', u.speaker_type,
                'masked_transcript', u.masked_transcript,
                'spoken_at', u.spoken_at
            ) ORDER BY u.sequence_no
        ),
        '[]'::jsonb
    ) AS masked_utterances
    FROM utterances AS u
    WHERE u.session_id = s.session_id
) AS utterance_data ON true
WHERE s.external_session_key = $1;

-- 실행 검증용 예시. 트랜잭션을 ROLLBACK하므로 6번 로그도 실제로 저장되지 않는다.
EXECUTE get_customer_basic(1);
EXECUTE get_recent_consultation_history(1);
EXECUTE get_customer_cautions(2);
EXECUTE get_current_session_card('K7-SESSION-0002');
EXECUTE check_counselor_permission(3, 'utterances', 'read');
EXECUTE insert_customer_access_log(
    2,
    1,
    1,
    'customer_basic',
    'queries.sql 실행 검증',
    'success',
    'K7-QUERY-VERIFY-001',
    inet '127.0.0.1'
);
EXECUTE count_consultations_by_inquiry_type(
    timestamptz '2026-06-01 00:00:00+09',
    timestamptz '2026-07-01 00:00:00+09'
);
EXECUTE get_high_risk_consultations(
    timestamptz '2026-07-01 00:00:00+09',
    20
);
EXECUTE get_session_routing_results('K7-SESSION-0001');
EXECUTE get_consultation_card_response('K7-SESSION-0001');

ROLLBACK;
