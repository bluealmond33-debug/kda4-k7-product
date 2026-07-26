import { useEffect } from "react";
import { css } from "./css";

/**
 * 키보드 단축키 — 한 곳에서 정의하고, 버튼 옆에 그대로 보여준다.
 *
 * 왜 중앙에 두나
 * --------------
 * 단축키는 이미 여기저기 흩어져 있었다(M 음소거 · H 보류 · R 규정 · N 메모). 그런데
 * **화면 어디에도 안 적혀 있어서** 아는 사람만 쓰는 기능이었고, 새 키를 추가할 때
 * 무엇이 이미 쓰이는지 알 방법이 없어 충돌이 나기 쉬웠다.
 *
 * 여기 한 곳에 모으면 두 가지가 해결된다:
 *  · 버튼 옆 배지(KeyHint)가 같은 출처를 읽으므로 **표시와 동작이 어긋날 수 없다**
 *  · 중복 정의는 개발 중 콘솔에서 바로 잡힌다
 *
 * 왜 한 글자인가
 * --------------
 * 상담사는 통화 중에 한 손으로 누른다. 조합키(Ctrl+Shift+…)는 두 손이 필요해 통화
 * 중에는 사실상 못 쓴다. 그래서 **표시되는 단축키는 전부 한 글자**로 통일한다.
 * 예외는 진단 패널 하나뿐이다 — 시연 중 오타로 열리면 안 되므로 일부러 조합키를 쓰고,
 * 그래서 화면에도 배지를 달지 않는다(§DIAG).
 *
 * 입력 중에는 동작하지 않는다
 * --------------------------
 * input·textarea·contentEditable에 포커스가 있으면 단축키를 무시한다. 메모를 쓰다
 * "N"을 치면 글자가 들어가야지 다른 기능이 실행되면 안 된다.
 */

/** 한 화면 안에서 유일해야 하는 키 — 정의만 모아 두고 실제 배선은 각 화면이 한다 */
export const KEYS = {
  // 통화 화면
  mute: "M",
  hold: "H",
  reg: "R",
  memo: "N",
  transfer: "T",
  endCall: "E",
  verify: "V",
  detail: "D",
  // 준비 카드
  connect: "C",
  // 후처리
  saveNext: "S",
  saveBreak: "B",
  // 공통
  help: "?",
} as const;

export type KeyName = keyof typeof KEYS;

/** 편집 중인가 — 입력 요소에 포커스가 있으면 단축키를 삼키지 않는다 */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable === true;
}

/**
 * 한 글자 단축키 배선. 화면이 사라지면 자동으로 해제된다.
 *
 * @param map  { "M": () => {...}, "T": () => {...} } — 대소문자 무관
 * @param active false면 아무것도 듣지 않는다(모달 뒤 화면이 단축키를 먹지 않게)
 */
export function useShortcuts(map: Record<string, (() => void) | undefined>, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // 조합키는 여기 관할이 아니다
      if (isTypingTarget(e.target)) return;
      const fn = map[e.key.toUpperCase()] ?? map[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

/**
 * 버튼 옆 단축키 배지.
 *
 * 버튼 **오른쪽 가운데 높이**에 붙는다 — 라벨 길이가 달라도 배지 위치가 흔들리지 않아
 * 화면을 훑을 때 키만 따라 읽을 수 있다.
 * `tone="on"`은 색이 채워진 버튼(파란 통화 연결 등) 위에 얹을 때 쓴다.
 */
export function KeyHint({
  k,
  tone = "off",
  style = "",
}: {
  k: string;
  /** off: 흰/회색 버튼 위 · on: 색이 채워진 버튼 위 */
  tone?: "off" | "on";
  style?: string;
}) {
  /* 면을 채우지 않는다 — 테두리와 글자만. 배지는 버튼 위에 얹히는 '표시'라
     자기 면을 가지면 버튼 안에 작은 버튼이 하나 더 있는 것처럼 보인다.
     특히 색이 채워진 버튼 위에서는 반투명 면이 얼룩처럼 떠 보였다. */
  const skin =
    tone === "on"
      ? "background:transparent;color:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.42)"
      : "background:transparent;color:var(--gray-600);border:1px solid var(--gray-400)";
  return (
    <span
      aria-hidden="true"
      style={css(
        "flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;" +
          "padding:0 4px;border-radius:4px;font:700 9.5px 'Avenir Next','Pretendard',sans-serif;" +
          "letter-spacing:.3px;line-height:1;" +
          skin +
          (style ? ";" + style : "")
      )}
    >
      {k}
    </span>
  );
}

/** 화면별 단축키 목록 — 도움말이 읽는 단일 출처. 배선과 같은 KEYS를 쓴다. */
export const SHORTCUT_GUIDE: { screen: string; items: { k: string; label: string }[] }[] = [
  {
    screen: "준비 카드",
    items: [
      { k: KEYS.connect, label: "통화 연결" },
      { k: KEYS.transfer, label: "다른 부서로 이관" },
    ],
  },
  {
    screen: "통화 중",
    items: [
      { k: KEYS.mute, label: "음소거" },
      { k: KEYS.hold, label: "보류" },
      { k: KEYS.memo, label: "메모 입력으로 이동" },
      { k: KEYS.reg, label: "관련 규정 검색으로 이동" },
      { k: KEYS.verify, label: "본인확인 대조" },
      { k: KEYS.detail, label: "고객 상세 조회 펼치기" },
      { k: KEYS.transfer, label: "이관 부서 선택" },
      { k: KEYS.endCall, label: "통화 종료" },
    ],
  },
  {
    screen: "후처리",
    items: [
      { k: KEYS.saveNext, label: "저장 후 다음 콜" },
      { k: KEYS.saveBreak, label: "저장 후 휴식" },
    ],
  },
  {
    screen: "공통",
    items: [
      { k: "↑↓", label: "관련 규정 표에서 조항 이동" },
      { k: "⏎", label: "고른 조항 펼치기 · 접기" },
      { k: "Esc", label: "닫기 · 입력 빠져나오기" },
      { k: KEYS.help, label: "이 도움말" },
    ],
  },
];

/**
 * 단축키 도움말 — `?`로 열고 `?`·`Esc`로 닫는다.
 *
 * 버튼 옆 배지는 "지금 보이는 것"만 알려 준다. 화면을 넘나드는 전체 지도는 여기가 맡는다 —
 * 상담사가 처음 앉았을 때 "무엇을 키보드로 할 수 있나"를 한 번에 보는 자리다.
 */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={css("position:fixed;inset:0;z-index:70;background:rgba(22,20,17,.5);display:flex;align-items:center;justify-content:center;animation:fadeIn .16s ease-out")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css("width:520px;max-width:92%;max-height:82vh;overflow:auto;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);padding:20px 24px 22px")}
      >
        <div style={css("display:flex;align-items:baseline;gap:9px;margin-bottom:14px")}>
          <span style={css("font:700 17px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>키보드 단축키</span>
          <span style={css("font:400 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
            입력 중에는 동작하지 않습니다
          </span>
          <div style={css("flex:1")} />
          <span onClick={onClose} className="mi" style={css("font-size:19px;color:var(--gray-500);cursor:pointer")}>close</span>
        </div>
        {SHORTCUT_GUIDE.map((g) => (
          <div key={g.screen} style={css("margin-bottom:14px")}>
            <div style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-600);margin-bottom:6px")}>
              {g.screen}
            </div>
            {g.items.map((it) => (
              <div key={it.k + it.label} style={css("display:flex;align-items:center;gap:10px;padding:4px 0")}>
                <KeyHint k={it.k} />
                <span style={css("font:400 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{it.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
