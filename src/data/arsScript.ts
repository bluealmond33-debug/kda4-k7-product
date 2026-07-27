/**
 * AI 사전 접수 안내 스크립트 (No ARS) — 고객 폰에서 **AI가 말하는 내용**.
 *
 * 왜 별도 파일인가: 화면(말풍선)과 음성이 같은 원본을 쓰게 하려고 텍스트를 한곳에 모았다.
 *
 * **녹음을 넣는 방법: `public/demo/ars/<id>.mp3` 로 파일만 떨어뜨리면 끝이다.**
 * 아래 각 줄의 `id`가 곧 파일명이고(greet-1 → ars/greet-1.mp3), 재생이 끝나는 시점이 다음
 * 말풍선을 띄운다 — 그래서 녹음 길이에 맞춰 `sec`을 고칠 필요가 없다. 파일이 없으면 그 줄은
 * `sec`만큼 머물다 넘어가므로, 녹음이 일부만 준비돼도 섞여서 잘 돌아간다.
 * 문구를 바꾸려면 이 파일의 text만 고친다(코드는 건드릴 필요 없다).
 *
 * 문구 원칙 — 이 제품의 핵심 주장을 고객이 첫 12초에 이해해야 한다:
 *  · "버튼을 누르지 않아도 된다"(No ARS)를 가장 먼저 말한다 — ARS 트리를 없앤 게 제품이다.
 *  · 말한 내용이 **상담사에게 먼저 전달된다**고 알린다 — 같은 말을 두 번 하지 않게 된다는 약속.
 *  · 통화를 끊어도 접수가 남는다(콜백)고 알린다 — 대기 이탈의 손실을 없애는 것이 목표다.
 *  · 개인정보를 먼저 요구하지 않는다. 본인확인은 상담사 연결 뒤 화면에서 진행한다.
 *
 * 흐름은 useCallFlow의 phase를 그대로 탄다(별도 타이머를 새로 만들지 않는다):
 *   connecting  → 첫 안내(약 13초)
 *   recording   → 고객이 말하는 중 (AI는 말하지 않고 듣는다)
 *   confirm     → 침묵이 이어짐: 더 있는지 확인 + # 안내
 *   prep        → 카드 요약·전달 완료: 연결 안내 + 콜백 약속
 * 침묵 몇 초에 다음 단계로 갈지는 useCallFlow의 silenceSec1·silenceSec2가 정한다.
 */

export type ArsLine = {
  /** 재생 순서 추적용 키 — 한 통화에서 같은 줄을 두 번 말하지 않게 한다 */
  id: string;
  text: string;
  /**
   * 녹음이 **없을 때만** 쓰는 대략 길이(초) — 다음 말풍선까지의 간격.
   * 녹음이 있으면 재생이 끝나는 시점이 진행을 이끌므로 이 값은 쓰이지 않는다.
   * 그래서 mp3를 넣을 때 sec을 고쳐 맞출 필요가 없다.
   */
  sec: number;
  /** 파일명을 규칙(`ars/<id>.mp3`)과 다르게 두고 싶을 때만 적는다 */
  audio?: string;
};

/** 통화 연결 직후 — 실제 녹음(greet-1.wav, 14.6초) 한 줄로 재생.
 *  이전엔 세 줄(greet-1/2/3)로 나뉘어 있었는데, 새 녹음이 그 내용을 이미 한 테이크로
 *  이어 말하므로(인사→AI 안내→말씀 요청→전달 안내→# 안내) 하나로 합쳤다. */
export const ARS_GREETING: ArsLine[] = [
  {
    id: "greet-1",
    text: "안녕하세요, 키움은행입니다. AI 상담 도우미가 안내해 드립니다. 정확한 안내를 위해 문의하실 내용을 편하게 말씀해 주세요. 상담사에게 전달할 내용을 정리해 드립니다. 말씀을 다 마치면 우물정자 버튼을 눌러 주세요.",
    sec: 15,
    audio: "ars/greet-1.wav",
  },
];

/** 말이 끊긴 뒤(confirm) — 더 있는지 한 번 확인하고, 끝났으면 #을 안내한다 */
export const ARS_CONFIRM: ArsLine[] = [
  {
    id: "confirm-1",
    text: "더 말씀하실 내용이 있으신가요?",
    sec: 2.5,
  },
  {
    id: "confirm-2",
    text: "말씀이 끝나셨다면 우물정자를 눌러주세요.",
    sec: 4,
    audio: "ars/confirm-2.wav",
  },
];

