# KARI-NA 발표용 배포 패키징 (Docker) — 설계 문서

- **작성일**: 2026-07-21
- **대상**: K7팀 KARI-NA MVP
- **목표 발표일**: 2026-07-29
- **번들 위치(확정)**: backend repo (`HeeChang50/kda4-k7-backend`)

## 1. 목적

팀원 각자 자기 랩탑에서 `docker compose up` 한 번으로 KARI-NA 데모 스택
(프론트 + 백엔드 + 벡터DB)을 띄울 수 있게 한다. 발표 데모 머신(이 랩탑, GPU 有)에서는
동일 compose로 실모델까지 구동한다.

리눅스 컨테이너로 옮기는 부수 효과로 이 랩탑의 두 고질 함정이 자동 해소된다:
- Windows **Smart App Control**의 faster-whisper 미서명 DLL 차단
- **한글경로**(금융콜센터AI) 아래 opensmile C 백엔드 크래시

## 2. 확정된 설계 결정

| # | 결정 | 값 |
|---|------|-----|
| 1 | 실행 주체 | 팀원 각자 랩탑 (대부분 GPU 없음) + 데모 머신(이 랩탑, RTX 3070 Ti 8GB) |
| 2 | GPU 없는 랩탑의 LLM | **스텁 모드** (UI 흐름 데모, 대용량 모델 다운로드 0) |
| 3 | 프론트엔드 | `kda4-k7-product` (Vite+React18) 포함. `frontend/`(Next.js)는 빈 스캐폴드라 제외 |
| 4 | 벡터DB | PostgreSQL 17 + pgvector, **단일 컨테이너로 통합**(별도 Chroma 불필요) |
| 5 | 프로파일 | `cpu`(팀원, 스텁·기본값) / `gpu`(데모 머신, 실모델) 분리 |
| 6 | STT/emotion 함정 | 리눅스 컨테이너로 Smart App Control·한글경로 문제 자동 해소 |
| 7 | 번들 위치 | backend repo에 compose 일습 배치, frontend는 sibling 체크아웃을 빌드 컨텍스트로 참조 |

## 3. 아키텍처

```
cpu 프로파일 (팀원 랩탑, 기본값)
  frontend(:5173) → backend(:8000, USE_LOCAL_MODELS=false) → db(pgvector :5432)

gpu 프로파일 (데모 머신)
  frontend(:5173) → backend(:8000, cuda) → db(pgvector :5432)
                            └→ ollama(:11434, exaone3.5:7.8b + bge-m3)
```

- 브라우저는 호스트에서 실행되며 published 포트로 backend에 접속(각 팀원의 `localhost`).
- 컨테이너 간 통신은 compose 기본 네트워크의 서비스명(`db`, `ollama`, `backend`)으로 한다.

### 서비스 요약

| 서비스 | 이미지/빌드 | cpu | gpu | 포트(host:container) |
|--------|-------------|-----|-----|----------------------|
| **db** | `pgvector/pgvector:pg17` | ✅ | ✅ | 5432:5432 |
| **ollama** | `ollama/ollama` | ❌ | ✅ | 11434:11434 |
| **backend** | `./backend` (Dockerfile, py3.12) | ✅ 스텁 | ✅ cuda | 8000:8000 |
| **frontend** | `../kda4-k7-product` (Dockerfile) | ✅ | ✅ | 5173:80 |

## 4. 서비스별 상세 설계

### 4.1 db (pgvector/pgvector:pg17)
- 두 프로파일 모두 기동. `POSTGRES_DB=k7_mvp`, 비밀번호는 `.env.docker`에서 주입.
- **초기화 스크립트**(`/docker-entrypoint-initdb.d/`): `CREATE EXTENSION IF NOT EXISTS vector;`
  까지만 수행(두 프로파일 공통). RAG 시드 임베딩 적재는 db init이 아니라 gpu 프로파일의
  별도 시드 스크립트에서 한다(§5 결정) — cpu는 임베딩 생성 수단(ollama)이 없기 때문.
