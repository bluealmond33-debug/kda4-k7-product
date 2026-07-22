# KARI-NA Docker 배포 패키징 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원 각자 랩탑에서 `docker compose up` 한 번으로 KARI-NA 데모 스택(프론트+백엔드+pgvector DB)을 스텁 모드로 띄우고, 데모 머신에서는 실모델까지 구동할 수 있게 한다.

**Architecture:** 단일 `docker-compose.yml`(cpu 스텁 스택, 기본값) + `docker-compose.gpu.yml`(실모델 오버레이). backend는 멀티스테이지 Dockerfile의 `cpu`(python:3.12-slim)/`gpu`(CUDA) 타깃으로 빌드. 벡터DB는 `pgvector/pgvector:pg17` 단일 컨테이너. frontend(`kda4-k7-product`)는 Vite 정적 빌드 후 nginx 서빙. 백엔드는 모델 부재 시 이미 스텁/FAISS로 폴백하므로 cpu 스택이 자연스럽게 degrade된다.

**Tech Stack:** Docker Compose v5, pgvector/pgvector:pg17, python:3.12-slim, nvidia/cuda(12.x)-cudnn-runtime, node:20 + nginx:alpine, FastAPI/uvicorn, Vite/React18.

## Global Constraints

- 번들(compose·Dockerfile·env·README)은 backend repo(`HeeChang50/kda4-k7-backend`, 온디스크 `Documents\금융콜센터AI\backend`) 루트에 둔다.
- frontend 빌드 컨텍스트는 **sibling 경로** `../kda4-k7-product`. 두 repo는 같은 부모 폴더에 형제로 존재해야 한다.
- cpu 스택은 **대용량 모델 다운로드 0**이어야 한다(스텁·FAISS 폴백만 사용).
- 컨테이너 간 통신은 서비스명(`db`, `ollama`, `backend`)으로 한다. 브라우저→backend는 published 포트(각자 `localhost:8000`).
- pyarrow는 `18.1.0` 고정 유지(requirements.txt 이미 반영). 임베딩 차원은 bge-m3 = **1024**(스키마 vector(1024)와 일치해야 함).
- Vite 환경변수(`VITE_API_BASE_URL` 등)는 **빌드 시** 주입된다(런타임 변경 불가) — compose `build.args`로 넣는다.
- 비밀번호/키를 커밋하지 않는다. 실제 `.env.docker`는 `.gitignore`에, 템플릿 `.env.docker.example`만 커밋.
- 각 태스크는 커밋으로 끝낸다. backend 파일은 backend repo에, frontend 파일(Dockerfile/nginx.conf)은 `kda4-k7-product` repo에 커밋한다.

---

## File Structure

