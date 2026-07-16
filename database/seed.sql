-- LEGACY REFERENCE ONLY: Railway mvp-1.0 DB에 로드하지 않는다.
-- KDA K7 테스트 전용 가상 데이터
-- 주의: 아래 TRUNCATE는 database/schema.sql로 만든 테스트 스키마의 데이터를 초기화한다.

BEGIN;

TRUNCATE TABLE
    access_logs,
    routing_recommendations,
    customer_cautions,
    consultation_history,
    ai_consultation_cards,
    model_analysis_results,
    utterances,
    consultation_sessions,
    counselor_permissions,
    counselors,
    customers,
    departments
RESTART IDENTITY;

INSERT INTO departments (department_code, department_name) VALUES
    ('general_banking', '일반은행상담팀'),
    ('remittance', '송금지원팀'),
    ('fraud_response', '금융사기대응팀'),
    ('cards', '카드상담팀'),
    ('global_payments', '해외결제지원팀'),
    ('customer_onboarding', '고객가입지원팀');

-- 이름·전화번호·계좌번호·생년월일은 모두 가상·마스킹 데이터다.
-- lookup_hash 값도 실제 개인정보가 아닌 테스트 문자열의 SHA-256 결과다.
INSERT INTO customers (
    customer_number,
    full_name_masked,
    phone_masked,
    phone_lookup_hash,
    account_number_masked,
    account_lookup_hash,
    birth_year,
    birth_date_masked
) VALUES
    ('K7TEST0001', '가상고객0*', '010-0000-00**', '1da2927a22567d990e0a4d65f46f47695eb8b15fc3349ce5faada586664e8996', '110-***-000001', '5c20bcee83b114dc17bc8fe819854c576daf839a39f06fd6b402aa927b39f404', 1991, '1991-**-**'),
    ('K7TEST0002', '가상고객0*', '010-0000-01**', 'eea546a0065e12af42c422f59059c4d0355d300c692ed2b7ebd85abaa9df7b34', '110-***-000002', 'f43bc47b6d2bbfd9dc222e3d4de2afbbd0a1c123a4cb0c2546c17d2be5be572f', 1987, '1987-**-**'),
    ('K7TEST0003', '가상고객0*', '010-0000-02**', 'cb51117b27586e7152994c164889f60f53dba9e058d0f6de8c50742014a6cd89', '110-***-000003', '8f492dde37626a3dee6ac3cc98139227e3f8a67c8b6bac8724f18e29edfc7386', 1995, '1995-**-**'),
    ('K7TEST0004', '가상고객0*', '010-0000-03**', '04c3e38031154f4c4d107e25e27dfdaed0beb5a883a07e9afe21524300e5c1a4', '110-***-000004', '80614df4dcb2eb198191c5a640a5a430ab4ca0108d379961879a0705bb3dc479', 1989, '1989-**-**'),
    ('K7TEST0005', '가상고객0*', '010-0000-04**', '95a0aa82b46225028384644e82a0629ca4754fcaa405b7d6364e3f01f382bdfe', '110-***-000005', '0cb7bb5b9ab00cba2644b00368e593a4406ef0f1a852ccb7beb41d14e25f210e', 2000, '2000-**-**'),
    ('K7TEST0006', '가상고객0*', '010-0000-05**', '74ab8b8fcfbda67ca9aff73093c2618bb5e3dc968e3975e5cb9a4cc7c90eb95c', '110-***-000006', 'b3ab8209919d2d11cdef0eef91c2bc688e1361f4acc10b8eff9880f1df894626', 1993, '1993-**-**'),
    ('K7TEST0007', '가상고객0*', '010-0000-06**', '1b0c6279953979f1b45e8052a801ab9b3f129fc7e12d9597c40c90d964546f05', '110-***-000007', 'ed25cf715ee263b54f8261ae53d886f1c5f5ab9493b84d239bd1b10f78ead00b', 1978, '1978-**-**'),
    ('K7TEST0008', '가상고객0*', '010-0000-07**', '8af8492e9c8ed25558f25ad292a5d532122f72234f0be13f6fe68d437fa6c176', '110-***-000008', '06d8ee4299ee375f8e0bc9bd7d0741a5363d1d3bec42b7d70e96e1c56bb71637', 1984, '1984-**-**'),
    ('K7TEST0009', '가상고객0*', '010-0000-08**', '2f7b5866b2fb7c0d8bffac9bb32f35eca46ce68e008f73b828420cf3dec3060c', '110-***-000009', 'e95f44a494fced72a2897124bcd609ac9d415ad5afb4bc785ed35e241ae9cb46', 1998, '1998-**-**'),
    ('K7TEST0010', '가상고객1*', '010-0000-09**', 'b42fef2ee25fc87d21885e80f1f66ccb67d87d62d9a56d302ad2a8b3b39acf63', '110-***-000010', '2219c845721d024b8bd7d3d6518017940fc2b19ed70c7678c932e0c09f7f4906', 1992, '1992-**-**');

