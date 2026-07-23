import type { CallFlowVM } from "../hooks/useCallFlow";

/**
 * 데모 투어링 '대본' — 시연·발표용 안내 레이어의 콘텐츠.
 *
 * 화면(ScreenKey)마다 영역 스텝 목록이 있고, 각 스텝은 앱에 심어둔 [data-tour=...] 앵커를
 * 스팟라이트(그 영역만 밝게)로 비추며 말풍선으로 설명한다.
 * 화면의 마지막 스텝은 act(행동 스텝) — '다음' 대신 실제 버튼을 직접 누르게 해서
 * 데모 진행 자체가 투어가 되게 한다.
 *
 * 실제 제품에서 투어를 뺄 때는 src/tour 폴더와 <DemoTour/> 마운트만 지우면 된다. (README.md)
 */

export type ScreenKey = "idle" | "intake" | "prep" | "active" | "wrap";

/** 데모 진행 단계(useCallFlow.stepIndex 0~4)와 1:1 */
export const SCREEN_ORDER: ScreenKey[] = ["idle", "intake", "prep", "active", "wrap"];

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  idle: "대기",
  intake: "접수",
  prep: "준비",
  active: "통화",
  wrap: "후처리",
};

export interface TourStep {
  /** 스팟라이트로 비출 [data-tour=...] 앵커 이름 */
  target: string;
  title: string;
  body: string;
  /** 말풍선이 앵커의 어느 쪽에 뜨는지 */
  placement: "top" | "bottom" | "left" | "right";
  /** 행동 스텝 — '다음' 버튼 대신 실제 버튼을 직접 누르게 한다 */
  act?: boolean;
  /** 화면 전환 없이 끝나는 행동의 완료 판정 — 참이 되면 다음 스텝으로 */
  done?: (vm: CallFlowVM) => boolean;
  /** 스팟라이트 여유 패딩(px) — 기본 8 */
  pad?: number;
}

export const TOUR: Record<ScreenKey, TourStep[]> = {
  idle: [
    {
      target: "topbar",
      placement: "bottom",
      title: "데모 리모컨",
      body: "진행 단계(대기→후처리)와 다음 콜 유형(일반·긴급·이관)을 고르는 시연용 제어 바입니다. ★ 표시된 '준비'가 이 데모의 핵심 화면이에요.",
    },
    {
      target: "desk",
      placement: "left",
      title: "직원 대기 화면",
      body: "대기 중 능동적으로 볼 정보는 시각뿐 — 시계가 주인공입니다. 상태(수신 가능·대기열·다음 콜백)는 우상단 한 곳에만 모았습니다.",
    },
    {
      target: "phone-call",
      placement: "right",
      act: true,
      title: "전화 걸기",
      body: "고객 역할이 되어 초록 통화 버튼을 눌러보세요 — 곧바로 자연어 접수가 시작됩니다.",
    },
  ],
  intake: [
    {
      target: "phone",
      placement: "right",
      title: "자연어 접수",
      body: "고객이 대기 중 말한 용건을 AI가 실시간으로 접수·요약합니다. 상담사는 통화를 받기 전부터 '무슨 일인지' 압니다.",
    },
    {
      target: "intake-live",
      placement: "top",
      title: "접수 신호",
      body: "이때 상담사에게 필요한 신호는 감정온도·접수 경과뿐 — 나머지는 요약이 끝나면 준비 카드로 옵니다.",
    },
    {
      target: "skip",
      placement: "bottom",
      act: true,
      title: "기다림 건너뛰기",
      body: "'5초 건너뛰고 요약'을 눌러 바로 준비 카드로 가보세요.",
    },
  ],
  prep: [
    {
      target: "prep-card",
      placement: "left",
      pad: 4,
      title: "★ 준비 카드 — 이 데모의 핵심",
      body: "가장 큰 글씨(AI 사전 녹음 요약)가 '무슨 일', 오른쪽 감정온도·사고징후가 '어떻게 응대할지'입니다. 통화가 연결되기 전에 준비가 끝납니다.",
    },
    {
      target: "prep-checks",
      placement: "top",
      title: "유의사항 확인",
      body: "이번 콜 유형에 맞춘 응대 유의사항입니다 — 체크 조작 없이 한눈에 훑도록 설계했습니다.",
    },
    {
      target: "prep-firstline",
      placement: "top",
      title: "첫 응대 문장",
      body: "준비의 결론 — 통화를 여는 오프닝 멘트를 여기서 잠깐 확인해보세요.",
    },
    {
      target: "prep-connect",
      placement: "top",
      act: true,
      title: "통화 열기",
      body: "활성화된 '통화 연결'을 눌러 상담을 시작해보세요.",
    },
  ],
  active: [
    {
      target: "call-left",
      placement: "right",
      title: "고객 · 본인확인",
      body: "인증 전에는 고객 상세 조회가 잠깁니다 — 인증이 열람의 열쇠입니다.",
    },
    {
      target: "call-center",
      placement: "left",
      title: "AI 요약 · 스크립트 · 메모",
      body: "가운데가 작업의 중심 — 단계별 스크립트를 따라가며 메모를 남깁니다. 빛·깜빡임 대신 그림자 깊이만으로 초점을 줘 8시간 응시해도 눈이 덜 피로합니다.",
    },
    {
      target: "call-right",
      placement: "left",
      title: "규정 · 매뉴얼",
      body: "이 상담에 필요한 규정만 AI가 추려 옵니다. 검색·열람도 여기서 바로 합니다.",
    },
    {
      target: "call-end",
      placement: "left",
      act: true,
      title: "통화 종료",
      body: "빨간 버튼을 누르고 '종료'까지 확인하면 후처리가 자동으로 이어집니다.",
    },
  ],
  wrap: [
    {
      target: "wrap-sheet",
      placement: "top",
      pad: 4,
      title: "후처리 시트",
      body: "종료와 동시에 자동으로 올라옵니다. 상담 정보와 초안은 녹취·메모로 미리 채워져 있고, 상담사는 필요한 것만 고칩니다 — 상담사의 유일한 산출물은 초안 검증입니다.",
    },
    {
      target: "wrap-save",
      placement: "top",
      act: true,
      title: "저장 후 다음 콜",
      body: "저장하면 처음(대기)으로 돌아가며 투어가 끝납니다. 이후엔 자유롭게 — 긴급·이관 콜 유형도 체험해보세요.",
    },
  ],
};

/** 전체 스텝 수·화면별 시작 오프셋 — 말풍선의 'n/전체' 표기용 */
export const TOUR_OFFSETS: Record<ScreenKey, number> = (() => {
  const out = {} as Record<ScreenKey, number>;
  let acc = 0;
  for (const k of SCREEN_ORDER) {
    out[k] = acc;
    acc += TOUR[k].length;
  }
  return out;
})();
export const TOUR_TOTAL = SCREEN_ORDER.reduce((n, k) => n + TOUR[k].length, 0);
