-- pgvector 확장 활성화. pgvector/pgvector 이미지엔 확장 바이너리가 포함돼 있으므로
-- DB 최초 생성 시점(docker-entrypoint-initdb.d)에 미리 켜 둔다.
-- 앱의 initialize_rag()/seed_demo_regulations()도 CREATE EXTENSION을 재실행하지만 멱등이다.
CREATE EXTENSION IF NOT EXISTS vector;