- 명명 볼륨으로 데이터 영속(`k7_pgdata`).
- **주의**: pgvector 실경로가 채워지려면 임베딩(1024차원, bge-m3)이 있어야 하고, 그 생성엔
  ollama가 필요하다. 따라서 gpu 프로파일만 pgvector 실경로를 쓰고, cpu 프로파일은 FAISS
  폴백을 그대로 쓴다(스텁 데모엔 충분, 추가 다운로드 0). 상세는 §5.

### 4.2 ollama (ollama/ollama) — gpu 프로파일 전용
- `deploy.resources.reservations.devices`로 GPU 예약(nvidia).
- 명명 볼륨(`k7_ollama`)에 모델 저장. 최초 기동 시 `exaone3.5:7.8b` + `bge-m3` pull
  (init 컨테이너 또는 헬스체크 후 `ollama pull` 실행).
- backend는 `OLLAMA_BASE_URL=http://ollama:11434`로 접속.
- **VRAM 주의**: 8GB에 exaone3.5:7.8b(양자화 ~5GB) + whisper large-v3-turbo 동시 상주는
  빠듯할 수 있음. 필요 시 whisper 모델을 `large-v3-turbo`(경량) 유지 또는 순차 로딩.

### 4.3 backend (./backend/Dockerfile)
- 베이스: `python:3.12-slim`. `requirements.txt` 설치.
  - gpu 프로파일에서 CUDA whisper를 쓰려면 CUDA 런타임 필요 → **멀티스테이지 또는
    프로파일별 베이스 분리**: cpu=slim, gpu=`nvidia/cuda:12.x-cudnn-runtime` 기반.
    (구현 시 Dockerfile target 또는 두 stage로 처리)
- opensmile/lightgbm/pyarrow==18.1.0 등 감정모델 의존성 포함. 리눅스라 pyarrow 25.x
  VC++ 충돌은 없으나, 재현성을 위해 핀 유지.
- 환경변수(프로파일별):
  - **cpu**: `USE_LOCAL_MODELS=false` → STT/LLM/emotion 전부 스텁 폴백.
  - **gpu**: `USE_LOCAL_MODELS=true`, `LOCAL_WHISPER_DEVICE=cuda`, `OLLAMA_BASE_URL=http://ollama:11434`.
  - 공통: `DATABASE_URL=postgresql://postgres:***@db:5432/k7_mvp`.
- **감정모델 .joblib**(14MB, gitignored): gpu 프로파일에서만 필요. 이 랩탑 로컬 파일을
  bind mount(`./backend/app/services/k7modeling/models/…:…:ro`). cpu는 스텁이라 불필요.
- 포트 8000. CORS에 `http://localhost:5173` 포함(이미 config에 있음).

### 4.4 frontend (../kda4-k7-product/Dockerfile)
- 멀티스테이지: `node:20` 빌드(`npm ci && npm run build` → `dist/`) → `nginx:alpine`로 서빙.
- **Vite 빌드타임 주입 주의**: `VITE_API_BASE_URL`은 런타임이 아니라 **빌드 시** 고정됨.
  각 팀원 브라우저가 자기 `localhost:8000`으로 접속하므로 `VITE_API_BASE_URL=http://localhost:8000`,
  `VITE_DATA_API_PREFIX=/api/v1`, `VITE_USE_REAL_DATA_API=1`로 빌드.
- nginx가 80 포트 서빙 → host 5173로 매핑.

## 5. 모델·시드 파일 처리

| 자원 | cpu 프로파일 | gpu 프로파일 |
|------|-------------|-------------|
| Whisper 모델 | 불필요(스텁) | HF 캐시 볼륨에 최초 다운로드 |
| Ollama exaone/bge-m3 | 불필요(스텁) | ollama 볼륨에 pull |
| 감정모델 .joblib | 불필요(스텁) | 로컬 파일 bind mount |
| pgvector RAG 시드 | **FAISS 폴백 사용**(결정) | ollama bge-m3로 시드 임베딩 생성 후 적재 |

- **결정**: cpu 프로파일은 pgvector 시드 임베딩을 만들 수단(ollama)이 없으므로 RAG는
  기존 FAISS 인메모리 폴백을 그대로 사용한다. 스텁 데모 목적에 충분하고 추가 다운로드가 없다.
