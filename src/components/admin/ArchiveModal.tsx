import { useEffect, useState, type ReactNode } from "react";
import { css } from "../../lib/css";
import { BrandSymbol } from "../BrandLogo";

const FONT = "'Avenir Next','Pretendard',sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";
const BASE = "https://claude.ai/code/artifact/";

/**
 * 자료실 — KARI-NA 발표·분석·설계 자료를 8주제로 합본한 종합 브리핑 모달.
 * 링크 나열이 아니라, 레포(k7-hippo·k7-product·k7-backend) 원천을 정독해 재구성한 실내용을
 * 주제별 탭으로 담는다. 각 주제 하단에 관련 원문(claude.ai 아티팩트) 링크를 붙인다.
 * 색은 점·가는 레일·태그에만(ONAIR).
 */

type Blk =
  | { t: "lede"; html: ReactNode }
  | { t: "rowh"; s: string }
  | { t: "metrics"; items: { v: string; l: string }[] }
  | { t: "cards"; cols?: 2 | 3; items: { h?: string; k?: string; lines: ReactNode[] }[] }
  | { t: "quotes"; items: { q: ReactNode; sub: string }[] }
  | { t: "flow"; items: { a: string; b: string; c?: string }[] }
  | { t: "badges"; items: string[] }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "note"; html: ReactNode };

type Topic = { name: string; color: string; blocks: Blk[]; links: { t: string; id: string }[] };