**backend repo (`Documents\금융콜센터AI\backend\`)**
- Create: `docker-compose.yml` — cpu 스택(db+backend+frontend), 기본값
- Create: `docker-compose.gpu.yml` — gpu 오버레이(backend cuda + ollama + 모델 마운트)
- Create: `Dockerfile` — 멀티스테이지(`cpu`/`gpu` 타깃)
- Create: `.dockerignore`
- Create: `db/init/01-extensions.sql` — `CREATE EXTENSION vector`
- Create: `.env.docker.example` — 환경변수 템플릿
- Create: `README-docker.md` — 2-repo clone + 실행 절차
- Modify: `.gitignore` — `.env.docker` 추가

**frontend repo (`Documents\금융콜센터AI\kda4-k7-product\`)**
- Create: `Dockerfile` — node 빌드 → nginx
- Create: `nginx.conf` — SPA fallback
- Create: `.dockerignore`

---

## Notes & 위험 (실행 전 필독)

- **포트 5432 충돌**: 이 랩탑엔 로컬 PostgreSQL 17이 5432를 점유 중일 수 있다(메모리 기준). db 컨테이너 기동 전 로컬 PG 서비스를 멈추거나(Task 1에서 처리), 호스트 포트를 바꿔야 한다.
- **포트 11434 충돌**: 데모 머신엔 host Ollama가 11434에 떠 있을 수 있다. gpu 오버레이의 ollama 컨테이너와 충돌 → Task 5에서 host Ollama 재사용(권장) vs 컨테이너 택1.
- **gpu 컨테이너 backend는 고위험**: CUDA/cuDNN/ctranslate2(faster-whisper) 버전 궁합이 까다롭다. 데모 머신은 **이미 host venv+.bat로 GPU 구동이 됨**. 따라서 Task 5는 "host backend + Docker db(pgvector)"를 **권장 저위험 경로**로, 풀 컨테이너 gpu를 대안으로 제시한다.
- **Primary deliverable는 Task 1–4(cpu 스택)**. 이것만으로 "팀원 각자 랩탑 실행" 목표가 충족된다. Task 5는 데모 머신 실모델 강화(선택).

---

## Task 1: pgvector DB 컨테이너 + compose 스켈레톤

로컬 PostgreSQL을 대체할 pgvector Postgres 컨테이너를 띄우고, host의 backend(.venv)가 붙어 `/health`가 connected 되는지까지 확인한다.

**Files:**
- Create: `docker-compose.yml`
- Create: `db/init/01-extensions.sql`
- Create: `.env.docker.example`
- Create: `.dockerignore`
- Modify: `.gitignore`

**Interfaces:**
- Produces: compose 서비스 `db`(pgvector/pgvector:pg17), 명명 볼륨 `k7_pgdata`, 네트워크상 호스트명 `db:5432`. 이후 태스크의 backend가 `DATABASE_URL=...@db:5432/k7_mvp`로 참조.

- [ ] **Step 1: 포트 5432 점유 확인(실패 조건 관찰)**

Run:
```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess
Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object Name, Status
```
Expected: 로컬 PostgreSQL이 있으면 서비스가 `Running`으로 나온다. 있으면 다음 스텝에서 멈춘다(없으면 Step 2 건너뜀).

- [ ] **Step 2: 로컬 PostgreSQL 서비스 중지(충돌 회피)**

Run (관리자 PowerShell, 서비스명은 Step 1 출력에 맞춰 조정):
```powershell
Stop-Service -Name "postgresql-x64-17" -Force
Set-Service -Name "postgresql-x64-17" -StartupType Manual
```
Expected: 서비스 `Stopped`. (데모 후 다시 쓰려면 `Start-Service`.)

- [ ] **Step 3: `db/init/01-extensions.sql` 작성**

```sql
-- pgvector 확장 활성화. pgvector/pgvector 이미지엔 확장 바이너리가 포함돼 있으므로
-- DB 최초 생성 시점(docker-entrypoint-initdb.d)에 미리 켜 둔다.
-- 앱의 initialize_rag()/seed_demo_regulations()도 CREATE EXTENSION을 재실행하지만 멱등이다.
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 4: `.dockerignore` 작성**

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.env
.env.docker
.git/
data/
docs/
*.md
*.joblib
```

- [ ] **Step 5: `.env.docker.example` 작성**

```dotenv
# docker compose용 환경변수 템플릿. 복사해서 .env.docker로 쓰고 값 채우기.
#   cp .env.docker.example .env.docker
# compose는 같은 폴더의 .env를 자동 로드하지 않고 이 파일을 쓰려면 --env-file .env.docker 로 지정한다.

# --- Postgres (db 컨테이너) ---
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=k7_mvp

# --- backend ---
# cpu 스택은 스텁 모드(대용량 모델 불필요)
USE_LOCAL_MODELS=false
# gpu 오버레이에서만 의미 있음(컨테이너 ollama). host ollama 재사용 시 http://host.docker.internal:11434
OLLAMA_BASE_URL=http://ollama:11434
```

- [ ] **Step 6: `docker-compose.yml` 작성(db만; backend/frontend는 다음 태스크에서 채움)**

```yaml
name: karina

services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-k7_mvp}
    ports:
      - "5432:5432"
    volumes:
      - k7_pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-k7_mvp}"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  k7_pgdata:
