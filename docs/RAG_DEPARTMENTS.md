# RAG 부서 정리 — 어떤 규정 문서를 검색할까

> 작성일: 2026-07-23
> 관점: **검색(retrieval)**. 배정된 용건에 맞는 규정 문서를 찾는 축.
> 기준: `database/rag/{registry.csv, chunks.jsonl}` — `kdh` 브랜치 (문서 33건 / 청크 1,164개)
> 짝 문서: [`ROUTING_DEPARTMENTS.md`](./ROUTING_DEPARTMENTS.md) — 배정 축

---

## 0. 이 문서의 축

```
[통화 쪽]  task_code → 부서 · business_code  ─┐
                                              ├→ 매칭 = RAG 검색
[문서 쪽]  PDF → 전처리 → 부서 · business_code ─┘  (미리 태깅됨)
```

**두 축이 만나는 지점은 `부서`와 `business_code`다.** S/G/E는 만나지 않는다.

### S/G/E는 검색 필터가 아니다

`backend/app/rag/store.py`의 하이브리드 검색 SQL이 쓰는 필터는 하나뿐이다.

```sql
AND (%(category)s::text IS NULL OR %(category)s::text = ANY (d.categories))
```

`routing`은 검색 코드에 등장하지 않는다. 청크에 `routing` 값이 태깅돼 있으나 검색에 사용되지 않는다.
문서는 **주제**로 정의되지 처리 등급으로 정의되지 않기 때문이다.
(예: 대출 약관은 `G` 통화에도 `E` 대출사기 상담에도 필요하다.)

### 문서에 `task_code`를 붙이지 않는 이유

문서 1건이 여러 용건에 답한다. 대출 상품설명서 1건 → `S005`·`G002`·`G008`·`G009`.
`task_code`를 붙이면 리스트가 되고, 용건이 늘 때마다 문서를 재태깅해야 한다.
`business_code`는 그 묶음이라 문서 입도에 맞는다.

---

## 1. 부서별 문서 보유 현황

| 부서 | business_code | 문서 | 청크 |
|---|---|---:|---:|
| LON 여신·대출 | `loan` | 21 | 880 |
| DEP 수신·예적금 | `subscription` | 5 | 180 |
| FX 외환 | `fx` | 4 | 61 |
| INV 연금·투자 | `pension` | 1 | 29 |
| SG 사고·신고 | `misremit` | 1 | 11 |
| DEP 수신·예적금 | `deposit` | 1 | 3 |
| CRD 카드·결제 | `card` | **0** | **0** |
| EFN 전자금융 | `efn` | **0** | **0** |
| ETC 기타·공통 | `general` | **0** | **0** |
| **합계** | | **33** | **1,164** |

### 구성
- **본문 청크 + 표 청크.** 하나은행 PDF 32건에서 1,153청크, 텍스트 사례집 1건에서 11청크.
- 스캔본(`발행어음.pdf`)은 PaddleOCR 처리.
- 보이스피싱 사례집은 *사례별 1청크* 방식(자연 경계 분할).

---

## 2. 커버리지 — 배정 코드와 교차

검색이 성립하려면 **양쪽에 다 있어야 한다.**

| business_code | task코드 | 문서 | 상태 |
|---|---:|---:|---|
| `card` | 17 | **0** | 🔴 코드만 — 검색 불가 |
| `deposit` | 5 | 1 | ⚠️ 문서 빈약 (청크 3개) |
| `loan` | 4 | 21 | ✅ |
| `efn` | 3 | **0** | 🔴 코드만 — 검색 불가 |
| `misremit` | 3 | 1 | ✅ |
| `general` | 2 | **0** | 🔴 코드만 — 검색 불가 |
| `fx` | 1 | 4 | ✅ |
| `subscription` | **0** | 5 | 🟡 문서만 — 도달 불가 |
| `pension` | **0** | 1 | 🟡 문서만 — 도달 불가 |
| **합계** | **35** | **33** | |

### 🔴 코드는 있는데 문서가 없다 — 22개 코드 (63%)
`card`·`efn`·`general`. 이 용건으로 상담이 오면 **검색할 규정이 없다.**
특히 `card` 17개는 전부 `AI_CC`(자동응답)라 **근거 문서 없이 AI가 답하는 구조**다.

### 🟡 문서는 있는데 코드가 없다 — 6건
`subscription` 5건(주택청약 180청크)·`pension` 1건(IRP 29청크).
**어떤 `task_code`로도 도달할 수 없다.** 전처리는 끝났으나 호출할 용건이 없다.

### ⚠️ `deposit`이 빈약하다
배정 코드 5개(잔액·거래내역·자동이체·만기해지)가 걸려 있는데 문서 1건·청크 3개뿐이다.
DEP 청크 183개 중 180개가 `subscription`(청약)이고 `deposit`은 사실상 비어 있다.

---

## 3. 청킹·태깅 기준

각 청크에 붙는 필드:

| 필드 | 값 | 검색 사용 |
|---|---|---|
| `department` | DEP·LON·FX·INV·SG | ✅ `categories` 필터 |
| `business_code` | deposit·subscription·loan·fx·pension·misremit | ✅ `categories` 필터 |
| `routing` | G(32건) · E(1건) | ❌ 미사용 |
| `categories` | `[department, business_code]` | ✅ 실제 필터 대상 |
| `entities` | 법령·서식코드·개정일 | 보조 |
| `text` | 맥락 헤더 + 본문 | 임베딩·키워드 대상 |

청킹 규칙: 구조 마커(`◇ 제N조 ①~⑳`) 분리 · 표 별도 마크다운 · 중복 해시 제거 · 1200자 캡.
텍스트-only 콘텐츠는 자연 경계(사례·항목) 단위로 1청크.

---

## 4. 문서 확보 우선순위

1. **CRD 카드 규정** — 배정 코드 17개가 대기 중. 최우선.
2. **EFN 전자금융** — 이체한도·제한계좌 관련.
3. **ETC 공통 안내** — 영업시간·FAQ. 텍스트-only일 가능성이 높아 *사례별 1청크* 방식이 적합.
4. **DEP `deposit` 보강** — 예적금 문서가 1건뿐이다.

분류기 쪽에 요청할 것: `subscription`·`pension` 업무코드 신설 (문서는 이미 있음).

---

## 5. 미연결 상태

- **온프레미스 적재**: bge-m3 임베딩 + pgvector 적재 필요. `database/rag/README.md` 참조.
- **검색 엔드포인트**: `/api/v1/regulations/search` 구현됨. DB·임베딩 연결 후 동작.
- **프론트**: `src/services/regulationSearch.ts` 추가됨(팀원 작업).

---

## 6. 참고

- 산출물: `database/rag/{chunks.jsonl, registry.csv}`
  — `main`은 32건, **`kdh`는 33건**(보이스피싱 사례집 추가분, main 미머지)
- 적재 절차: `database/rag/README.md`
- 검색 구현: `backend/app/rag/store.py`
- 전처리 엔진: `backend/app/rag/auto_ingest.py` (`preview`/`commit`)
- 분류 체계: `backend/app/rag/taxonomy.py` (8대분류)