INSERT INTO counselors (
    counselor_code,
    counselor_name,
    department_id
) VALUES
    ('AGENT001', '가상상담사01', 1),
    ('AGENT002', '가상상담사02', 2),
    ('AGENT003', '가상상담사03', 3),
    ('AGENT004', '가상상담사04', 4),
    ('AGENT005', '가상상담사05', 6);

INSERT INTO counselor_permissions (
    counselor_id,
    permission_scope,
    access_level,
    granted_reason,
    granted_by,
    valid_from,
    valid_until
)
SELECT
    c.counselor_id,
    p.permission_scope,
    p.access_level,
    'K7 테스트 상담업무 수행',
    1,
    timestamptz '2026-07-01 00:00:00+09',
    timestamptz '2026-12-31 23:59:59+09'
FROM counselors AS c
CROSS JOIN (
    VALUES
        ('customer_basic', 'masked_read'),
        ('consultation_history', 'read'),
        ('customer_cautions', 'read'),
        ('model_analysis_results', 'read'),
        ('ai_consultation_cards', 'read'),
        ('routing_recommendations', 'read')
) AS p(permission_scope, access_level);

INSERT INTO counselor_permissions (
    counselor_id,
    permission_scope,
    access_level,
    granted_reason,
    granted_by,
    valid_from,
    valid_until
) VALUES
    (1, 'access_logs', 'manage', '감사로그 운영 담당', 1, timestamptz '2026-07-01 00:00:00+09', timestamptz '2026-12-31 23:59:59+09'),
    (2, 'utterances', 'read', '송금 상담 발화 확인', 1, timestamptz '2026-07-01 00:00:00+09', timestamptz '2026-12-31 23:59:59+09'),
    (3, 'utterances', 'read', '금융사기 상담 발화 확인', 1, timestamptz '2026-07-01 00:00:00+09', timestamptz '2026-12-31 23:59:59+09'),
    (4, 'utterances', 'read', '카드 상담 발화 확인', 1, timestamptz '2026-07-01 00:00:00+09', timestamptz '2026-12-31 23:59:59+09');

INSERT INTO consultation_sessions (
    external_session_key,
    customer_id,
    assigned_counselor_id,
    inquiry_type,
    session_status,
    risk_level,
    consent_to_record,
    started_at,
    ended_at
) VALUES
    ('K7-SESSION-0001', 1, 2, 'mistaken_transfer', 'ready', 'high', true, timestamptz '2026-07-15 09:00:00+09', NULL),
    ('K7-SESSION-0002', 2, 3, 'voice_phishing_suspected', 'ready', 'critical', true, timestamptz '2026-07-15 09:05:00+09', NULL),
    ('K7-SESSION-0003', 3, 4, 'lost_card', 'ready', 'high', true, timestamptz '2026-07-15 09:10:00+09', NULL),
    ('K7-SESSION-0004', 4, 4, 'overseas_payment', 'ready', 'medium', true, timestamptz '2026-07-15 09:15:00+09', NULL),
    ('K7-SESSION-0005', 5, 5, 'account_opening', 'ready', 'low', true, timestamptz '2026-07-15 09:20:00+09', NULL),
    ('K7-SESSION-0006', 6, 4, 'payment_error', 'completed', 'medium', true, timestamptz '2026-07-15 09:25:00+09', timestamptz '2026-07-15 09:42:00+09'),
    ('K7-SESSION-0007', 7, 1, 'general_inquiry', 'analyzing', 'low', true, timestamptz '2026-07-15 09:30:00+09', NULL),
    ('K7-SESSION-0008', 8, 1, 'loan', 'waiting', 'low', false, timestamptz '2026-07-15 09:35:00+09', NULL),
    ('K7-SESSION-0009', 9, NULL, 'overseas_payment', 'ready', 'high', true, timestamptz '2026-07-15 09:40:00+09', NULL),
    ('K7-SESSION-0010', 10, NULL, 'other', 'cancelled', 'low', false, timestamptz '2026-07-15 09:45:00+09', timestamptz '2026-07-15 09:46:00+09');

