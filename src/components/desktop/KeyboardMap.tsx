import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import { KEYS, SHORTCUT_GUIDE } from "../../lib/shortcuts";

/**
 * 단축키 연습판 — 자판을 그려 두고 **실제 키보드를 눌러서** 익히게 한다.
 *
 * 왜 표가 아닌가
 * --------------
 * 표는 "M = 음소거"를 읽게 할 뿐, 손이 어디로 가는지는 안 알려 준다. 상담사는 통화 중
 * 화면을 보면서 손만 움직여야 하므로 **자판 위 위치**로 외우는 게 실제 사용에 가깝다.
 *
 * 왜 클릭이 아니라 '누르기'인가
 * -----------------------------
 * 마우스로 키캡을 클릭하면 그건 그냥 목록을 손으로 넘기는 것이다. 여기서는 **진짜 키를
 * 누르면** 화면의 키캡이 눌리고 그 자리에서 무슨 일을 하는지 뜬다 — 가이드가 아니라
 * 연습장이 된다. 손가락이 M을 찾아가는 경험 자체가 목적이다.
 * (마우스 클릭도 받는다 — 키보드를 못 쓰는 상황에서 둘러보는 길은 열어 둔다.)
 *
 * 배정 안 된 키를 눌러도 알려 준다 — "이 키는 비어 있다"를 알아야 잘못 외운 걸 고친다.
 *
 * ONAIR 문법: 키캡은 면 + 경계 + 낮은 그림자. 발광은 쓰지 않고 눌림은 **그림자를 줄이고
 * 1px 내려앉는 것**으로 표현한다(실물 키가 눌리는 방식). 색은 신호에만 — 배정된 키와
 * 지금 눌린 키만 색을 갖는다.
 */

/** 키 하나 — [표시 라벨, 폭 배수, 매칭할 event.key(없으면 라벨 소문자)] */
type Cap = [label: string, w?: number, match?: string];

const U = 34; // 1u 키 폭(px)
const GAP = 5;

/* Mac 배열을 따라 그린다. 안 쓰는 줄까지 그리는 이유: 자판은 **모양으로** 인식된다 —
   글자 줄만 떼어 놓으면 위치 감각이 생기지 않는다. */
const ROWS: Cap[][] = [
  [["esc", 1.6, "escape"], ["F1"], ["F2"], ["F3"], ["F4"], ["F5"], ["F6"], ["F7"], ["F8"], ["F9"], ["F10"], ["F11"], ["F12"]],
  [["`"], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["0"], ["-"], ["="], ["delete", 1.8, "backspace"]],
  [["tab", 1.6], ["Q"], ["W"], ["E"], ["R"], ["T"], ["Y"], ["U"], ["I"], ["O"], ["P"], ["["], ["]"], ["\\", 1.2]],
  [["caps", 1.9, "capslock"], ["A"], ["S"], ["D"], ["F"], ["G"], ["H"], ["J"], ["K"], ["L"], [";"], ["'"], ["return", 2.0, "enter"]],
  [["shift", 2.4], ["Z"], ["X"], ["C"], ["V"], ["B"], ["N"], ["M"], [","], ["."], ["/"], ["?"], ["shift", 1.8, "shift"]],
  [["fn"], ["control"], ["option", 1.3, "alt"], ["command", 1.5, "meta"], ["", 5.6, " "], ["command", 1.5, "meta"], ["option", 1.3, "alt"], ["↑↓", 1.4, "arrow"]],
];

/** 키 → [화면, 기능]. SHORTCUT_GUIDE 하나만 보고 만든다(정의는 늘 한 곳). */
const INDEX: Record<string, { screen: string; label: string }[]> = (() => {
  const out: Record<string, { screen: string; label: string }[]> = {};
  for (const g of SHORTCUT_GUIDE)
    for (const it of g.items) (out[it.k.toUpperCase()] ||= []).push({ screen: g.screen, label: it.label });
  return out;
})();

/** 이 키캡이 담당하는 단축키 이름(대문자 한 글자 또는 Esc/?) */
function capKey(c: Cap): string {
  const [label, , match] = c;
  if (match === "escape") return "ESC";
  if (label.length === 1) return label.toUpperCase();
  return "";
}