```

- [ ] **Step 7: compose 문법 검증(먼저 config로 확인)**

Run: `docker compose --env-file .env.docker.example config`
Expected: 유효한 병합 YAML이 출력되고 에러 없음. (`.env.docker`를 아직 안 만들었으면 example을 env-file로 사용.)

- [ ] **Step 8: db 기동 + 헬스 확인**

Run:
```bash
docker compose --env-file .env.docker.example up -d db
docker compose ps
```
Expected: `db` 서비스 상태 `healthy`(20~30초 내). 아니면 `docker compose logs db`로 원인 확인.

- [ ] **Step 9: pgvector 확장 적재 확인**

Run:
```bash
docker compose exec db psql -U postgres -d k7_mvp -c "SELECT extname FROM pg_extension WHERE extname='vector';"
```
Expected: `vector` 1행 출력.

- [ ] **Step 10: host backend가 컨테이너 DB에 붙는지 확인**

`.env`의 `DATABASE_URL`을 컨테이너 DB로 맞춘 뒤(`postgresql://postgres:postgres@localhost:5432/k7_mvp`) host에서 백엔드를 띄우고 health 확인.

Run:
```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 &
sleep 5
curl -s http://localhost:8000/health
```
Expected: `{"status":"ok","database":"connected","contract_version":"mvp-1.0"}`

- [ ] **Step 11: 커밋**

```bash
git add docker-compose.yml db/init/01-extensions.sql .env.docker.example .dockerignore .gitignore
git commit -m "feat(docker): pgvector db 서비스 + compose 스켈레톤"
```
(`.gitignore`에 `.env.docker` 한 줄 추가 후 스테이징.)

---

## Task 2: backend Dockerfile(cpu 타깃) + backend 서비스(스텁)

backend를 python:3.12-slim 컨테이너로 빌드해 db 컨테이너에 붙이고, 스텁 모드에서 `/health`와 `/analyze-text`가 동작하는지 확인한다.

**Files:**
- Create: `Dockerfile`
- Modify: `docker-compose.yml` (backend 서비스 추가)

**Interfaces:**
- Consumes: Task 1의 `db` 서비스(`db:5432`), `k7_pgdata` 볼륨.
- Produces: compose 서비스 `backend`(포트 8000), Dockerfile 타깃 `cpu`. gpu 오버레이가 `target: gpu`로 확장할 멀티스테이지 구조.

- [ ] **Step 1: `Dockerfile` 작성(cpu 타깃)**

```dockerfile
# syntax=docker/dockerfile:1

# ============ cpu 타깃 (팀원 랩탑, 스텁 모드) ============
FROM python:3.12-slim AS cpu
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    KMP_DUPLICATE_LIB_OK=TRUE
# libgomp1: lightgbm/faiss OpenMP · ffmpeg: 오디오 디코드(gpu 실모델용, cpu엔 무해)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: backend 서비스 추가 — `docker-compose.yml` 수정**

`services:` 아래(`db` 다음)에 추가:
```yaml
  backend:
    build:
      context: .
      target: cpu
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@db:5432/${POSTGRES_DB:-k7_mvp}
      USE_LOCAL_MODELS: ${USE_LOCAL_MODELS:-false}
      FRONTEND_ORIGIN: http://localhost:5173
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
```

- [ ] **Step 3: 빌드 검증(먼저 이미지 빌드가 되는지)**

Run: `docker compose --env-file .env.docker.example build backend`
Expected: `naming to ... backend` 성공. 실패 시 pip 로그에서 실패 패키지 확인(리눅스라 pyarrow VC++ 문제는 없어야 함).

- [ ] **Step 4: 스택 기동 + health 확인(테스트)**

Run:
```bash
docker compose --env-file .env.docker.example up -d db backend
sleep 8
curl -s http://localhost:8000/health
```
Expected: `{"status":"ok","database":"connected","contract_version":"mvp-1.0"}`

- [ ] **Step 5: 스텁 분석 경로 확인(테스트)**

Run:
```bash
curl -s -X POST http://localhost:8000/analyze-text \
  -H "Content-Type: application/json" \
  -d '{"text":"카드가 해외에서 결제됐다고 문자가 왔어요 보이스피싱 같아요","average_volume":0}'
```
Expected: HTTP 200 + `summary`/`category`/`emotion`/`urgency_score`/`routing`/`keywords` 필드를 가진 JSON(스텁 값). 연결 거부/500이 아니어야 함.

- [ ] **Step 6: 커밋**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat(docker): backend cpu 타깃 컨테이너화 + 스텁 스택 기동"
```

---

## Task 3: frontend Dockerfile + 서비스 (cpu 스택 완성)