-- transcript_ciphertext는 복호화 대상 원문이 아니라 테스트용 임의 바이트다.
-- 실제 서비스에서는 애플리케이션/KMS로 암호화한 값만 적재한다.
INSERT INTO utterances (
    session_id,
    speaker_type,
    sequence_no,
    transcript_ciphertext,
    encryption_key_version,
    masked_transcript,
    contains_sensitive_data,
    stt_confidence,
    spoken_at
) VALUES
    (1, 'customer', 1, decode('01010101010101010101010101010101', 'hex'), 'test-placeholder-v1', '오늘 **은행 계좌로 송금했는데 받는 분을 잘못 선택했습니다.', true, 0.9640, timestamptz '2026-07-15 09:00:10+09'),
    (2, 'customer', 1, decode('02020202020202020202020202020202', 'hex'), 'test-placeholder-v1', '검찰이라고 전화가 와서 지금 ***만원을 보내라고 합니다.', true, 0.9520, timestamptz '2026-07-15 09:05:11+09'),
    (3, 'customer', 1, decode('03030303030303030303030303030303', 'hex'), 'test-placeholder-v1', '카드를 잃어버렸고 카드 끝자리는 ****입니다.', true, 0.9810, timestamptz '2026-07-15 09:10:09+09'),
    (4, 'customer', 1, decode('04040404040404040404040404040404', 'hex'), 'test-placeholder-v1', '해외에서 사용하지 않은 **달러 결제가 보입니다.', true, 0.9430, timestamptz '2026-07-15 09:15:08+09'),
    (5, 'customer', 1, decode('05050505050505050505050505050505', 'hex'), 'test-placeholder-v1', '비대면 계좌개설에 필요한 서류와 절차가 궁금합니다.', false, 0.9880, timestamptz '2026-07-15 09:20:07+09'),
    (6, 'customer', 1, decode('06060606060606060606060606060606', 'hex'), 'test-placeholder-v1', '온라인 결제가 두 번 승인된 것 같습니다.', false, 0.9710, timestamptz '2026-07-15 09:25:06+09'),
    (7, 'customer', 1, decode('07070707070707070707070707070707', 'hex'), 'test-placeholder-v1', '영업점 운영시간을 확인하고 싶습니다.', false, 0.9900, timestamptz '2026-07-15 09:30:05+09'),
    (8, 'customer', 1, NULL, NULL, '대출 금리와 한도 조회 방법을 알려주세요.', false, 0.9770, timestamptz '2026-07-15 09:35:04+09'),
    (9, 'customer', 1, decode('09090909090909090909090909090909', 'hex'), 'test-placeholder-v1', '제가 하지 않은 해외 온라인 결제가 오늘 발생했습니다.', false, 0.9580, timestamptz '2026-07-15 09:40:03+09'),
    (10, 'customer', 1, NULL, NULL, '상담을 취소하겠습니다.', false, 0.9940, timestamptz '2026-07-15 09:45:02+09');