- gpu 프로파일은 db init 후 시드 스크립트(`scripts/seed_pgvector.py` 신규)로 bge-m3 임베딩을
  생성·적재한다.

## 6. 폴백·에러 처리

- backend는 이미 계층적 폴백을 갖춤: 모델 부재 시 `analysis_source=STUB`(+`[SOURCE=…]` 접두사),
  pgvector 미준비 시 FAISS 폴백. → cpu 프로파일이 자연스럽게 degrade.
- ollama 미기동(cpu) 시 LLM 호출은 스텁 경로로 빠져야 하며, 예외로 데모가 끊기지 않아야 한다.
- db는 두 프로파일 필수. 헬스체크(`pg_isready`)로 backend 기동 순서 보장(`depends_on: condition`).

## 7. 번들 위치 & 배포

- compose 일습을 **backend repo 루트**에 둔다:
  - `docker-compose.yml`(프로파일 cpu/gpu), `backend/Dockerfile`, `.env.docker.example`,
    `db/init/01-extension.sql`, `README-docker.md`.
- frontend는 별도 repo(`kda4-k7-product`)이므로, compose의 frontend 빌드 컨텍스트를
  **sibling 경로**(`../kda4-k7-product`)로 참조한다. 팀원은 두 repo를 형제 폴더로 clone.
  - 전제 디렉터리 구조:
    ```
    <work>/kda4-k7-backend/   (docker-compose.yml 여기)
    <work>/kda4-k7-product/   (frontend 빌드 컨텍스트)
    ```
- README에 clone 2개 + `docker compose --profile cpu up` 절차 명시.

## 8. 테스트 전략

- **cpu 프로파일**(모든 개발 환경에서): `docker compose --profile cpu up -d` →
  - `GET /health` 200
  - `POST /api/v1/...`(데모 엔드포인트) → `analysis_source=STUB` 응답 확인
  - 브라우저 `http://localhost:5173` 로드 → 데모 플로우 클릭 통과
- **gpu 프로파일**(이 랩탑): `docker compose --profile gpu up -d` →
  - ollama exaone/bge-m3 pull 완료 확인
  - 실제 한국어 샘플 오디오로 STT→분석→감정온도 end-to-end
  - `rag_store.pgvector_ready()` True + pgvector 검색 경로 동작

## 9. 구현 순서 (pgvector가 첫 빌딩블록)

1. **db 서비스 + pgvector init/시드** → 이 랩탑 RAG 실경로 복원(현재 FAISS 폴백만 도는 상태 해소)
2. **backend Dockerfile**(cpu/gpu 타깃) → 컨테이너화, db 연결, 스텁·실모델 양쪽 검증
3. **frontend Dockerfile** → kda4-k7-product 정적 빌드 + nginx 서빙
4. **compose 프로파일(cpu/gpu) + env 배선** → `.env.docker.example`
5. **번들 문서**: `README-docker.md`(2-repo clone + `docker compose --profile cpu up`)

## 10. 범위 밖 (YAGNI)

- 클라우드/원격 배포(Railway 등) — 로컬 발표 데모 목적에 한정.
- 프로덕션 시크릿 관리·TLS·리버스 프록시 — 데모 범위 밖.
- `frontend/`(Next.js) 컨테이너화 — 빈 스캐폴드라 제외.
- CI 파이프라인에서의 이미지 빌드·푸시 — 이후 과제.

## 11. 열린 리스크

- **VRAM 8GB 한계**: gpu 프로파일에서 exaone3.5:7.8b + whisper 동시 상주 시 OOM 가능 →
  실측 후 whisper 모델 크기/로딩 전략 조정 필요.
- **CUDA 베이스 이미지 크기**: gpu backend 이미지가 수 GB로 커짐 → 데모 머신에선 1회 빌드라 허용.
- **Vite 빌드타임 API URL**: 팀원이 backend 포트를 바꾸면 frontend 재빌드 필요(문서에 명시).
- **감정모델 .joblib 배포**: gitignored라 팀원에겐 없음 → cpu 스텁이라 무방하나, 다른 팀원이
  gpu 프로파일을 쓰려면 별도 파일 공유 필요(README에 명시).
