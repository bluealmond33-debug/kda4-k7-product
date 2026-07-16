-- K7 스키마·seed·참조 무결성 검증
-- schema.sql과 seed.sql 실행 후 사용한다. 성공 시 NOTICE만 출력한다.

DO $$
DECLARE
    table_count integer;
    unindexed_fk_count integer;
BEGIN
    SELECT count(*)
    INTO table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';

    IF table_count <> 12 THEN
        RAISE EXCEPTION 'expected 12 public tables, found %', table_count;
    END IF;

    SELECT count(*)
    INTO unindexed_fk_count
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND NOT EXISTS (
          SELECT 1
          FROM pg_index AS i
          WHERE i.indrelid = c.conrelid
            AND c.conkey::smallint[] <@ i.indkey::smallint[]
      );

    IF unindexed_fk_count <> 0 THEN
        RAISE EXCEPTION 'found % foreign keys without supporting indexes', unindexed_fk_count;
    END IF;

    IF (SELECT count(*) FROM customers) <> 10 THEN
        RAISE EXCEPTION 'customers seed count mismatch';
    END IF;
    IF (SELECT count(*) FROM counselors) <> 5 THEN
        RAISE EXCEPTION 'counselors seed count mismatch';
    END IF;
    IF (SELECT count(*) FROM consultation_sessions) <> 10 THEN
        RAISE EXCEPTION 'consultation_sessions seed count mismatch';
    END IF;
    IF (SELECT count(*) FROM consultation_history) < 30 THEN
        RAISE EXCEPTION 'consultation_history must contain at least 30 rows';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM routing_recommendations AS rr
        JOIN counselors AS c
            ON c.counselor_id = rr.recommended_counselor_id
        WHERE c.department_id <> rr.recommended_department_id
    ) THEN
        RAISE EXCEPTION 'routing counselor and department mismatch found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ai_consultation_cards AS card
        JOIN model_analysis_results AS analysis
            ON analysis.analysis_result_id = card.analysis_result_id
        WHERE analysis.session_id <> card.session_id
    ) THEN
        RAISE EXCEPTION 'consultation card references another session analysis';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM model_analysis_results
        WHERE (
            analysis_status = 'completed'
            AND (emotion_temperature_score IS NULL OR emotion_temperature_level IS NULL)
        ) OR (
            analysis_status <> 'completed'
            AND (emotion_temperature_score IS NOT NULL OR emotion_temperature_level IS NOT NULL)
        )
    ) THEN
        RAISE EXCEPTION 'invalid analysis status payload combination found';
    END IF;

    RAISE NOTICE 'table, seed, FK index and data consistency checks passed';
END;
$$;

DO $$
BEGIN
    BEGIN
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
        ) VALUES (1, 1, 2, 99, 0.5, '무결성 검증용', false, 'verify', '1.0');
        RAISE EXCEPTION 'routing department FK did not reject invalid counselor';
    EXCEPTION
        WHEN foreign_key_violation THEN
            NULL;
    END;

    BEGIN
        INSERT INTO model_analysis_results (
            session_id,
            result_key,
            model_name,
            model_version,
            analysis_status,
            emotion_temperature_score,
            emotion_temperature_level,
            audio_quality
        ) VALUES (1, 'K7-VERIFY-BAD-LEVEL', 'verify', '1.0', 'completed', 90, 'stable', 'normal');
        RAISE EXCEPTION 'emotion score-level CHECK did not reject invalid pair';
    EXCEPTION
        WHEN check_violation THEN
            NULL;
    END;

    BEGIN
        INSERT INTO utterances (
            session_id,
            speaker_type,
            sequence_no,
            transcript_ciphertext,
            encryption_key_version,
            masked_transcript,
            contains_sensitive_data
        ) VALUES (
            8,
            'customer',
            99,
            decode('0102', 'hex'),
            'verify-key',
            '검증용 마스킹 발화',
            false
        );
        RAISE EXCEPTION 'recording consent trigger did not reject ciphertext';
    EXCEPTION
        WHEN check_violation THEN
            NULL;
    END;

    BEGIN
        UPDATE access_logs
        SET access_purpose = '변경 시도'
        WHERE access_log_id = (SELECT min(access_log_id) FROM access_logs);
        RAISE EXCEPTION 'access log update was not blocked';
    EXCEPTION
        WHEN raise_exception THEN
            NULL;
    END;

    BEGIN
        DELETE FROM access_logs
        WHERE access_log_id = (SELECT min(access_log_id) FROM access_logs);
        RAISE EXCEPTION 'access log delete was not blocked';
    EXCEPTION
        WHEN raise_exception THEN
            NULL;
    END;

    RAISE NOTICE 'negative constraint and immutable log checks passed';
END;
$$;