-- 모델팀이 제공할 음성 기반 감정온도 결과의 저장 계약 예시
INSERT INTO model_analysis_results (
    session_id,
    result_key,
    model_name,
    model_version,
    output_schema_version,
    emotion_temperature_score,
    emotion_temperature_level,
    voice_arousal_score,
    voice_dominance_score,
    voice_valence_score,
    negative_activation_score,
    audio_quality,
    generated_at
) VALUES
    (1, 'K7-EMOTION-SESSION-0001-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 74.00, 'elevated', 70.00, 58.00, 28.00, 50.40, 'normal', timestamptz '2026-07-15 09:00:55+09'),
    (2, 'K7-EMOTION-SESSION-0002-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 92.00, 'elevated', 88.00, 76.00, 12.00, 77.44, 'normal', timestamptz '2026-07-15 09:05:55+09'),
    (3, 'K7-EMOTION-SESSION-0003-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 68.00, 'elevated', 72.00, 55.00, 34.00, 47.52, 'normal', timestamptz '2026-07-15 09:10:55+09'),
    (4, 'K7-EMOTION-SESSION-0004-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 57.00, 'caution', 54.00, 48.00, 42.00, 31.32, 'normal', timestamptz '2026-07-15 09:15:55+09'),
    (5, 'K7-EMOTION-SESSION-0005-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 22.00, 'stable', 24.00, 35.00, 72.00, 6.72, 'normal', timestamptz '2026-07-15 09:20:55+09'),
    (6, 'K7-EMOTION-SESSION-0006-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 52.00, 'caution', 58.00, 52.00, 39.00, 35.38, 'normal', timestamptz '2026-07-15 09:25:55+09'),
    (7, 'K7-EMOTION-SESSION-0007-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 18.00, 'stable', 20.00, 30.00, 78.00, 4.40, 'normal', timestamptz '2026-07-15 09:30:55+09'),
    (9, 'K7-EMOTION-SESSION-0009-001', 'k7-emotion-temperature-model', '0.1.0', '1.0', 84.00, 'elevated', 80.00, 67.00, 18.00, 65.60, 'normal', timestamptz '2026-07-15 09:40:55+09');

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
) VALUES
    (1, 1, '1.0', '수취인 선택 오류로 착오송금 반환 절차를 요청함.', '착오송금 반환 절차와 가능 여부 확인', ARRAY['착오송금', '반환신청'], ARRAY['금전피해 가능성'], 'high', 'high', ARRAY['송금-반환-01'], '착오송금 문제로 많이 놀라셨겠습니다. 송금 시점부터 확인하겠습니다.', ARRAY['송금내역 확인', '반환지원 절차 안내'], ARRAY['송금 시각', '수취 계좌 마스킹 정보'], 'confirmed', timestamptz '2026-07-15 09:01:10+09', 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:01:00+09'),
    (2, 2, '1.0', '수사기관 사칭 송금 요구를 받고 있어 즉시 보호조치가 필요함.', '현재 송금 요구의 안전성 확인', ARRAY['기관사칭', '송금요구'], ARRAY['금전피해 진행 가능성', '기관사칭'], 'critical', 'critical', ARRAY['사기대응-긴급-01'], '현재 송금하지 마시고 안전한 상태인지 먼저 확인하겠습니다.', ARRAY['송금 중단 안내', '지급정지 검토', '전담팀 연결'], ARRAY['현재 송금 여부', '상대방 연락 수단'], 'pending', NULL, 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:06:00+09'),
    (3, 3, '1.0', '카드 분실로 즉시 이용정지와 재발급을 요청함.', '분실 카드 정지와 재발급', ARRAY['카드분실', '이용정지'], ARRAY['부정사용 가능성'], 'high', 'high', ARRAY['카드-분실-01'], '분실 신고를 우선 접수하고 최근 승인내역도 함께 확인하겠습니다.', ARRAY['카드 이용정지', '최근 승인내역 확인', '재발급 안내'], ARRAY['분실 시각', '최근 사용내역'], 'confirmed', timestamptz '2026-07-15 09:11:10+09', 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:11:00+09'),
    (4, 4, '1.0', '본인이 사용하지 않은 해외결제 내역을 확인함.', '해외결제 이의제기와 추가 결제 차단', ARRAY['해외결제', '본인미사용'], ARRAY['부정사용 의심'], 'high', 'medium', ARRAY['해외결제-이의-01'], '해외결제 내역을 확인한 뒤 이의제기 절차를 안내하겠습니다.', ARRAY['승인내역 확인', '해외사용 잠금', '이의제기 안내'], ARRAY['결제 시각', '본인 사용 여부'], 'pending', NULL, 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:16:00+09'),
    (5, 5, '1.0', '비대면 계좌개설 준비서류와 절차를 문의함.', '비대면 계좌개설 절차 안내', ARRAY['계좌개설', '비대면'], ARRAY[]::text[], 'low', 'low', ARRAY['계좌개설-비대면-01'], '비대면 계좌개설에 필요한 준비사항부터 안내하겠습니다.', ARRAY['개설 준비사항 안내', '개설 절차 안내'], ARRAY['개설 목적'], 'confirmed', timestamptz '2026-07-15 09:21:10+09', 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:21:00+09'),
    (6, 6, '1.0', '온라인 결제의 중복 승인 여부와 취소 가능성을 문의함.', '중복 승인 확인과 취소 가능 여부', ARRAY['중복승인', '온라인결제'], ARRAY['결제 분쟁 가능성'], 'medium', 'medium', ARRAY['카드-승인-02'], '중복 승인 여부를 확인하고 취소 절차를 안내하겠습니다.', ARRAY['승인내역 확인', '매입상태 확인', '취소 안내'], ARRAY['승인 건수', '가맹점명'], 'confirmed', timestamptz '2026-07-15 09:26:10+09', 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:26:00+09'),
    (7, 7, '1.0', '영업점 운영시간을 문의함.', '영업점 운영시간 확인', ARRAY['영업점', '운영시간'], ARRAY[]::text[], 'low', 'low', ARRAY['영업점-안내-01'], '가까운 영업점의 운영시간을 확인해 드리겠습니다.', ARRAY['영업점 조회'], ARRAY['희망 지역'], 'pending', NULL, 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:31:00+09'),
    (9, 8, '1.0', '당일 발생한 미인지 해외 온라인 결제의 차단과 확인을 요청함.', '해외 부정결제 차단과 이의제기', ARRAY['해외온라인결제', '부정사용'], ARRAY['부정사용 의심', '추가 결제 가능성'], 'high', 'high', ARRAY['해외결제-이의-01'], '추가 결제를 막고 해당 승인내역부터 확인하겠습니다.', ARRAY['해외사용 잠금', '승인내역 확인', '이의제기 안내'], ARRAY['결제 시각', '본인 사용 여부'], 'pending', NULL, 'k7-card-model', '0.1.0', timestamptz '2026-07-15 09:41:00+09');

-- 35건의 가상 과거 상담내역
INSERT INTO consultation_history (
    customer_id,
    counselor_id,
    inquiry_type,
    ai_summary,
    resolution_result,
    department_id,
    risk_level,
    consulted_at
)
SELECT
    ((g - 1) % 10) + 1,
    ((g - 1) % 5) + 1,
    CASE g % 8
        WHEN 0 THEN 'mistaken_transfer'
        WHEN 1 THEN 'voice_phishing_suspected'
        WHEN 2 THEN 'lost_card'
        WHEN 3 THEN 'overseas_payment'
        WHEN 4 THEN 'account_opening'
        WHEN 5 THEN 'payment_error'
        WHEN 6 THEN 'loan'
        ELSE 'general_inquiry'
    END,
    '가상 과거상담 요약 ' || lpad(g::text, 2, '0'),
    CASE g % 5
        WHEN 0 THEN '안내 완료'
        WHEN 1 THEN '전담팀 이관'
        WHEN 2 THEN '이용정지 후 재발급 접수'
        WHEN 3 THEN '이의제기 접수'
        ELSE '추가 확인 후 처리 완료'
    END,
    CASE g % 8
        WHEN 0 THEN 2
        WHEN 1 THEN 3
        WHEN 2 THEN 4
        WHEN 3 THEN 5
        WHEN 4 THEN 6
        WHEN 5 THEN 4
        ELSE 1
    END,
    CASE
        WHEN g % 8 = 1 THEN 'critical'
        WHEN g % 8 IN (0, 2) THEN 'high'
        WHEN g % 8 IN (3, 5) THEN 'medium'
        ELSE 'low'
    END,
    timestamptz '2026-06-01 09:00:00+09' + (g * interval '9 hours')
FROM generate_series(1, 35) AS g;

INSERT INTO customer_cautions (
    customer_id,
    caution_type,
    reason,
    severity,
    caution_status,
    registered_by,
    registered_at,
    expires_at
) VALUES
    (2, 'fraud_suspected', '기관 사칭 연락을 받고 송금 직전 상담 요청', 'critical', 'active', 3, timestamptz '2026-07-15 09:06:30+09', timestamptz '2026-10-15 09:06:30+09'),
    (3, 'additional_review_required', '카드 분실 신고 시 추가 확인 필요', 'medium', 'active', 4, timestamptz '2026-07-15 09:11:30+09', timestamptz '2026-08-15 09:11:30+09'),
    (7, 'vulnerable_customer', '디지털 절차 안내 시 단계별 설명 필요', 'low', 'active', 1, timestamptz '2026-07-10 10:00:00+09', NULL),
    (9, 'repeated_dispute', '최근 해외결제 이의제기 이력 확인 필요', 'high', 'active', 4, timestamptz '2026-07-15 09:41:30+09', timestamptz '2026-09-15 09:41:30+09'),
    (10, 'other', '테스트 종료된 주의정보 예시', 'low', 'expired', 1, timestamptz '2026-05-01 09:00:00+09', timestamptz '2026-06-01 09:00:00+09');

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
) VALUES
    (1, 2, 2, 1, 0.9600, '착오송금 키워드와 송금지원 업무가 일치함', true, 'k7-router', '0.1.0'),
    (1, 1, 1, 2, 0.6100, '일반은행상담 대체 경로', false, 'k7-router', '0.1.0'),
    (2, 3, 3, 1, 0.9900, '기관 사칭과 송금 요구가 금융사기 긴급 규칙에 일치함', true, 'k7-router', '0.1.0'),
    (2, 2, 2, 2, 0.7200, '송금 직전 단계의 대체 경로', false, 'k7-router', '0.1.0'),
    (3, 4, 4, 1, 0.9800, '카드 분실 키워드가 카드상담 업무에 일치함', true, 'k7-router', '0.1.0'),
    (4, 5, NULL, 1, 0.9300, '해외결제 이의제기 업무에 일치함', true, 'k7-router', '0.1.0'),
    (5, 6, 5, 1, 0.9700, '비대면 계좌개설 문의에 일치함', true, 'k7-router', '0.1.0'),
    (9, 5, NULL, 1, 0.9500, '해외 온라인 부정결제 위험 경로', true, 'k7-router', '0.1.0'),
    (9, 3, 3, 2, 0.7800, '부정사용 의심 시 금융사기대응 대체 경로', false, 'k7-router', '0.1.0');

INSERT INTO access_logs (
    counselor_id,
    customer_id,
    session_id,
    information_scope,
    action_type,
    access_purpose,
    result_status,
    request_id,
    source_ip,
    created_at,
    updated_at
) VALUES
    (2, 1, 1, 'customer_basic', 'view', '착오송금 관련 마스킹 기본정보 확인', 'success', 'K7-REQ-0001', '10.10.0.12', timestamptz '2026-07-15 09:01:10+09', timestamptz '2026-07-15 09:01:10+09'),
    (2, 1, 1, 'consultation_history', 'view', '최근 유사 송금상담 확인', 'success', 'K7-REQ-0002', '10.10.0.12', timestamptz '2026-07-15 09:01:20+09', timestamptz '2026-07-15 09:01:20+09'),
    (3, 2, 2, 'customer_cautions', 'view', '보이스피싱 위험정보 확인', 'success', 'K7-REQ-0003', '10.10.0.13', timestamptz '2026-07-15 09:06:40+09', timestamptz '2026-07-15 09:06:40+09'),
    (3, 2, 2, 'utterances', 'view', '금융사기 긴급상담 발화 확인', 'success', 'K7-REQ-0004', '10.10.0.13', timestamptz '2026-07-15 09:06:50+09', timestamptz '2026-07-15 09:06:50+09'),
    (4, 3, 3, 'ai_consultation_cards', 'view', '카드 분실 사전상담 내용 확인', 'success', 'K7-REQ-0005', '10.10.0.14', timestamptz '2026-07-15 09:11:40+09', timestamptz '2026-07-15 09:11:40+09'),
    (4, 4, 4, 'routing_recommendations', 'view', '해외결제 담당부서 추천 확인', 'success', 'K7-REQ-0006', '10.10.0.14', timestamptz '2026-07-15 09:16:40+09', timestamptz '2026-07-15 09:16:40+09'),
    (5, 5, 5, 'customer_basic', 'view', '계좌개설 상담 전 마스킹 기본정보 확인', 'success', 'K7-REQ-0007', '10.10.0.15', timestamptz '2026-07-15 09:21:40+09', timestamptz '2026-07-15 09:21:40+09'),
    (1, 8, 8, 'utterances', 'view', '권한 없는 발화 조회 차단 예시', 'denied', 'K7-REQ-0008', '10.10.0.11', timestamptz '2026-07-15 09:36:00+09', timestamptz '2026-07-15 09:36:00+09');

COMMIT;
