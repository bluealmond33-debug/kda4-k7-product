# registry.csv 검증 및 설명

## 1. 생성한 파일
- 경로: `03 Research/registry.csv`
- 역할: PDF 메타데이터와 실제 문서 위치를 정리한 목록

## 2. 검증 결과
- 총 행 수: 28
- 소스 경로가 실제 파일과 일치하는 경우: 25
- 경로 불일치/미발견 항목: 3

### 불일치 항목
1. `대출거래 상품설명서(월상환액 고정형).pdf`
   - 현재 실제 파일명: `조회_설명서/대출/대출거래 상품설명서(월상환액 고정형 주택담보대출용).pdf`
   - 제안 수정: `file_name` 또는 `source_path`를 일치시켜야 함

2. `(부록)대출상품 용어안내.pdf`
   - 현재 실제 파일 없음
   - 해당 파일이 `03 Research/_derived/` 아래에 없다면 실제 원본을 추가하거나 해당 행을 제거/수정해야 함

3. `개인형IRP 핵심설명서.pdf`
   - 실제 파일명: `조회_설명서/연금/개인형 IRP 핵심설명서.pdf` (공백 포함)
   - 제안 수정: `file_name` 또는 `source_path`를 실제 파일명과 동일하게 맞추기

## 3. 컬럼/태그 검토
### 현재 포함된 컬럼
- `file_name` (필수)
- `category` (필수): RAG 대분류 태그
- `subcategory` (권장): 세부상품/세부업무
- `document_type` (권장): 상품설명서/약관/용어집 등
- `version` (권장): v1/v2 등 버전 관리
- `status` (권장): active/review/superseded 등
- `source_path` (필수): 실제 PDF 경로
- `doc_id` (선택): 내부 문서 ID
- `effective_date` (선택): 개정일/적용일
- `form_no` (선택): 양식번호/약관번호
- `chunk_profile` (선택): 청킹 방식 안내
- `bank_scope` (선택): 은행 대상 범위(예: HANA, KB 등)
- `category_secondary` (선택): 추가 분류가 필요할 경우
- `notes` (선택): 검토 사항, 중복 여부, 특이정보

### 추가로 고려할 만한 컬럼
- `page_count`: PDF 길이 확인용
- `language`: 주로 한글/영문 여부
- `document_status`: `draft` vs `published` vs `archived`
- `reviewer`: 검토 담당자
- `review_date`: 검토 완료일

## 4. 권장 수정 및 다음 작업
1. `source_path`는 실제 PDF 위치를 정확히 반영해야 함
   - 현재 대부분 경로는 `조회_설명서/...`로 수정됨
2. `file_name`은 실제 PDF 파일명과 일치시키는 것이 좋음
3. `category`/`subcategory` 값은 지금 구조로 충분하지만,
   - `category_secondary`는 필요 시에만 채우기
4. `status`에 `review` 또는 `superseded` 같은 값을 더 활용하면
   - 나중에 백엔드에서 `active`만 필터링하기 쉬워짐

## 5. 백엔드 전달 시 함께 줄 내용
- 이 CSV는 `PDF 인덱스 테이블` 역할을 합니다.
- 백엔드는 `source_path`를 기준으로 PDF를 열고, `category`/`subcategory`를 메타데이터로 사용합니다.
- `chunk_profile`은 청킹 방식 가이드이며, 백엔드가 자동 청킹을 수행할 때 참고 정보로 사용될 수 있습니다.
- 현재 `registry.csv`는 팀 Git에 올려 공유하면 됩니다.
