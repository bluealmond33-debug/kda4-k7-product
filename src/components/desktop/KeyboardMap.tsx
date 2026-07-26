import { useState } from "react";
import { css } from "../../lib/css";
import { KEYS, SHORTCUT_GUIDE } from "../../lib/shortcuts";

/**
 * 단축키 지도 — **진짜 키보드를 그려서** 어디를 누르는지 손가락 위치로 익히게 한다.
 *
 * 왜 표가 아닌가: 표는 "M = 음소거"를 읽게 할 뿐, 손이 어디로 가는지는 안 알려 준다.
 * 상담사는 통화 중 화면을 보면서 손만 움직여야 하므로, **자판 위 위치**로 외우는 게
 * 실제 사용에 가깝다. 배열 위에서 보면 M·N이 오른손 아래, S·B가 왼손 근처처럼
 * 덩어리로 잡힌다.
 *
 * ONAIR 문법: 키캡은 면(surface) + 경계 + 낮은 그림자로 세우고, 색은 신호에만 쓴다 —
 * 배정된 키만 잉크로 또렷하고 나머지는 물러난다. 고른 키 하나만 파랗게 찬다.
 */

/** 실제 자판 배열(US QWERTY) — 손 위치를 익히는 게 목적이라 배열을 그대로 그린다 */
const ROWS: string[][] = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

/** 키 → [화면, 기능] 역인덱스. SHORTCUT_GUIDE 하나만 보고 만든다(정의는 늘 한 곳). */
function buildIndex(): Record<string, { screen: string; label: string }[]> {
  const out: Record<string, { screen: string; label: string }[]> = {};
  for (const g of SHORTCUT_GUIDE) {
    for (const it of g.items) {
      const k = it.k.toUpperCase();
      (out[k] ||= []).push({ screen: g.screen, label: it.label });
    }
  }
  return out;
}

const INDEX = buildIndex();

function Cap({
  k,
  active,
  picked,
  onPick,
}: {
  k: string;
  active: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <span
      onClick={active ? onPick : undefined}
      title={active ? INDEX[k].map((h) => `${h.screen} · ${h.label}`).join("\n") : undefined}
      style={css(
        "width:42px;height:42px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;" +
          "font:700 14px 'Avenir Next','Pretendard',sans-serif;transition:background .15s,color .15s,box-shadow .15s;" +
          (picked
            ? "background:var(--blue-700);color:#fff;box-shadow:var(--sh-near);cursor:pointer"
            : active
            ? // 배정된 키 — 면이 서고 잉크가 또렷하다. 누를 수 있는 것처럼 보여야 한다.
              "background:var(--onair-surface);color:var(--gray-1000);border:1px solid var(--gray-400);box-shadow:var(--sh-near);cursor:pointer"
            : // 안 쓰는 키 — 배열의 맥락으로만 남기고 물러난다
              "background:transparent;color:var(--gray-500);border:1px solid var(--gray-200)")
      )}
    >
      {k}
    </span>
  );
}

export default function KeyboardMap() {
  // 처음에는 가장 자주 쓰는 키를 골라 둔다 — 빈 설명 자리를 보여 주지 않는다
  const [picked, setPicked] = useState<string>(KEYS.memo);
  const hits = INDEX[picked] ?? [];

  return (
    <div style={css("display:flex;flex-direction:column;gap:14px;width:560px;max-width:100%")}>
      {/* 자판 — 실제 배열 그대로. 행마다 조금씩 들여써 진짜 키보드처럼 보이게 한다 */}
      <div
        style={css(
          "background:var(--onair-bg);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:7px;align-items:center"
        )}
      >
        {ROWS.map((row, ri) => (
          <div key={ri} style={css("display:flex;gap:7px;margin-left:" + ri * 18 + "px")}>
            {row.map((k) => (
              <Cap
                key={k}
                k={k}
                active={!!INDEX[k]}
                picked={picked === k}
                onPick={() => setPicked(k)}
              />
            ))}
          </div>
        ))}
        {/* 스페이스바 — 없으면 키보드로 안 보인다. 배정은 없으므로 물러난 채로 둔다 */}
        <div style={css("display:flex;gap:7px;margin-top:1px")}>
          <span style={css("width:300px;height:34px;border-radius:7px;border:1px solid var(--gray-200)")} />
        </div>
      </div>

      {/* 고른 키의 설명 — 자판 아래 한 자리에 고정. 키를 옮겨 다녀도 눈이 안 흔들린다 */}
      <div style={css("min-height:74px;border:1px solid var(--gray-300);border-radius:10px;padding:12px 14px;display:flex;gap:13px;align-items:flex-start")}>
        <span
          style={css(
            "flex:none;width:38px;height:38px;border-radius:7px;background:var(--blue-700);color:#fff;display:flex;align-items:center;justify-content:center;font:700 15px 'Avenir Next','Pretendard',sans-serif"
          )}
        >
          {picked}
        </span>
        <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:5px")}>
          {hits.map((h, i) => (
            <div key={i} style={css("display:flex;align-items:baseline;gap:8px")}>
              <span style={css("flex:none;font:600 10px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-600);width:52px")}>
                {h.screen}
              </span>
              <span style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{h.label}</span>
            </div>
          ))}
          {/* 같은 키가 화면마다 다른 일을 하는 경우 — 헷갈릴 수 있으니 그 사실을 적는다 */}
          {hits.length > 1 && (
            <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-top:1px")}>
              화면에 따라 하는 일이 다릅니다 — 지금 보이는 버튼의 배지를 따르세요
            </span>
          )}
        </div>
      </div>

      <div style={css("display:flex;align-items:center;gap:7px;font:400 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
        <span className="mi" style={css("font-size:15px;color:var(--gray-500)")}>info</span>
        메모·검색을 입력하는 중에는 단축키가 동작하지 않습니다. 어느 화면에서든{" "}
        <span style={css("font-weight:700;color:var(--gray-900)")}>?</span> 를 누르면 목록이 뜹니다.
      </div>
    </div>
  );
}