`kda4-k7-product`를 Vite로 정적 빌드해 nginx로 서빙하는 컨테이너를 만들고, cpu 스택을 `docker compose up` 하나로 완성한다.

**Files:**
- Create: `../kda4-k7-product/Dockerfile` (frontend repo)
- Create: `../kda4-k7-product/nginx.conf` (frontend repo)
- Create: `../kda4-k7-product/.dockerignore` (frontend repo)
- Modify: `docker-compose.yml` (frontend 서비스 추가)

**Interfaces:**
- Consumes: Task 2의 `backend`(포트 8000). 브라우저가 `VITE_API_BASE_URL=http://localhost:8000`으로 접속.
- Produces: compose 서비스 `frontend`(host 5173 → 컨테이너 80).

- [ ] **Step 1: `../kda4-k7-product/nginx.conf` 작성(SPA fallback)**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: `../kda4-k7-product/.dockerignore` 작성**

```
node_modules/
dist/
.git/
*.md
```

- [ ] **Step 3: `../kda4-k7-product/Dockerfile` 작성(멀티스테이지)**

```dockerfile
# syntax=docker/dockerfile:1

# ---- 빌드 스테이지: Vite 정적 빌드 ----
FROM node:20-slim AS build
WORKDIR /app
# Vite 환경변수는 빌드 시 주입된다(런타임 변경 불가)
ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_DATA_API_PREFIX=/api/v1
ARG VITE_USE_REAL_DATA_API=1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_DATA_API_PREFIX=$VITE_DATA_API_PREFIX \
    VITE_USE_REAL_DATA_API=$VITE_USE_REAL_DATA_API
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 서빙 스테이지: nginx ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 4: frontend 서비스 추가 — `docker-compose.yml` 수정**

`services:` 아래(`backend` 다음)에 추가:
```yaml
  frontend:
    build:
      context: ../kda4-k7-product
      args:
        VITE_API_BASE_URL: http://localhost:8000
        VITE_DATA_API_PREFIX: /api/v1
        VITE_USE_REAL_DATA_API: "1"
    ports:
      - "5173:80"
    depends_on:
      - backend
```

- [ ] **Step 5: 빌드 검증**

Run: `docker compose --env-file .env.docker.example build frontend`
Expected: `npm run build`(`tsc --noEmit && vite build`)가 통과하고 nginx 이미지 생성. tsc 에러가 나면 프론트 소스 타입 문제 → 로그 확인.

- [ ] **Step 6: 전체 cpu 스택 기동(테스트)**

Run:
```bash
docker compose --env-file .env.docker.example up -d
sleep 10
docker compose ps
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```
Expected: 3개 서비스(db healthy, backend, frontend) 기동. curl이 `200` 반환.

- [ ] **Step 7: 브라우저 수동 확인**

`http://localhost:5173` 접속 → "옹기 · 상담 콘솔" 로드, 가이드 투어 스테퍼 표시, 데모 플로우 클릭이 backend(:8000)로 붙는지 확인(개발자도구 Network에서 200 응답).

- [ ] **Step 8: 커밋(두 repo)**

```bash
# frontend repo
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git add Dockerfile nginx.conf .dockerignore
git commit -m "feat(docker): Vite 정적 빌드 + nginx 서빙 Dockerfile"
# backend repo
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
git add docker-compose.yml
git commit -m "feat(docker): frontend 서비스 추가 — cpu 스택 완성"
```

---

## Task 4: `.env.docker` 흐름 정리 + `README-docker.md` (배포 문서)

팀원이 두 repo를 clone해 한 번에 실행하는 절차를 문서화하고, cpu 스택을 클린 상태에서 재현한다.

**Files:**
- Create: `README-docker.md`

**Interfaces:**
- Consumes: Task 1–3의 `docker-compose.yml`, `.env.docker.example`.

- [ ] **Step 1: `README-docker.md` 작성**

````markdown
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
- 대용량 모델 다운로드 없음. 분석/감정/RAG는 스텁·FAISS 폴백으로 동작(UI 흐름 데모).
- 종료: `docker compose --env-file .env.docker down` (데이터 유지) / `down -v`(볼륨까지 삭제)

