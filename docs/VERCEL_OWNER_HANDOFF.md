# K7 Vercel 소유자 최종 연결 체크리스트

## 목적

현재 `https://k7product.vercel.app`은 접속되지만 배포 번들에 `/api/v1/calls`와 Railway 운영 주소가 없고 기존 `/summarize` 호출만 남아 있다. 아래 설정으로 `lch`의 통합 음성 API 연결을 소유자 계정에서 직접 배포한다.

Vercel 유료 팀 권한 공유는 필요하지 않다.

## 사용할 환경변수

```dotenv
VITE_API_BASE_URL=https://kda4-k7-backend-production.up.railway.app
VITE_USE_REAL_DATA_API=true
VITE_DATA_API_PREFIX=/api/v1
```

다음 이전 플래그는 새 통합 경로의 완료 조건이 아니다.

```text
VITE_USE_REAL_SUMMARY
VITE_USE_REAL_EMOTION
```

감정온도는 텍스트 `/emotion`을 별도로 호출하지 않는다. 실제 음성 모델이 연결되면 `POST /api/v1/calls`의 `consultation_card.emotion`으로 함께 받는다. 준비 전에는 `unavailable`을 표시한다.

## 배포할 코드

- repository: `bluealmond33-debug/kda4-k7-product`
- source branch: `lch`
- current integration PR: #1

`lch` UI에서 “실제 마이크”라는 오해 가능한 문구는 “음성 파일”로 변경됐다. 현재 MVP는 브라우저 연속 녹음이나 전화망 스트리밍이 아니라 완성된 음성 파일 업로드 방식이다.

## 화면 동작

```text
음성 파일 선택
→ POST /api/v1/calls
→ 201 + call_id + mvp-1.0 상담카드
→ 상담 준비 카드 표시
```

React는 PostgreSQL에 직접 연결하지 않는다. 필요할 때 다음 API로 저장 결과를 재조회한다.

```text
GET /api/v1/calls/{call_id}/consultation-card
```

## 배포 후 검증

1. Vercel 사이트가 HTTP 200으로 열린다.
2. 브라우저 개발자 도구 Network에서 `/api/v1/calls` 요청이 보인다.
3. 음성 파일 업로드 요청이 `201`이다.
4. 응답의 `schema_version`이 `mvp-1.0`이다.
5. `source_channel`이 `voice`다.
6. 화면의 요약·업무유형·부서·위험도가 응답값과 일치한다.
7. 감정 모델이 없으면 “모델 미연동”으로 표시되고 임의 점수를 보여주지 않는다.
8. 번들에서 기존 `/summarize` 또는 텍스트 `/emotion`이 활성 상담카드의 데이터 출처가 아니다.

## 외부 차단 시 보고할 내용

- Vercel 프로젝트 소유 계정
- 배포한 branch와 commit
- 설정한 환경변수 이름만 기록하고 값·비밀키는 공개하지 않음
- 실패한 deployment URL
- Network의 HTTP 상태와 오류 본문
