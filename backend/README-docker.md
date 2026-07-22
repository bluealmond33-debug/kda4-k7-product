# KARI-NA Docker 실행 가이드

## 사전 준비
- Docker Desktop 설치(WSL2 백엔드).
- 두 repo를 **같은 부모 폴더에 형제로** clone:
  ```bash
  git clone https://github.com/HeeChang50/kda4-k7-backend.git
  git clone https://github.com/bluealmond33-debug/kda4-k7-product.git
  ```
  결과 구조:
  ```
  <work>/kda4-k7-backend/    ← docker-compose.yml 여기
  <work>/kda4-k7-product/    ← frontend 빌드 컨텍스트
  ```

## 팀원 랩탑 (cpu 스텁 모드) — 기본
```bash
cd kda4-k7-backend
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```
- 프론트: http://localhost:5173
- 백엔드: http://localhost:8000/health
- DB(호스트에서 직접 접속 시): `localhost:5433` (컨테이너 간 통신은 `db:5432` 그대로)
- cpu 스택은 `STUB_MODELS=true`(기본값, `.env.docker.example`에 설정됨)로 동작한다. 즉 분석/STT 결과는 캔드(canned) 스텁이며 대용량 모델 다운로드가 전혀 없다 — UI 흐름 데모 용도. 실제 모델 추론은 gpu 경로에서 나온다.
- 종료: `docker compose --env-file .env.docker down` (데이터 유지) / `down -v`(볼륨까지 삭제)

## 데모 머신 (gpu 실모델)
gpu(데모 머신) 실모델 경로는 추후 `docker-compose.gpu.yml`로 제공 예정 — 이번 번들엔 미포함. 상세는 계획서 Task 5 참고.

## 자주 나는 문제
- **db 포트 충돌**: 우리 compose는 이미 host `5433` : 컨테이너 `5432`로 매핑해 네이티브 PostgreSQL(5432)과 충돌을 피한다. 만약 5433도 점유돼 있으면 `docker-compose.yml`의 db 포트 매핑을 바꿔라.
- **frontend가 backend에 못 붙음**: `VITE_API_BASE_URL`은 빌드 시 고정된다. 포트를 바꿨으면 `docker compose build frontend`로 재빌드.
- **감정모델(.joblib) 없음**: gitignore라 팀원에겐 없다. cpu 스텁은 무방. gpu 실추론엔 별도 파일 공유 필요.
