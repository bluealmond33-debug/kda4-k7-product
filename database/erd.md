# K7 PostgreSQL ERD

> 참고용 12테이블 ERD입니다. 현재 MVP 활성 테이블은 `database/mvp/schema.sql`의 `calls`, `transcripts`, `consultation_cards` 세 개뿐입니다.

```mermaid
erDiagram
    DEPARTMENTS {
        bigint department_id PK
        text department_code UK
        text department_name UK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    CUSTOMERS {
        bigint customer_id PK
        text customer_number UK
        text full_name_masked
        text phone_masked
        text phone_lookup_hash UK
        text account_number_masked
        text account_lookup_hash UK
        smallint birth_year
        text customer_status
        timestamptz created_at
        timestamptz updated_at
    }

    COUNSELORS {
        bigint counselor_id PK
        text counselor_code UK
        text counselor_name
        bigint department_id FK
        text employment_status
        timestamptz created_at
        timestamptz updated_at
    }

    COUNSELOR_PERMISSIONS {
        bigint permission_id PK
        bigint counselor_id FK
        text permission_scope "active UK with counselor_id"
        text access_level
        bigint granted_by FK
        timestamptz valid_from
        timestamptz valid_until
        timestamptz created_at
        timestamptz updated_at
    }

    CONSULTATION_SESSIONS {
        bigint session_id PK
        text external_session_key UK
        bigint customer_id FK
        bigint assigned_counselor_id FK
        text inquiry_type
        text session_status
        text channel
        text risk_level
        timestamptz started_at
        timestamptz ended_at
        timestamptz created_at
        timestamptz updated_at
    }

    UTTERANCES {
        bigint utterance_id PK
        bigint session_id FK
        text speaker_type
        integer sequence_no "UK with session_id"
        bytea transcript_ciphertext
        text masked_transcript
        numeric stt_confidence
        timestamptz spoken_at
        timestamptz created_at
        timestamptz updated_at
    }

    MODEL_ANALYSIS_RESULTS {
        bigint analysis_result_id PK
        bigint session_id FK
        text result_key UK
        text model_name
        text model_version
        text output_schema_version
        text analysis_status
        numeric emotion_temperature_score
        text emotion_temperature_level
        numeric voice_arousal_score
        numeric voice_dominance_score
        numeric voice_valence_score
        numeric negative_activation_score
        text audio_quality
        text failure_code
        timestamptz generated_at
        timestamptz created_at
        timestamptz updated_at
    }

    AI_CONSULTATION_CARDS {
        bigint card_id PK
        bigint session_id FK, UK
        bigint analysis_result_id FK
        text card_schema_version
        text summary
        text customer_request
        text urgency_level
        text risk_level
        text confirmation_status
        timestamptz confirmed_at
        timestamptz generated_at
        timestamptz created_at
        timestamptz updated_at
    }

    CONSULTATION_HISTORY {
        bigint history_id PK
        bigint customer_id FK
        bigint source_session_id FK, UK
        bigint counselor_id FK
        text inquiry_type
        text ai_summary
        text resolution_result
        bigint department_id FK
        text risk_level
        timestamptz consulted_at
        timestamptz created_at
        timestamptz updated_at
    }

    CUSTOMER_CAUTIONS {
        bigint caution_id PK
        bigint customer_id FK
        text caution_type
        text reason
        text severity
        text caution_status
        bigint registered_by FK
        timestamptz registered_at
        timestamptz expires_at
        timestamptz created_at
        timestamptz updated_at
    }

    ROUTING_RECOMMENDATIONS {
        bigint routing_id PK
        bigint session_id FK
        bigint recommended_department_id FK
        bigint recommended_counselor_id FK
        smallint recommendation_rank "UK with session_id"
        numeric confidence
        boolean selected
        text model_version
        timestamptz created_at
        timestamptz updated_at
    }

    ACCESS_LOGS {
        bigint access_log_id PK
        bigint counselor_id FK
        bigint customer_id FK
        bigint session_id FK
        text information_scope
        text action_type
        text access_purpose
        text result_status
        text request_id
        inet source_ip
        timestamptz created_at
        timestamptz updated_at
    }

    DEPARTMENTS ||--o{ COUNSELORS : "소속"
    COUNSELORS ||--o{ COUNSELOR_PERMISSIONS : "권한 보유"
    COUNSELORS o|--o{ COUNSELOR_PERMISSIONS : "권한 부여"

    CUSTOMERS ||--o{ CONSULTATION_SESSIONS : "상담 요청"
    COUNSELORS o|--o{ CONSULTATION_SESSIONS : "배정"
    CONSULTATION_SESSIONS ||--o{ UTTERANCES : "발화 포함"
    CONSULTATION_SESSIONS ||--o{ MODEL_ANALYSIS_RESULTS : "감정온도 분석"
    CONSULTATION_SESSIONS ||--o| AI_CONSULTATION_CARDS : "카드 생성"
    MODEL_ANALYSIS_RESULTS o|--o| AI_CONSULTATION_CARDS : "감정온도 제공"

    CUSTOMERS ||--o{ CONSULTATION_HISTORY : "과거 상담"
    CONSULTATION_SESSIONS o|--o| CONSULTATION_HISTORY : "종료 후 이력화"
    COUNSELORS o|--o{ CONSULTATION_HISTORY : "상담 담당"
    DEPARTMENTS ||--o{ CONSULTATION_HISTORY : "처리 부서"

    CUSTOMERS ||--o{ CUSTOMER_CAUTIONS : "주의정보 보유"
    COUNSELORS o|--o{ CUSTOMER_CAUTIONS : "주의정보 등록"

    CONSULTATION_SESSIONS ||--o{ ROUTING_RECOMMENDATIONS : "라우팅 후보"
    DEPARTMENTS ||--o{ ROUTING_RECOMMENDATIONS : "추천 부서"
    COUNSELORS o|--o{ ROUTING_RECOMMENDATIONS : "추천 상담사"

    COUNSELORS ||--o{ ACCESS_LOGS : "정보 조회"
    CUSTOMERS ||--o{ ACCESS_LOGS : "조회 대상"
    CONSULTATION_SESSIONS o|--o{ ACCESS_LOGS : "관련 세션"
```

## 핵심 관계

- 고객 1명은 여러 상담 세션·과거 상담·주의정보·조회로그를 가질 수 있습니다.
- 상담 세션 1건은 여러 STT 발화·감정온도 결과·라우팅 후보를 가지며 상담카드는 최대 1건입니다.
- 상담카드는 같은 세션의 감정온도 결과만 복합 FK로 참조합니다.
- 세션이 종료되면 `consultation_history.source_session_id`로 원본 세션과 1:1 연결할 수 있습니다.
- 상담사 권한은 정보 범위별로 관리하고 실제 조회 결과는 `access_logs`에 불변 감사기록으로 남깁니다.