## 데모 머신 (gpu 실모델) — docker-compose.gpu.yml
Task 5 참조. 요약:
```bash
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
docker compose exec ollama ollama pull exaone3.5:7.8b
docker compose exec ollama ollama pull bge-m3
docker compose exec backend python -m scripts.seed_rag_pgvector
```

## 자주 나는 문제
- **5432 already in use**: 로컬 PostgreSQL 서비스를 멈추거나(`Stop-Service postgresql-x64-17`) compose의 db 포트 매핑을 바꿔라.
- **frontend가 backend에 못 붙음**: `VITE_API_BASE_URL`은 빌드 시 고정된다. 포트를 바꿨으면 `docker compose build frontend`로 재빌드.
- **감정모델(.joblib) 없음**: gitignore라 팀원에겐 없다. cpu 스텁은 무방. gpu 실추론엔 별도 파일 공유 필요.
````

- [ ] **Step 2: 클린 재현 테스트**

Run:
```bash
docker compose --env-file .env.docker.example down -v
docker compose --env-file .env.docker.example up -d --build
sleep 15
curl -s http://localhost:8000/health && echo "" && curl -s -o /dev/null -w "front=%{http_code}\n" http://localhost:5173
```
Expected: health `connected`, `front=200`. 볼륨 삭제 후에도 스택이 처음부터 정상 기동.

- [ ] **Step 3: 커밋**

```bash
git add README-docker.md
git commit -m "docs(docker): 2-repo clone + cpu/gpu 실행 가이드"
```

---

## Task 5 (선택·데모 머신): gpu 실모델 경로

데모 머신에서 실제 STT/LLM/감정/pgvector를 쓴다. **권장 저위험 경로**와 **풀 컨테이너 대안** 중 택1.

> **권장(저위험)**: backend/whisper/ollama/emotion은 기존 host venv+.bat로 그대로 두고(이미 GPU 구동 검증됨), Docker는 **db(pgvector)만** 쓴다. 아래 5A. 
> **대안(고위험)**: backend까지 CUDA 컨테이너로. CUDA/cuDNN/ctranslate2 궁합 검증 필요. 아래 5B.

**Files (5B에서만):**
- Create: `docker-compose.gpu.yml`

**Interfaces:**
- Consumes: `scripts.seed_rag_pgvector`(기존), `rag_store.pgvector_ready()`(기존), 감정모델 `app/services/k7modeling/models/*.joblib`(host 로컬).

### 5A. 권장 경로 — host backend + Docker pgvector

- [ ] **Step 1: db 컨테이너만 기동 + host .env 설정**

`.env`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k7_mvp`, `USE_LOCAL_MODELS=true`, `OLLAMA_BASE_URL=http://localhost:11434`.
Run: `docker compose --env-file .env.docker.example up -d db`
Expected: db healthy.

- [ ] **Step 2: host Ollama 모델 확인(이미 있으면 재사용)**

Run: `curl -s http://localhost:11434/api/tags`
Expected: `exaone3.5:7.8b`, `bge-m3` 포함. 없으면 `ollama pull exaone3.5:7.8b && ollama pull bge-m3`.

- [ ] **Step 3: pgvector 시드(테스트)**

Run:
```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
./.venv/Scripts/python.exe -m scripts.seed_rag_pgvector
```
Expected: `완료: 청크 N개 적재, pgvector_ready = True`.

- [ ] **Step 4: end-to-end 확인(테스트)**

host에서 backend 기동 후 실제 한국어 샘플 오디오로 `/api/v1/calls`(multipart) 또는 `/analyze-text` 호출 → 응답의 `analysis_source`가 `REAL_MODEL`(스텁 아님)인지, RAG가 pgvector 경로인지 확인.
Expected: 실모델 응답 + pgvector 검색 동작.

- [ ] **Step 5: 커밋(없음)** — 5A는 코드 변경 없이 운영 절차. README-docker.md의 데모 머신 항목에 "5A 권장" 한 줄만 반영해 커밋.

```bash
git add README-docker.md
git commit -m "docs(docker): 데모 머신은 host backend + Docker pgvector(5A) 권장 명시"
```

### 5B. 대안 — 풀 컨테이너 gpu (고위험, 검증 필수)

- [ ] **Step 1: `docker-compose.gpu.yml` 작성**