export default function KeyboardMap() {
  const [picked, setPicked] = useState<string>(KEYS.memo);
  /** 지금 물리적으로 눌려 있는 키 — 눌림 표현용(keyup에 풀린다) */
  const [down, setDown] = useState<string | null>(null);
  /** 배정 안 된 키를 눌렀을 때 잠깐 뜨는 안내 */
  const [miss, setMiss] = useState<string | null>(null);
  const missT = useRef<number | undefined>(undefined);

  useEffect(() => {
    const norm = (e: KeyboardEvent) => {
      if (e.key === "Escape") return "ESC";
      if (e.key.length === 1) return e.key.toUpperCase();
      return "";
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = norm(e);
      if (!k) return;
      e.preventDefault(); // 이 화면에서는 단축키가 실행되지 않게 — 여기는 연습판이다
      setDown(k);
      if (INDEX[k]) {
        setPicked(k);
        setMiss(null);
      } else {
        setMiss(k);
        window.clearTimeout(missT.current);
        missT.current = window.setTimeout(() => setMiss(null), 1600);
      }
    };
    const onUp = () => setDown(null);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.clearTimeout(missT.current);
    };
  }, []);

  const hits = INDEX[picked] ?? [];

  return (
    <div style={css("display:flex;flex-direction:column;gap:13px;align-items:flex-start")}>
      {/* 프리뷰 — 방금 누른 키가 무엇이었는지 자판 위에 뜬다.
          자판을 보느라 시선을 내리지 않아도 결과가 읽히는 자리다. */}
      <div style={css("height:34px;display:flex;align-items:center;gap:10px")}>
        {miss ? (
          <>
            <span style={css("display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border-radius:6px;background:var(--gray-200);color:var(--gray-700);font:700 12px 'Avenir Next','Pretendard',sans-serif")}>{miss}</span>
            <span style={css("font:500 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
              이 키에는 아직 기능이 없습니다
            </span>
          </>
        ) : (
          <>
            <span style={css("display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border-radius:6px;background:var(--blue-700);color:#fff;font:700 12px 'Avenir Next','Pretendard',sans-serif")}>{picked}</span>
            <span style={css("display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px")}>
              {hits.map((h, i) => (
                <span key={i} style={css("display:inline-flex;align-items:baseline;gap:6px")}>
                  <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>{h.screen}</span>
                  <span style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{h.label}</span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      {/* 자판 — 실물 비율. 알루미늄 바디 위에 키캡이 얹힌 모양 */}
      <div style={css("background:var(--onair-bg);border:1px solid var(--gray-300);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:" + GAP + "px;box-shadow:var(--sh-near)")}>
        {ROWS.map((row, ri) => (
          <div key={ri} style={css("display:flex;gap:" + GAP + "px")}>
            {row.map((c, ci) => {
              const [label, w = 1] = c;
              const k = capKey(c);
              const assigned = !!(k && INDEX[k]);
              const isDown = !!k && down === k;
              const isPicked = !!k && picked === k && !miss;
              const isMissed = !!k && miss === k;
              const fn = ri === 0; // 기능 줄은 낮게 — 실물이 그렇다
              return (
                <span
                  key={ci}
                  onClick={assigned ? () => { setPicked(k); setMiss(null); } : undefined}
                  title={assigned ? INDEX[k].map((h) => `${h.screen} · ${h.label}`).join("\n") : undefined}
                  style={css(
                    "flex:none;display:flex;align-items:center;justify-content:center;border-radius:5px;" +
                      "font:600 " + (label.length > 2 ? "8.5" : "11") + "px 'Avenir Next','Pretendard',sans-serif;" +
                      "transition:transform .05s,box-shadow .05s,background .15s,color .15s;" +
                      "width:" + Math.round(U * w + GAP * (w - 1)) + "px;height:" + (fn ? 20 : U) + "px;" +
                      // 눌림 = 1px 내려앉고 그림자가 사라진다(발광 없음 — 실물 키가 그렇다)
                      (isDown ? "transform:translateY(1px);box-shadow:none;" : "") +
                      (isPicked || isDown
                        ? "background:var(--blue-700);color:#fff;border:1px solid var(--blue-700)"
                        : isMissed
                        ? "background:var(--gray-300);color:var(--gray-800);border:1px solid var(--gray-400)"
                        : assigned
                        ? "background:var(--onair-surface);color:var(--gray-1000);border:1px solid var(--gray-400);cursor:pointer" +
                          (isDown ? "" : ";box-shadow:0 1px 0 var(--gray-300)")
                        : "background:var(--onair-surface);color:var(--gray-500);border:1px solid var(--gray-200);opacity:.72")
                  )}
                >
                  {label}
                </span>
              );
            })}
          </div>
        ))}
      </div>

      <div style={css("display:flex;align-items:center;gap:7px;font:400 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
        <span className="mi" style={css("font-size:15px;color:var(--gray-500)")}>keyboard</span>
        <b style={css("font-weight:700;color:var(--gray-900)")}>키보드를 직접 눌러 보세요</b> — 자판이 반응하고 무슨 일을 하는지 위에 뜹니다.
        진한 키가 기능이 있는 키입니다. 메모·검색 입력 중에는 단축키가 동작하지 않습니다.
      </div>
    </div>
  );
}