/** 요약·전달 완료(prep) — 일반 상담. 실제 녹음 3줄(들었음→정리중→전달완료)로 진행 상황을 순서대로 알린다. */
export const ARS_HANDOFF: ArsLine[] = [
  {
    id: "handoff-1",
    text: "고객님께서 말씀하신 내용 잘 들었습니다, 잠시만 기다려 주세요.",
    sec: 5,
    audio: "ars/handoff-1.wav",
  },
  {
    id: "handoff-2",
    text: "말씀하신 내용을 정리하고 있습니다, 잠시만 기다려 주세요.",
    sec: 4,
    audio: "ars/handoff-2.wav",
  },
  {
    id: "handoff-3",
    text: "상담사에게 내용을 전달했습니다. 곧 연결해드리겠습니다.",
    sec: 4,
    audio: "ars/handoff-3.wav",
  },
];

/** 요약·전달 완료(prep) — 긴급(E) 분류 전용. 대기 설명 없이 전담 상담사 직결만 짧게 알린다.
 *  어느 걸 쓸지는 arsDialogue.ts가 vm.prepSge === "E"로 고른다. */
export const ARS_HANDOFF_EMERGENCY: ArsLine[] = [
  {
    id: "handoff-emergency",
    text: "전담 상담사에게 바로 연결해 드리겠습니다.",
    sec: 3,
    audio: "ars/handoff-emergency.wav",
  },
];

/** 본인인증(생년월일 8자리) — auth_policy=REQUIRED일 때만 prep 진입 시 재생한다.
 *  phase 큐(ARS_BY_PHASE)가 아니라 DTMF 자리수 이벤트로 진행되는 별도 흐름이라 여기
 *  넣지 않는다 — useCallFlow.ts가 auth_start/auth_progress/auth_complete/auth_incomplete
 *  이벤트에 맞춰 아래 줄을 직접 재생한다. */
export const ARS_AUTH_REQUEST: ArsLine = {
  id: "auth-request",
  text: "본인 확인을 위해 생년월일 8자리를 키패드로 눌러주세요. 예를 들어 1985년 3월 7일이면 19850307입니다.",
  sec: 10,
  audio: "ars/auth-request.wav",
};

/** 8자리 다 안 채우고 종료 신호(#/*)를 눌렀을 때 리마인드 */
export const ARS_AUTH_ALL8: ArsLine = {
  id: "auth-all8",
  text: "8자리를 모두 눌러주세요. 연도 4자리, 월 2자리, 일 2자리 순서입니다.",
  sec: 6,
  audio: "ars/auth-all8.wav",
};

/** 8자리 다 입력됨 — 대조할 실제 고객원장이 없어 데모는 여기서 바로 완료 처리한다. */
export const ARS_AUTH_DONE: ArsLine = {
  id: "auth-done",
  text: "본인 확인이 완료되었습니다. 상담사에게 연결해 드리겠습니다.",
  sec: 4,
  audio: "ars/auth-done.wav",
};

/** 인증 포기(길게 무응답 등) — 막지 않고 바로 상담사로 넘긴다. */
export const ARS_AUTH_HARD: ArsLine = {
  id: "auth-hard",
  text: "본인 확인이 어려우신 것 같습니다. 상담사가 바로 도와드리겠습니다, 잠시만 기다려 주세요.",
  sec: 6,
  audio: "ars/auth-hard.wav",
};

/** 8자리가 유효한 생년월일 형식이 아닐 때(13월·32일 등) — 재입력 요청 */
export const ARS_AUTH_MISMATCH: ArsLine = {
  id: "auth-mismatch",
  text: "입력하신 정보가 등록된 정보와 일치하지 않습니다. 다시 한번 눌러주세요.",
  sec: 6,
  audio: "ars/auth-mismatch.wav",
};

/** mismatch 뒤 재입력 안내 — auth-request보다 짧게, 예시 없이 바로 다시 누르게 한다 */
export const ARS_AUTH_BIRTHDATE_RETRY: ArsLine = {
  id: "auth-birthdate",
  text: "생년월일 8자리를 키패드로 눌러주세요. 태어난 연도 4자리부터 눌러주시면 됩니다.",
  sec: 6,
  audio: "ars/auth-birthdate.wav",
};

/** phase → 그 단계에서 AI가 말할 줄. 여기 없는 phase에서는 AI가 말하지 않는다(듣기만 한다).
 *  prep은 긴급 여부에 따라 갈리므로 arsDialogue.ts에서 별도 처리 — 이 맵의 prep은 일반 케이스 기본값. */
export const ARS_BY_PHASE: Record<string, ArsLine[]> = {
  connecting: ARS_GREETING,
  confirm: ARS_CONFIRM,
  prep: ARS_HANDOFF,
};