```yaml
services:
  backend:
    build:
      target: gpu
    environment:
      USE_LOCAL_MODELS: "true"
      LOCAL_WHISPER_DEVICE: cuda
      OLLAMA_BASE_URL: http://ollama:11434
    volumes:
      - ./app/services/k7modeling/models:/app/app/services/k7modeling/models:ro
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    depends_on:
      ollama:
        condition: service_started

  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - k7_ollama:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

volumes:
  k7_ollama:
```

- [ ] **Step 2: gpu 타깃 추가 — `Dockerfile` 수정(cpu 타깃 아래에 append)**

```dockerfile
# ============ gpu 타깃 (데모 머신, 실모델) ============
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu24.04 AS gpu
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    KMP_DUPLICATE_LIB_OK=TRUE \
    DEBIAN_FRONTEND=noninteractive
# ubuntu24.04는 python3.12 기본 제공
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3-pip python3.12-venv libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN ln -sf /usr/bin/python3.12 /usr/local/bin/python
COPY requirements.txt .
RUN python -m pip install --break-system-packages -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: 11434 충돌 회피**

host Ollama가 떠 있으면 컨테이너 ollama와 5432/11434 충돌. host Ollama를 멈추거나(`taskkill /IM ollama.exe /F`) gpu.yml의 ollama 포트 매핑을 제거한다.

- [ ] **Step 4: 빌드 + 기동(테스트)**

Run:
```bash
docker compose --env-file .env.docker.example -f docker-compose.yml -f docker-compose.gpu.yml build backend
docker compose --env-file .env.docker.example -f docker-compose.yml -f docker-compose.gpu.yml up -d
```
Expected: 빌드 성공(CUDA 이미지 수 GB, 시간 소요). 실패 시 원인은 대개 ctranslate2↔cuDNN 버전 → 로그 확인 후 base 이미지 태그 조정.

- [ ] **Step 5: GPU 가시성 확인(테스트)**

Run: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec backend python -c "import ctranslate2; print(ctranslate2.get_cuda_device_count())"`
Expected: `1`(GPU 인식). `0`이면 GPU 전달 실패.

- [ ] **Step 6: 모델 pull + 시드 + end-to-end(테스트)**

Run:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec ollama ollama pull exaone3.5:7.8b
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec ollama ollama pull bge-m3
docker compose -f docker-compose.yml -f docker-compose.gpu.yml exec backend python -m scripts.seed_rag_pgvector
curl -s http://localhost:8000/health
```
Expected: 시드 `pgvector_ready = True`, health connected. 실제 오디오로 REAL_MODEL 응답 확인.

- [ ] **Step 7: 커밋**

```bash
git add docker-compose.gpu.yml Dockerfile
git commit -m "feat(docker): gpu 오버레이 + CUDA backend 타깃(데모 머신 실모델)"
```

---

## Self-Review (완료)

- **Spec 커버리지**: db(pgvector 통합)=Task1, backend 스텁/cuda=Task2/5B, frontend(kda4-k7-product)=Task3, 프로파일 분리=cpu(기본)/gpu(오버레이)=Task2·5, 모델·시드 처리=Task5, 번들 위치(backend repo)+2-repo=Task4, 함정 자동해소(리눅스 컨테이너)=Task2. 모두 태스크 존재.
- **스펙 대비 변경(의도적)**: gpu 프로파일 → `docker-compose.gpu.yml` 오버레이 파일 방식(단일 파일 profiles로는 GPU 예약 토글이 불편). ollama는 gpu에서 컨테이너(5B) 또는 host 재사용(5A) 택1 — 스펙의 "ollama 컨테이너"를 5B로 유지하되 저위험 5A를 권장으로 추가. 이 변경은 실행 핸드오프에서 사용자 확인 대상.
- **Placeholder 스캔**: 없음. 모든 스텝에 실제 파일 내용/명령/기대출력 포함.
- **타입 일관성**: 서비스명 `db`/`backend`/`frontend`/`ollama`, 볼륨 `k7_pgdata`/`k7_ollama`, Dockerfile 타깃 `cpu`/`gpu`, 시드 진입점 `scripts.seed_rag_pgvector`, health 응답 키(`status`/`database`/`contract_version`) 전 태스크 일치.
