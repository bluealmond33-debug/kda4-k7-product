-- 기존 K7 v1 스키마를 팀 공통 계약 v1.0 구조로 업그레이드한다.
-- 신규 DB는 이 파일 대신 최신 schema.sql만 실행한다.

BEGIN;

ALTER TABLE counselors
    ADD CONSTRAINT counselors_id_department_uk
    UNIQUE (counselor_id, department_id);

ALTER TABLE counselor_permissions
    DROP CONSTRAINT counselor_permissions_scope_uk;

CREATE UNIQUE INDEX uq_counselor_permissions_active_scope
    ON counselor_permissions (counselor_id, permission_scope)
    WHERE revoked_at IS NULL;

ALTER TABLE consultation_sessions
    ALTER COLUMN inquiry_type SET DEFAULT 'unclassified',
    DROP CONSTRAINT consultation_sessions_external_key_not_blank_chk,
    DROP CONSTRAINT consultation_sessions_inquiry_type_chk,
    DROP CONSTRAINT consultation_sessions_status_chk,
    ADD CONSTRAINT consultation_sessions_external_key_length_chk
        CHECK (char_length(btrim(external_session_key)) BETWEEN 1 AND 100),
    ADD CONSTRAINT consultation_sessions_inquiry_type_chk
        CHECK (inquiry_type IN (
            'unclassified',
            'mistaken_transfer',
            'voice_phishing_suspected',
            'lost_card',
            'overseas_payment',
            'account_opening',
            'payment_error',
            'loan',
            'general_inquiry',
            'other'
        )),
    ADD CONSTRAINT consultation_sessions_status_chk
        CHECK (session_status IN (
            'waiting',
            'analyzing',
            'ready',
            'in_progress',
            'summarizing',
            'wrap_up',
            'completed',
            'cancelled'
        ));

ALTER TABLE model_analysis_results
    ADD COLUMN result_key text,
    ADD COLUMN analysis_status text NOT NULL DEFAULT 'completed',
    ADD COLUMN failure_code text;

UPDATE model_analysis_results
SET result_key = 'K7-MIGRATED-EMOTION-' || analysis_result_id::text;

ALTER TABLE model_analysis_results
    ALTER COLUMN result_key SET NOT NULL,
    ALTER COLUMN emotion_temperature_score DROP NOT NULL,
    ALTER COLUMN emotion_temperature_level DROP NOT NULL,
    ADD CONSTRAINT model_analysis_results_result_key_uk UNIQUE (result_key),
    DROP CONSTRAINT model_analysis_results_model_not_blank_chk,
    DROP CONSTRAINT model_analysis_results_temperature_score_chk,
    DROP CONSTRAINT model_analysis_results_temperature_level_chk,
    DROP CONSTRAINT model_analysis_results_temperature_pair_chk,
    ADD CONSTRAINT model_analysis_results_result_key_length_chk
        CHECK (char_length(btrim(result_key)) BETWEEN 1 AND 100),
    ADD CONSTRAINT model_analysis_results_model_length_chk
        CHECK (
            char_length(btrim(model_name)) BETWEEN 1 AND 100
            AND char_length(btrim(model_version)) BETWEEN 1 AND 50
        ),
    ADD CONSTRAINT model_analysis_results_status_chk
        CHECK (analysis_status IN ('completed', 'unavailable', 'failed')),
    ADD CONSTRAINT model_analysis_results_temperature_score_chk
        CHECK (
            emotion_temperature_score IS NULL
            OR emotion_temperature_score BETWEEN 0 AND 100
        ),
    ADD CONSTRAINT model_analysis_results_temperature_level_chk
        CHECK (
            emotion_temperature_level IS NULL
            OR emotion_temperature_level IN ('stable', 'caution', 'elevated')
        ),
    ADD CONSTRAINT model_analysis_results_completed_payload_chk
        CHECK (
            (
                analysis_status = 'completed'
                AND emotion_temperature_score IS NOT NULL
                AND emotion_temperature_level IS NOT NULL
                AND failure_code IS NULL
            )
            OR (
                analysis_status IN ('unavailable', 'failed')
                AND emotion_temperature_score IS NULL
                AND emotion_temperature_level IS NULL
                AND voice_arousal_score IS NULL
                AND voice_dominance_score IS NULL
                AND voice_valence_score IS NULL
                AND negative_activation_score IS NULL
                AND char_length(btrim(failure_code)) BETWEEN 1 AND 100
            )
        ),
    ADD CONSTRAINT model_analysis_results_temperature_pair_chk
        CHECK (
            analysis_status <> 'completed'
            OR (emotion_temperature_score <= 33 AND emotion_temperature_level = 'stable')
            OR (
                emotion_temperature_score > 33
                AND emotion_temperature_score <= 66
                AND emotion_temperature_level = 'caution'
            )
            OR (emotion_temperature_score > 66 AND emotion_temperature_level = 'elevated')
        );

ALTER TABLE routing_recommendations
    DROP CONSTRAINT routing_recommendations_counselor_fk,
    ADD CONSTRAINT routing_recommendations_counselor_department_fk
        FOREIGN KEY (recommended_counselor_id, recommended_department_id)
        REFERENCES counselors (counselor_id, department_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

DROP INDEX idx_routing_recommendations_counselor;

CREATE INDEX idx_routing_recommendations_counselor
    ON routing_recommendations (
        recommended_counselor_id,
        recommended_department_id,
        created_at DESC
    )
    WHERE recommended_counselor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_utterance_recording_consent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.transcript_ciphertext IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM consultation_sessions AS s
           WHERE s.session_id = NEW.session_id
             AND s.consent_to_record
       ) THEN
        RAISE EXCEPTION 'encrypted transcript requires recording consent'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_utterances_recording_consent
BEFORE INSERT OR UPDATE OF session_id, transcript_ciphertext ON utterances
FOR EACH ROW EXECUTE FUNCTION enforce_utterance_recording_consent();

COMMIT;