const TOPICS: Topic[] = [
  {
    name: "문제·기획", color: "#C13B60",
    blocks: [
      { t: "lede", html: <>은행 콜센터는 콜센터 고통이 가장 크고, 잘 풀면 가장 크게 이득 보는 곳이다. 우리는 <b>ARS를 없애지 않고 그 위에 준비 레이어를 얹어</b> "기다리는 콜센터 → 준비되는 콜센터"로 바꾼다.</> },
      { t: "cards", cols: 3, items: [
        { h: "규정·본인확인의 무게", lines: [<>금융은 확인 절차가 무거워 <b>한 콜당 시간이 길고 대기가 길다</b></>] },
        { h: "부서가 많다", lines: [<>대출·카드·전자금융·사고… 오연결·재이관이 잦고, 옮길 때마다 고객은 처음부터 다시 말한다</>] },
        { h: "긴급은 골든타임", lines: [<>보이스피싱·착오송금은 기다리는 동안 피해가 커진다 — <b>지연이 곧 손실</b></>] },
      ] },
      { t: "rowh", s: "현직자 인터뷰 — 삼성전자 온라인몰 콜센터 실무자 (발견 인터뷰 실데이터)" },
      { t: "quotes", items: [
        { q: <>"아까 다 설명했는데 <b>또요?</b>"</>, sub: "재이관 시 반복 설명 → 고객 화" },
        { q: <>후처리(ACW) 중 <b>다음 콜이 막힌다</b></>, sub: "이력 작성 길수록 생산성 손실" },
        { q: <>방대한 매뉴얼, 초보는 <b>"잠시만요"</b></>, sub: "정보 못 찾아 대기 → 품질 편차" },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "검증할 가설", lines: [<>상담 전 고객 발화를 <b>근거와 함께 한 장 준비 카드</b>로 주면, 상담사가 더 빠르고 안전하게 첫 질문·처리 순서를 정한다</>, <>실제 시간 단축·재이관 감소는 <b>아직 미입증</b> — 상담사 비교실험이 다음 단계</>] },
        { h: "현장 KPI 재정의", lines: [<>현장: 시간당 콜 수·부재중 금지·<b>FCR</b></>, <>우리: "콜 수"가 아니라 <b>오연결·재전환율·containment</b>로</>] },
      ] },
    ],
    links: [{ t: "상담 업무 흐름 Before → After", id: "bb32f6ad-b083-4636-93ef-e47d89c7af34" }, { t: "프로젝트 전체 안내서", id: "fee1c4bf-5321-48ee-9b4b-1578464cddea" }, { t: "발표 대본 — 완전판(15분)", id: "413ef3e0-c096-4748-9d8b-b710dcb10be7" }],
  },
  {
    name: "경쟁·전략", color: "#2F62C4",
    blocks: [
      { t: "lede", html: <>증권·보험 모두 AI를 <b>상담사 보조·사후 모니터링</b>까지 썼다. 하지만 <b>실시간 위험 스코어 → 긴급 라우팅 + 고객 사전접수 카드</b>를 리드로 삼은 곳은 없다 — 그 공백이 우리 자리다.</> },
      { t: "rowh", s: "증권사" },
      { t: "cards", cols: 3, items: [
        { h: "신한투자증권", lines: [<>금융권 최초 클라우드 AICC — 실시간 STT+TA+KMS, KSQI 4년 연속</>] },
        { h: "미래에셋증권", lines: [<>RAG AI 어시스턴트(직원 78%) — 상담 <b>자동 분류·요약</b></>] },
        { h: "KB증권", lines: [<>AICC 정식 — STT/TA + <b>실시간 상담 모니터링</b></>] },
      ] },
      { t: "rowh", s: "보험사" },
      { t: "cards", cols: 3, items: [
        { h: "한화·삼성생명", lines: [<>성문 분석·보이스피싱 위험건 선별 — 단, <b>자사 방어용</b></>] },
        { h: "DB손해보험", lines: [<>심사 40분→3분(정확도 99%↑), 로보텔러 사고접수</>] },
        { h: "공통 한계", lines: [<>완전판매·사후 녹취 분석 중심 — <b>긴급 트리아지 서사 아님</b></>] },
      ] },
      { t: "rowh", s: "우리 해자 (차별점)" },
      { t: "cards", cols: 3, items: [
        { k: "01", h: "실시간 위험 라우팅", lines: [<>위험 스코어 → 긴급 패스트레인</>] },
        { k: "02", h: "고객 사전접수 카드", lines: [<>연결 전 준비된 한 장</>] },
        { k: "03", h: "폐루프 + 온프레미스", lines: [<>후처리 학습 축적 · 폐쇄망 작동</>] },
      ] },
    ],
    links: [
      { t: "전략 브리핑 — 비교불가 1위로 가는 법", id: "ad9c3c43-c792-45da-98c1-fad5cb5661cd" },
      { t: "경쟁 분석 — 채점·예상질문 30", id: "c505e5e2-9d0b-4e65-b56a-2e290b2cb180" },
      { t: "의사결정 원장 — 15개 쟁점", id: "560c5f74-7774-47c2-aa77-4fb6dd74cbaf" },
    ],
  },
  {
    name: "아키텍처", color: "#0E8A72",
    blocks: [
      { t: "lede", html: <>완전 온프레미스 <b>3노드</b> 구성. 고객·상담원 오디오가 처음부터 다른 장치에서 들어오므로 무거운 화자 분리 없이 각 송신기가 <b>speaker</b>를 명시한다.</> },
      { t: "flow", items: [
        { a: "NODE 1", b: "Galaxy + 고객 노트북", c: "WO Mic → customer edge" },
        { a: "NODE 2 · 중앙 서버", b: "2채널 STT · EXAONE · RAG · DTMF", c: "call_id 발급·결합" },
        { a: "NODE 3", b: "상담원 노트북", c: "agent edge · 상담 화면" },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "이중 파이프라인", lines: [<><b>텍스트</b>: STT → EXAONE(요약·분류·위험)</>, <><b>음성</b>: 원본 → 감정 모델(점수·단계)</>, <>둘을 <b>call_id</b>로 결합 — 텍스트를 감정 결과로 못 씀</>] },
        { h: "통화 수명주기", lines: [<>call_id + <b>generation</b> 증가 · audio_seq · captured_at_ms</>, <>이전 통화 지연·중복·역순 패킷 차단</>, <>종료: gate close → tail flush → STT drain → final_seq → call_end</>] },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "WebSocket 계약", lines: [<span className="k-mono">/ws/audio/{"{id}"}?speaker=customer|agent</span>, <span className="k-mono">/ws/ars · /ws/call?role=agent</span>, <>K7A1 프레임: magic·generation·audio_seq·PCM16</>] },
        { h: "장애 철칙", lines: [<><b>"AI가 죽어도 전화는 계속된다"</b></>, <>준비카드 실패 → 빈 카드 + 수동 모드 강등</>, <>WebSocket = 준비카드 '도착' UX의 기술 전제</>] },
      ] },
      { t: "badges", items: ["5173 UI", "8000 FastAPI/WS", "11434 Ollama", "60000 UDP WO Mic", "방화벽 4포트만"] },
      { t: "note", html: <><b>두 트랙 구분:</b> ① 배치(mvp-1.0, 완성 음성파일 일괄 — 이희창 Railway 운영본) ② 실시간(codex live-call, 3노드 WebSocket — 데모가 보여주는 것). 발표·문서에서 두 열을 섞지 않는다.</> },
    ],
    links: [
      { t: "아키텍처 · 데이터 흐름 · 구현 상태", id: "3531b8b8-9df8-4594-98a7-10195015914f" },
      { t: "기술 문서", id: "cac4060e-addd-4ac8-9c3b-db37a037794a" },
    ],
  },
  {
    name: "데이터·모델", color: "#B67916",
    blocks: [
      { t: "lede", html: <>공개 데이터 + 자체 구축 + 가상 목업으로 규칙+ML+LLM 캐스케이드를 돌린다. 전 과정 <b>로컬</b>(Ollama·faster-whisper·pgvector) — 인터넷 없이 작동.</> },
      { t: "rowh", s: "라우팅 분류기 실측 (전형진 평가 하네스 · AI-Hub 은행 검증셋)" },
      { t: "metrics", items: [
        { v: "97.0%", l: "3분류 macro-F1 (69.9→97.0)" },
        { v: "83%", l: "긴급 precision (50→83, 그레이존 제외 100%)" },
        { v: "93%", l: "단순 recall 자연발화 (40→93)" },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "3단계 캐스케이드", lines: [<>규칙 게이트(LLM보다 먼저·긴급 recall floor) → SGE(E/S/G) → 부서 → 업무코드(G001~G012)</>, <>주제모델 = TF-IDF + LinearSVC (NIA 10종), margin&lt;0.75는 <b>G004 폴백</b></>, <>일반(G) 실데이터 P/R = <b>99.4 / 99.1</b></>] },
        { h: "모델 스택", lines: [<>STT: faster-whisper small/cpu/int8(한국어)</>, <>LLM: EXAONE 3.5 <b>2.4b</b>(7.8b도 설치) · grounding guard</>, <>음향감정: eGeMAPS + LightGBM</>, <>RAG: bge-m3 + pgvector, dense .65+kw .35(HNSW)</>] },
      ] },
      { t: "rowh", s: "세부 업무코드 = 천장 · 마진 임계값 트레이드오프 (실데이터 320건)" },
      { t: "table", head: ["마진", "세부코드 정답", "오배정", "안전보류(G004)"], rows: [
        ["0.75 (현재)", "66%", "7%", "27%"],
        ["0.50 (권장 후보)", "72%", "8%", "19%"],
        ["0.00 (모델 실력)", "82%", "18%", "0%"],
      ] },
      { t: "cards", cols: 2, items: [
        { h: "재학습으론 안 오른다", lines: [<>word+char 피처 추가: 74.2 → <b>74.3%</b> (개선 없음)</>, <>짧은 구어 + 의미 겹침(대출↔이자/연체 130건 혼동) = 선형 ML 구조적 한계</>] },
        { h: "exaone 하이브리드 = 유일한 레버", lines: [<>긴급=규칙 · 쉬운 다수=규칙+ML · <b>불확실 26%만 exaone</b></>, <>버리지 말고 LLM에 넘김 → 오배정 없이 세부코드↑ (요약도 exaone라 지연 ≈0)</>] },
      ] },
      { t: "note", html: <><b style={css("color:#b06a12")}>정직하게:</b> 3분류 전체 정확도는 실데이터가 대부분 '일반'이라 <b>부풀려짐</b> → 구간별로 말할 것. 긴급·단순 평가셋 작음(5·30건), <b>실 STT 검증 미완</b>(다음 단계). 후보 온프레미스 모델 = OpenChat 3.6 8B + QLoRA 어댑터(41GB, 요약·분류·QA) — Railway MVP 확정 아님.</> },
    ],
    links: [
      { t: "모델 성적표 — 정직한 버전", id: "a5d0d52b-5bdb-4806-8c96-f8fef542bec0" },
      { t: "방언 대응 한계와 로드맵", id: "6ed94997-54af-458b-9a7e-b90665b5757b" },
    ],
  },
  {
    name: "감정·주의도", color: "#9B4FB0",
    blocks: [
      { t: "lede", html: <>감정온도는 <b>음향 + 텍스트 2채널</b>로 낸다. '주의도'와 '긴급'을 <b>두 레인</b>으로 분리해, 감정이 높다고 무조건 긴급으로 태우지 않는다.</> },
      { t: "cards", cols: 2, items: [
        { h: "감정온도 밴드", lines: [<span className="k-mono">0–33 stable · 33–66 caution · 66–100 elevated</span>, <>보조: arousal · valence · dominance · negative_activation</>] },
        { h: "2채널 융합", lines: [<>음향: eGeMAPS+LightGBM (원본 음성만)</>, <>텍스트: EXAONE 기반 텍스트 감정</>, <>call_id로 결합해 한 카드로</>] },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "주의도 vs 긴급", lines: [<>두 레인 분리 — 감정 고조 ≠ 사고 위험</>, <>사고 징후(안전 규칙)로 위험도 판정</>] },
        { h: "지켜야 할 경계", lines: [<><b>목소리 크다고 고위험/고조 분류 안 함</b></>, <>음향 입력만 감정 결과로 — 텍스트·해시 오염 금지</>, <>모델 미연동 시 가짜 점수 없이 <b>unavailable</b></>] },
      ] },
    ],
    links: [
      { t: "감정온도·주의도가 나오기까지 (2채널)", id: "b4b570ee-2cfe-4737-8062-2d2af73b0ad1" },
      { t: "주의도 vs 긴급 — 두 레인", id: "db58b5f1-2b3c-440e-971b-f4621d531938" },
      { t: "감정·긴급도 판정 파이프라인", id: "8acbd830-a2cc-4d28-974c-6373b1117bf3" },
      { t: "EXAONE 텍스트 감정 설명서", id: "49c94ee5-db95-47ee-9a8d-1002c44b8ada" },
    ],
  },
  {
    name: "본인인증", color: "#2079AE",
    blocks: [
      { t: "lede", html: <>MVP 인증은 <b>전화 키패드(DTMF) + 상담사 추가 확인</b>. 고위험 문의는 자동 처리하지 않고 <b>사람에게 인계</b>한다 (ADR-0009). 목소리 인증은 상담 전 <b>반복 신원확인</b>을 줄일 뿐, 송금·이체 승인 수단이 아니다.</> },
      { t: "cards", cols: 2, items: [
        { h: "DTMF 키 의미", lines: [<><b>0</b>은 종료 키가 아니다 — 일반 숫자</>, <>상담 전 <b>#</b> = 사전 접수 완료 · 연결 후 <b>#</b> = 일반 입력</>, <>SQLite sidecar 영속(generation 분리)</>] },
        { h: "마스킹", lines: [<>상담원 화면엔 <b>마스킹된 입력</b>만</>, <>raw DTMF는 민감정보 → 공개 조회 API 없음</>, <>수신 숫자를 본인확인 대조칸에 적용</>] },
      ] },
      { t: "rowh", s: "기술 구분 — 하나가 아니다" },
      { t: "cards", cols: 2, items: [
        { h: "네 가지 다른 기술", lines: [<><b>목소리 인증</b>: 화자 유사도(재인증)</>, <><b>ARS</b>: 전화 채널·입력값 검증</>, <><b>STT</b>: 무엇을 말했나 · <b>위조음성 탐지</b>: 실제 사람인가</>] },
        { h: "임베딩·주의", lines: [<>ECAPA-TDNN·x-vector → cosine/PLDA 유사도</>, <>전화망 <b>8kHz 협대역</b> — 16kHz 공개데이터 성능 ≠ 통화 성능</>, <>지표: FAR·FRR·EER·minDCF·Spoof EER</>] },
      ] },
      { t: "rowh", s: "국내 실사례 (참고)" },
      { t: "table", head: ["기관", "방식", "성과·구조"], rows: [
        ["IBK기업은행", "영업점 45초 등록 · 통화 15초 인증", "3분→2분49초, 12만명, IBK+금결원 분산"],
        ["KT 고객센터", "상담 중 자동 등록", "본인확인 19초 단축"],
        ["국민건강보험공단", "간편인증 후 40초 자유발화", "KT A'Cen"],
        ["삼성생명", "과거 정상통화 성문 비교", "실시간 사칭 위험 분석"],
      ] },
      { t: "note", html: <>간소화 O = 재인증·반복 질문·단순 조회 / 간소화 X = 신규 실명확인·송금·고액 이체·대출(OTP·보안매체 유지). 화자 일치도 높아도 <b>녹음·합성음 의심 시 승인 금지</b>.</> },
    ],
    links: [
      { t: "본인인증 설계안 — 간소화 vs 상세", id: "d996e964-61b5-49b2-9c07-cb03e6bc488e" },
      { t: "백엔드 본인인증 프로세스", id: "1f9d7941-568a-4866-a2eb-8499bc627ef1" },
      { t: "본인인증 — React 연동 명세", id: "f1c62a07-33fc-40c8-9361-ef5467c82b4c" },
      { t: "인수인계 — STAGE 0~4a", id: "fa04db36-404b-4e89-b883-d99e81a4a986" },
    ],
  },
  {
    name: "개인정보·보안", color: "#C0392B",
    blocks: [
      { t: "lede", html: <>완전 <b>폐쇄망</b>이 첫 방어선. 그 위에 게이트웨이 3층 방어와 데이터 3링 분류로, 고객의 '말'·'신원'·'비밀값'을 각각 다르게 다룬다.</> },
      { t: "rowh", s: "게이트웨이 3층 방어 (문에 비유)" },
      { t: "cards", cols: 3, items: [
        { h: "mTLS — 문의 잠금", lines: [<>양쪽 다 인증서 제시해야 연결. 주소를 알아도 인증서 없으면 대화 시작 안 됨</>] },
        { h: "allowlist — 안내데스크", lines: [<>기본 전부 거부. IP·API·필드 3겹. 등록 엔드포인트만(예: 3개), 나머지 403</>] },
        { h: "pydantic — 검사대", lines: [<><span className="k-mono">extra=forbid</span> · 마스킹 패턴만 통과, 전체 계좌번호 유입 시 자동 422</>] },
      ] },
      { t: "rowh", s: "데이터 3링 분류" },
      { t: "cards", cols: 3, items: [
        { h: "🔒 링 1 — 절대 안 나감", lines: [<>음성·녹취·<b>STT 전사문</b>·AI 산출물(상담카드 전체)·메모·이력 → 폐쇄망 GPU 안에서만</>] },
        { h: "🚪 링 2 — 마스킹본만", lines: [<>마스킹 이름(이*민)·발신 뒷4·고객유형·상품요약·이력메타·본인확인 대조값(원문 비표시)</>] },
        { h: "⛔ 링 3 — 어디에도 금지", lines: [<>전체 계좌·카드번호·OTP·비밀번호·DTMF·주민번호</>] },
      ] },
      { t: "quotes", items: [
        { q: <>"고객의 <b>'말'</b>은 폐쇄망 밖으로 한 발짝도 안 나가고, <b>'신원'</b>은 마스킹본만 좁은 문으로 들어오며, <b>'비밀값'</b>은 어디에도 저장되지 않습니다."</>, sub: "발표용 한 문장" },
      ] },
      { t: "note", html: <>DB 저장: full_name_masked·phone_masked·phone_lookup_hash(해시)·transcript_ciphertext(암호문) · <b>access_logs</b> 불변 감사(상담사·고객·세션·범위·목적·IP) · 키는 KMS/HSM. 지급정지·원장 조회 등 <b style={css("color:#b06a12")}>실제 은행 업무는 미수행</b>(데모 라벨). "망분리는 규제 요건이라 선택지가 아니다."</> },
    ],
    links: [
      { t: "개인정보·보안 데이터 흐름 브리핑", id: "de371c91-077b-42cf-82f3-7420c1ff59af" },
      { t: "개인정보·보안 브리핑", id: "74aa0a65-47d3-4e92-b832-a1b957fa0c10" },
      { t: "개인정보 보호 4원칙", id: "968a6571-dcd2-449d-9a99-691eb5b9eb61" },
    ],
  },
  {
    name: "상담 흐름·카드", color: "#4d5156",
    blocks: [
      { t: "lede", html: <>핵심 산출물은 <b>상담 준비 카드</b>. AI는 초안을 만들고 <b>최종 판단은 상담사</b>가 한다. 통화가 끝나면 후처리 교정이 학습 데이터로 쌓인다.</> },
      { t: "flow", items: [
        { a: "1", b: "사전 접수", c: "자연어 → STT" },
        { a: "2", b: "요약·라우팅", c: "EXAONE + 3층 분류" },
        { a: "3", b: "준비 카드", c: "근거 포함 한 장" },
        { a: "4", b: "통화", c: "실시간 가이드" },
        { a: "5", b: "후처리 학습", c: "교정 → 축적" },
      ] },
      { t: "cards", cols: 2, items: [
        { h: "준비 카드 필수 출력", lines: [<>전사문·음성 길이 · 문의 요약 · 고객 요청 · 추가 확인 필요 정보</>, <>업무유형·전달 부서·전달 근거 · 사고 징후(low/high)+근거</>, <>확인 체크리스트 · 단계별 스크립트 · RAG 출처(제목·구간·발췌·점수) · call_id</>] },
        { h: "후처리 5섹션 + 학습", lines: [<>고객 문의 · 상담원 안내 · 확인·처리 · 미완료 · 후속 조치</>, <>분류 교정 → <b>edge_cases 학습 데이터 축적</b> → 재분류 즉시 반영</>, <>원문에 없는 절차·처리완료는 grounding guard가 거절</>] },
      ] },
      { t: "rowh", s: "로드맵 — 쓸수록 똑똑해지는 콜센터" },
      { t: "flow", items: [
        { a: "지금", b: "통화 전 준비", c: "준비 카드" },
        { a: "다음", b: "통화 중 동행", c: "스트리밍 요약·방언" },
        { a: "이후", b: "선제 제안", c: "다음 질문 예측" },
        { a: "장기", b: "1차 응대 AI", c: "로컬 실시간 음성" },
      ] },
    ],
    links: [
      { t: "상담 브리핑 카드", id: "89bf2ecf-2c11-448a-a3e4-5e8e36a0b004" },
      { t: "준비 카드 v4", id: "8d36f866-d2f9-41dd-afd3-33209aeebf8e" },
      { t: "후처리 v2", id: "92d76b76-ff1c-4cd7-b9df-da995be4649b" },
      { t: "상담 업무 흐름 Before → After", id: "bb32f6ad-b083-4636-93ef-e47d89c7af34" },
    ],
  },
];

// ONAIR: 면은 한 색, 경계는 그림자(보더 없음). 색은 점·값·가는 선(1.5px)·글자에만.
const CARD = "background:var(--panel);border:none;border-radius:12px;box-shadow:var(--sh-near);padding:13px 16px";
const TILE = "background:var(--panel);border:none;border-radius:8px;box-shadow:var(--sh-near)";

function Block({ b, tc }: { b: Blk; tc: string }) {
  if (b.t === "lede") return <p style={css("font:400 13px/1.6 " + FONT + ";color:var(--gray-800);margin:0 0 14px;max-width:74ch")}>{b.html}</p>;
  if (b.t === "rowh") return (
    <div style={css("display:flex;align-items:center;gap:7px;margin:14px 0 8px")}>
      <span style={css("width:6px;height:6px;border-radius:2px;flex:none;background:" + tc)} />
      <span style={css("font:600 13px " + FONT + ";color:var(--gray-1000)")}>{b.s}</span>
    </div>
  );
  if (b.t === "metrics") return (
    <div style={css("display:grid;grid-template-columns:repeat(" + b.items.length + ",1fr);gap:10px;margin-bottom:2px")}>
      {b.items.map((m, i) => (
        <div key={i} className="hoverraise" style={css(CARD)}>
          <div style={css("font:800 24px " + MONO + ";letter-spacing:-.02em;color:" + tc)}>{m.v}</div>
          <div style={css("font:500 11px " + FONT + ";color:var(--gray-700);margin-top:3px;line-height:1.35")}>{m.l}</div>
        </div>
      ))}
    </div>
  );
  if (b.t === "cards") return (
    <div style={css("display:grid;grid-template-columns:repeat(" + (b.cols || 2) + ",1fr);gap:10px")}>
      {b.items.map((c, i) => (
        <div key={i} className="hoverraise" style={css(CARD)}>
          {c.h && <div style={css("font:600 13px " + FONT + ";color:var(--gray-1000);margin-bottom:8px;display:flex;align-items:center;gap:6px")}>{c.k ? <span style={css("font:800 10px " + MONO + ";color:" + tc)}>{c.k}</span> : <span style={css("width:6px;height:6px;border-radius:2px;flex:none;background:" + tc)} />}{c.h}</div>}
          <ul style={css("list-style:none;display:flex;flex-direction:column;gap:6px;margin:0;padding:0")}>
            {c.lines.map((l, j) => (
              <li key={j} style={css("font:400 12px/1.5 " + FONT + ";color:var(--gray-800);padding-left:12px;position:relative")}>
                <span style={css("position:absolute;left:0;top:7px;width:4px;height:4px;border-radius:9999px;background:var(--gray-500)")} />{l}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
  if (b.t === "quotes") return (
    <div style={css("display:grid;grid-template-columns:repeat(" + b.items.length + ",1fr);gap:10px")}>
      {b.items.map((q, i) => (
        <div key={i} style={css("background:var(--onair-bg);border-left:2px solid " + tc + ";border-radius:0 8px 8px 0;padding:11px 14px")}>
          <div style={css("font:400 12.5px/1.45 " + FONT + ";color:var(--gray-1000)")}>{q.q}</div>
          <div style={css("font:400 11px " + FONT + ";color:var(--gray-700);margin-top:5px")}>{q.sub}</div>
        </div>
      ))}
    </div>
  );
  if (b.t === "flow") return (
    <div style={css("display:flex;flex-wrap:wrap;align-items:stretch;gap:6px")}>
      {b.items.map((s, i) => (
        <div key={i} style={css("display:flex;align-items:center;gap:6px")}>
          {i > 0 && <span style={css("color:var(--gray-500);font-weight:700")}>→</span>}
          <div style={css(TILE + ";padding:8px 12px")}>
            <div style={css("font:800 9px " + MONO + ";color:" + tc + ";letter-spacing:.4px")}>{s.a}</div>
            <div style={css("font:600 12px " + FONT + ";color:var(--gray-1000);margin-top:2px")}>{s.b}</div>
            {s.c && <div style={css("font:400 11px " + FONT + ";color:var(--gray-700);margin-top:1px")}>{s.c}</div>}
          </div>
        </div>
      ))}
    </div>
  );
  if (b.t === "badges") return (
    <div style={css("display:flex;flex-wrap:wrap;gap:7px")}>
      {b.items.map((x, i) => (
        <span key={i} style={css("font:600 11.5px " + FONT + ";padding:5px 12px;border-radius:9999px;background:var(--onair-surface);border:1.5px solid " + tc + ";color:" + tc)}>{x}</span>
      ))}
    </div>
  );
  if (b.t === "table") return (
    <div style={css("overflow-x:auto;" + TILE)}>
      <table style={css("width:100%;border-collapse:collapse;font:400 12px " + FONT)}>
        <thead><tr>{b.head.map((h, i) => <th key={i} style={css("text-align:" + (i === 0 ? "left" : "right") + ";padding:9px 14px;font-weight:600;color:var(--gray-700);border-bottom:1px solid var(--gray-200);font-size:11px")}>{h}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={css("text-align:" + (ci === 0 ? "left" : "right") + ";padding:8px 14px;color:" + (ci === 0 ? "var(--gray-1000)" : "var(--gray-800)") + (ri < b.rows.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : "") + ";font-family:" + (ci === 0 ? FONT : MONO) + ";" + (ci === 0 ? "font-weight:600" : ""))}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  if (b.t === "note") return <div style={css("margin-top:6px;background:var(--onair-bg);border-radius:8px;padding:11px 14px;font:400 11.5px/1.55 " + FONT + ";color:var(--gray-700)")}>{b.html}</div>;
  return null;
}

export default function ArchiveModal({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(TOPICS.length - 1, v + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const topic = TOPICS[i];
  const tc = topic.color;

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.5);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:1060px;max-width:96vw;height:84vh;max-height:840px;display:grid;grid-template-columns:212px 1fr;background:var(--gray-100);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 좌측 주제 레일 */}
        <nav style={css("background:var(--panel);border-right:1px solid var(--gray-200);padding:16px 12px;display:flex;flex-direction:column;gap:2px;overflow-y:auto")}>
          <div style={css("display:flex;align-items:center;gap:9px;padding:2px 8px 12px")}>
            <BrandSymbol size={18} color="var(--blue-700)" />
            <span><span style={css("display:block;font:800 12.5px " + FONT + ";color:var(--gray-1000);line-height:1.1")}>자료실</span><span style={css("display:block;font:500 8px " + MONO + ";color:var(--gray-600);letter-spacing:.4px")}>종합 브리핑 · 8주제</span></span>
          </div>
          {TOPICS.map((t, k) => (
            <button key={t.name} onClick={() => setI(k)} className="k-navbtn"
              style={css("display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;cursor:pointer;padding:8px 10px;border-radius:9px;font:" + (k === i ? "750" : "650") + " 12.5px " + FONT + ";background:" + (k === i ? "var(--gray-100)" : "transparent") + ";color:" + (k === i ? "var(--gray-1000)" : "var(--gray-700)"))}>
              <span style={css("width:8px;height:8px;border-radius:3px;flex:none;background:" + t.color + ";opacity:" + (k === i ? "1" : ".5"))} />
              {t.name}
              <span style={css("margin-left:auto;font:600 9px " + MONO + ";color:var(--gray-500)")}>{String(k + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </nav>

        {/* 우측 콘텐츠 */}
        <main style={css("overflow-y:auto;padding:22px 26px 26px;position:relative")}>
          <span onClick={onClose} style={css("position:absolute;top:16px;right:18px;cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
          <div style={css("display:flex;align-items:center;gap:9px;margin-bottom:4px")}>
            <span style={css("width:11px;height:11px;border-radius:3px;background:" + tc)} />
            <h2 style={css("font:820 20px " + FONT + ";letter-spacing:-.4px;color:var(--gray-1000)")}>{topic.name}</h2>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:10px")}>
            {topic.blocks.map((b, bi) => <Block key={bi} b={b} tc={tc} />)}
          </div>
          {/* 관련 원문 */}
          <div style={css("margin-top:18px;padding-top:14px;border-top:1px solid var(--gray-200)")}>
            <div style={css("font:500 10px " + MONO + ";color:var(--gray-600);letter-spacing:.4px;margin-bottom:8px")}>관련 원문 · claude.ai</div>
            <div style={css("display:flex;flex-wrap:wrap;gap:7px")}>
              {topic.links.map((l) => (
                <a key={l.id} href={BASE + l.id} target="_blank" rel="noopener noreferrer" className="hoverraise"
                  style={css("display:inline-flex;align-items:center;gap:6px;text-decoration:none;font:600 11px " + FONT + ";color:var(--gray-900);" + TILE + ";padding:6px 12px")}>
                  <span style={css("width:6px;height:6px;border-radius:9999px;flex:none;background:" + tc)} />{l.t}
                  <span className="mi" style={css("font-size:12px;color:var(--gray-500)")}>open_in_new</span>
                </a>
              ))}
            </div>
            <div style={css("font:400 10px " + FONT + ";color:var(--gray-600);margin-top:9px")}>* 발표 원고류 일부는 claude.ai 아티팩트 전용이라 본문은 링크로만 제공됩니다.</div>
          </div>
        </main>
      </div>
    </>
  );
}
