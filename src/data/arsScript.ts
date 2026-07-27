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
 *   connecting  → 첫 안내(greet-1 하나, 인사·AI소개·용건요청·# 안내를 한 번에 전달, ~14.5초)
 *   recording   → 고객이 말하는 중 (AI는 말하지 않고 듣는다)
 *   confirm     → 침묵이 이어짐 (greet-1에서 # 안내를 이미 했으므로 AI는 말하지 않는다)
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

/**
 * 통화 연결 직후 — greet-1 하나로 고정(~14.5초). 인사·AI소개·용건요청·# 안내를 한 줄에
 * 다 담아서 말하므로 별도의 greet-2/greet-3·confirm 안내가 필요 없다.
 */
export const ARS_GREETING: ArsLine[] = [
  {
    id: "greet-1",
    text: "안녕하세요, 키움은행입니다. 에이아이 상담 도우미가 안내해 드립니다. 정확한 안내를 위해 문의하실 내용을 편하게 말씀해 주세요. 상담사에게 전달할 내용을 정리해 드립니다. 말씀을 다 마치면 우물 정자를 눌러주세요.",
    sec: 14.5,
    audio: "ars/greet-1.wav",
  },
];

/** 요약·전달 완료(prep) — 연결 안내 + "끊어도 콜백 온다"는 약속. 대기 이탈을 손실로 만들지 않는다 */
export const ARS_HANDOFF: ArsLine[] = [
  {
    id: "handoff-1",
    text: "말씀하신 내용을 상담 카드로 정리해 담당 부서에 전달했습니다.",
    sec: 4,
  },
  {
    id: "handoff-2",
    text: "잠시 기다리시면 상담사를 연결해 드립니다. 지금 통화를 종료하셔도 접수는 그대로 남아, 담당 상담사가 확인 후 콜백드립니다.",
    sec: 8,
  },
];

/**
 * 본인확인(IVR 단계) — ARS_RECORDING_SCRIPT.txt 기반. 아직 어느 phase에도 연결되지 않은
 * 대기 상태다. useCallFlow에 auth phase/DTMF 대조 로직이 붙기 전까지는 재생되지 않는다.
 */
export const ARS_AUTH: ArsLine[] = [
  {
    id: "auth-prompt",
    text: "본인 확인을 위해, 생년월일 여덟 자리를 키패드로 눌러 주세요. 예를 들어 1985년 3월 7일이면, 일 구 팔 오 공 삼 공 칠 입니다.",
    sec: 10,
    audio: "ars/auth-prompt.wav",
  },
  {
    id: "auth-reminder",
    text: "생년월일 여덟 자리를 키패드로 눌러 주세요. 태어난 연도 네 자리부터 눌러 주시면 됩니다.",
    sec: 6,
    audio: "ars/auth-reminder.wav",
  },
  {
    id: "auth-length",
    text: "여덟 자리를 모두 눌러 주세요. 연도 네 자리, 월 두 자리, 일 두 자리 순서입니다.",
    sec: 6,
    audio: "ars/auth-length.wav",
  },
  {
    id: "auth-mismatch",
    text: "입력하신 정보가 등록된 정보와 일치하지 않습니다. 다시 한 번 눌러 주세요.",
    sec: 5.5,
    audio: "ars/auth-mismatch.wav",
  },
  {
    id: "auth-success",
    text: "본인 확인이 완료되었습니다. 상담사에게 연결해 드리겠습니다.",
    sec: 4.5,
    audio: "ars/auth-success.wav",
  },
  {
    id: "auth-handoff",
    text: "본인 확인이 어려우신 것 같습니다. 상담사가 바로 도와드리겠습니다. 잠시만 기다려 주세요.",
    sec: 6.5,
    audio: "ars/auth-handoff.wav",
  },
];

/**
 * 청취 종료 후 처리 흐름 — ARS_RECORDING_SCRIPT.txt 08~10번. 아직 어느 phase에도 연결되지
 * 않은 대기 상태다(기존 ARS_HANDOFF와 통합 여부는 나중에 한 번에 정리한다).
 */
export const ARS_WRAP: ArsLine[] = [
  {
    id: "listening-done",
    text: "고객님께서 말씀하신 내용 잘 들었습니다. 잠시만 기다려 주세요.",
    sec: 4.5,
    audio: "ars/listening-done.wav",
  },
  {
    id: "processing",
    text: "말씀하신 내용을 정리하고 있습니다. 잠시만 기다려 주세요.",
    sec: 4,
    audio: "ars/processing.wav",
  },
  {
    // 주의: 이 id("connecting")는 useCallFlow의 phase 이름("connecting")과 같은 문자열이다.
    // 서로 다른 네임스페이스(줄 id vs phase 키)라 지금은 충돌 없지만, phase 배선 때 헷갈리기 쉽다.
    id: "connecting",
    text: "상담사에게 내용을 전달했습니다. 곧 연결해 드리겠습니다.",
    sec: 4,
    audio: "ars/connecting.wav",
  },
];

/**
 * 업무유형별 분기 안내 — ARS_RECORDING_SCRIPT.txt 11~13번. 아직 어느 phase에도 연결되지
 * 않은 대기 상태다. 업무 분류(G001 등) 결과에 따라 재생될 줄을 고르는 로직이 나중에 필요하다.
 */
export const ARS_TASK_BRANCH: ArsLine[] = [
  {
    id: "task-confirm-g001",
    text: "잘못 보내신 송금 건으로 확인했습니다. 담당 상담사에게 바로 연결해 드리겠습니다. 신속한 처리를 위해, 본인 확인을 먼저 진행하겠습니다.",
    sec: 10,
    audio: "ars/task-confirm-g001.wav",
  },
  {
    id: "emergency-handoff",
    text: "안전과 관련된 내용으로 확인했습니다. 전담 상담사에게 바로 연결해 드리겠습니다.",
    sec: 6,
    audio: "ars/emergency-handoff.wav",
  },
  {
    id: "system-error",
    text: "지금은 안내가 어렵습니다. 상담사에게 연결해 드리겠습니다.",
    sec: 4.5,
    audio: "ars/system-error.wav",
  },
];

/**
 * phase → 그 단계에서 AI가 말할 줄. 여기 없는 phase에서는 AI가 말하지 않는다(듣기만 한다).
 * confirm이 없는 건 의도된 것 — greet-1에서 이미 "# 눌러주세요"를 안내했으므로 침묵이
 * 이어져도(confirm phase) AI가 또 말할 필요가 없다.
 */
export const ARS_BY_PHASE: Record<string, ArsLine[]> = {
  connecting: ARS_GREETING,
  prep: ARS_HANDOFF,
};
