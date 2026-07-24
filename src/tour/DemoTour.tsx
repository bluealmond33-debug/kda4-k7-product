import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";
import { TOUR, TOUR_OFFSETS, TOUR_TOTAL, SCREEN_LABELS, type ScreenKey } from "./steps";

/**
 * 데모 투어링 — 시연·발표용 안내 레이어. 앱 코드와 분리된 오버레이 모듈이다.
 *
 * - 스팟라이트: 현재 스텝의 [data-tour=...] 영역만 밝게, 나머지는 dim.
 * - 말풍선: 그 영역을 꼬리로 가리키며 설명. '다음'은 말풍선 안(시선·조작이 한 곳).
 * - 행동 스텝(act): '다음' 대신 실제 버튼을 직접 누르게 한다 — 체험이 곧 투어.
 *   버튼을 눌러 데모가 다음 화면으로 넘어가면 그 화면의 스텝이 이어서 시작된다.
 * - Esc 또는 '투어 종료'로 언제든 이탈. 후처리에서 '저장 후 다음 콜'로 한 바퀴를 돌면 완료.
 *
 * 오버레이는 position:fixed를 쓰므로 transform(scale)된 스테이지 '바깥'에 마운트해야 한다.
 * 실제 제품에서 뺄 때: <DemoTour/>·<TourChooser/> 마운트와 src/tour 폴더만 지우면 끝. (README.md)
 */

const FONT = "'Avenir Next','Geist Sans','Pretendard',sans-serif";
const BUBBLE_W = 340;
const GAP = 14; // 스팟라이트 ↔ 말풍선 간격

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 시작 선택 — 투어 가이드를 따라갈지, 자유롭게 체험할지 사용자가 고른다 */
export function TourChooser({ onPick }: { onPick: (tour: boolean) => void }) {
  return (
    <div style={css("position:fixed;inset:0;z-index:700;display:flex;align-items:center;justify-content:center;background:rgba(6,6,7,.62)")}>
      <div style={css("width:440px;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);padding:24px 24px 20px;animation:coachIn .3s var(--ease-out);font-family:" + FONT)}>
        <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:14px")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>tips_and_updates</span>
          <span style={css("font:700 13px " + FONT + ";color:var(--gray-1000)")}>데모 안내</span>
        </div>
        <div style={css("font:700 19px/1.35 " + FONT + ";letter-spacing:-.2px;color:var(--gray-1000);margin-bottom:16px")}>
          어떻게 둘러볼까요?
        </div>
        <div
          onClick={() => onPick(true)}
          style={css("display:flex;align-items:center;gap:12px;background:var(--blue-700);color:#fff;border-radius:12px;padding:14px 16px;cursor:pointer;margin-bottom:8px")}
        >
          <span className="mi" style={css("font-size:22px")}>tour</span>
          <span style={css("flex:1")}>
            <span style={css("display:block;font:700 14px " + FONT)}>투어 가이드 따라가기 — 추천</span>
            <span style={css("font:400 11.5px " + FONT + ";opacity:.85")}>영역별 설명을 따라 접수→후처리 한 바퀴를 체험합니다</span>
          </span>
          <span className="mi" style={css("font-size:18px")}>arrow_forward</span>
        </div>
        <div
          onClick={() => onPick(false)}
          style={css("display:flex;align-items:center;gap:12px;background:var(--gray-100);color:var(--gray-1000);border-radius:12px;padding:14px 16px;cursor:pointer")}
        >
          <span className="mi" style={css("font-size:22px;color:var(--gray-700)")}>explore</span>
          <span style={css("flex:1")}>
            <span style={css("display:block;font:700 14px " + FONT)}>자유롭게 체험하기</span>
            <span style={css("font:400 11.5px " + FONT + ";color:var(--gray-600)")}>안내 없이 직접 눌러보며 둘러봅니다</span>
          </span>
        </div>
        <div style={css("font:400 11px/1.5 " + FONT + ";color:var(--gray-500);margin-top:14px")}>
          투어는 Esc로 언제든 종료할 수 있고, 상단 단계(대기~후처리)를 누르면 지금 화면 투어를 다시 켤 수 있어요.
        </div>
      </div>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function DemoTour({
  vm,
  screen,
  onExit,
}: {
  vm: CallFlowVM;
  screen: ScreenKey;
  onExit: () => void;
}) {
  const steps = TOUR[screen];
  const [idx, setIdx] = useState(0);
  const i = Math.min(idx, steps.length - 1);
  const step = steps[i];

  // 화면이 바뀌면 그 화면의 첫 스텝부터
  useEffect(() => setIdx(0), [screen]);

  // 한 바퀴 완료 감지 — 후처리에서 '저장 후 다음 콜'로 대기에 돌아오면 투어 종료
  const prevScreen = useRef(screen);
  useEffect(() => {
    if (prevScreen.current === "wrap" && screen === "idle") onExit();
    prevScreen.current = screen;
  }, [screen, onExit]);

  // 화면 전환 없는 행동 스텝(예: 유의사항 4회 확인)의 완료 판정 → 자동으로 다음 스텝
  useEffect(() => {
    if (step?.done && step.done(vm) && i < steps.length - 1) setIdx(i + 1);
  });

  // Esc = 투어 종료
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // 앵커 위치 추적 — 등장 애니메이션·리사이즈를 따라가도록 주기 폴링(150ms)
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    setRect(null);
    const read = () => {
      const el = document.querySelector('[data-tour="' + step.target + '"]');
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((p) =>
        p &&
        Math.abs(p.x - r.x) < 0.5 &&
        Math.abs(p.y - r.y) < 0.5 &&
        Math.abs(p.w - r.width) < 0.5 &&
        Math.abs(p.h - r.height) < 0.5
          ? p
          : { x: r.x, y: r.y, w: r.width, h: r.height }
      );
    };
    read();
    const t = window.setInterval(read, 150);
    window.addEventListener("resize", read);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", read);
    };
  }, [step.target]);

  // 말풍선 높이 실측 — 플립·클램프 계산의 기준. setState가 useLayoutEffect 안이라
  // 페인트 전에 위치가 보정되어 잘못된 자리가 화면에 번쩍이지 않는다.
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [bh, setBh] = useState(0);
  useLayoutEffect(() => {
    const h = bubbleRef.current?.offsetHeight ?? 0;
    if (h && Math.abs(h - bh) > 0.5) setBh(h);
  });

  // 행동 스텝에서 사용자가 스팟라이트 안(실제 버튼)을 누르는 순간 투어는 잠시 물러난다 —
  // 종료 확인 팝오버 같은 후속 UI가 말풍선·딤에 가려지지 않게. 다음 스텝/화면에서 다시 나타난다.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => setEngaged(false), [screen, i]);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const st = stepRef.current;
      if (!st?.act) return;
      // ① 클릭 대상이 앵커(또는 그 자식)면 즉시 — 좌표 없는 프로그램틱 클릭도 잡는다
      const t = e.target as Element | null;
      if (t?.closest?.('[data-tour="' + st.target + '"]')) {
        setEngaged(true);
        return;
      }
      // ② 좌표 기반 — 스팟라이트 영역 안 클릭(앵커 밖 여백 포함)
      const r = rectRef.current;
      if (!r || (e.clientX === 0 && e.clientY === 0)) return;
      const p = st.pad ?? 8;
      if (
        e.clientX >= r.x - p &&
        e.clientX <= r.x + r.w + p &&
        e.clientY >= r.y - p &&
        e.clientY <= r.y + r.h + p
      )
        setEngaged(true);
    };
    // mousedown(실사용: 누르는 즉시) + click 캡처(프로그램틱 클릭 포함) 둘 다 — 중복 호출은 무해
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("click", onDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("click", onDown, true);
    };
  }, []);

  if (!rect) return null; // 앵커가 아직 없으면(화면 전환 중) 다음 폴링까지 대기
  if (engaged) return null; // 행동 중 — 투어는 물러나서 화면을 가리지 않는다

  const pad = step.pad ?? 8;
  const sx = rect.x - pad;
  const sy = rect.y - pad;
  const sw = rect.w + pad * 2;
  const sh = rect.h + pad * 2;
  const cx = sx + sw / 2;
  const cy = sy + sh / 2;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 말풍선 배치 — 실측 높이(bh) 기반. ① 그쪽에 공간이 없으면 반대편으로 플립,
  // ② 그래도 넘치면 뷰포트 안으로 클램프 — 말풍선은 어떤 창 크기에서도 항상 화면 안에 있다.
  const W = BUBBLE_W;
  const MARGIN = 10; // 뷰포트 가장자리 최소 여백
  let placement = step.placement;
  if (bh > 0) {
    const fitsLeft = sx - GAP - W >= MARGIN;
    const fitsRight = sx + sw + GAP + W <= vw - MARGIN;
    const fitsTop = sy - GAP - bh >= MARGIN;
    const fitsBottom = sy + sh + GAP + bh <= vh - MARGIN;
    if (placement === "left" && !fitsLeft && fitsRight) placement = "right";
    else if (placement === "right" && !fitsRight && fitsLeft) placement = "left";
    else if (placement === "top" && !fitsTop && fitsBottom) placement = "bottom";
    else if (placement === "bottom" && !fitsBottom && fitsTop) placement = "top";
  }
  let bx: number;
  let by: number;
  if (placement === "left") {
    bx = sx - GAP - W;
    by = cy - bh / 2;
  } else if (placement === "right") {
    bx = sx + sw + GAP;
    by = cy - bh / 2;
  } else if (placement === "top") {
    bx = cx - W / 2;
    by = sy - GAP - bh;
  } else {
    bx = cx - W / 2;
    by = sy + sh + GAP;
  }
  bx = clamp(bx, MARGIN, vw - W - MARGIN);
  by = clamp(by, MARGIN, vh - bh - MARGIN);

  // 꼬리 — 항상 같은 크기(밑변 16 × 깊이 8)의 진짜 삼각형(clip-path).
  // 클램프로 말풍선이 밀려도 스팟라이트 중심을 가리키도록 위치를 재계산 (모서리 반경은 피한다)
  const TB = 16; // 밑변
  const TD = 8; // 깊이(뾰족한 정도)
  const tail: CSSProperties = { position: "absolute", background: "var(--onair-surface)" };
  if (placement === "left" || placement === "right") {
    const tailY = clamp(cy - by, 22, Math.max(22, bh - 22));
    Object.assign(
      tail,
      { width: TD, height: TB, top: tailY - TB / 2 },
      placement === "left"
        ? { right: -TD, clipPath: "polygon(0 0, 0 100%, 100% 50%)" } // 오른쪽(타깃)으로 뾰족
        : { left: -TD, clipPath: "polygon(100% 0, 100% 100%, 0 50%)" } // 왼쪽(타깃)으로 뾰족
    );
  } else {
    const tailX = clamp(cx - bx, 22, W - 22);
    Object.assign(
      tail,
      { width: TB, height: TD, left: tailX - TB / 2 },
      placement === "top"
        ? { bottom: -TD, clipPath: "polygon(0 0, 100% 0, 50% 100%)" } // 아래(타깃)로 뾰족
        : { top: -TD, clipPath: "polygon(0 100%, 100% 100%, 50% 0)" } // 위(타깃)로 뾰족
    );
  }

  const wrap: CSSProperties = {
    position: "fixed",
    zIndex: 601,
    width: W,
    left: bx,
    top: by,
    // 첫 프레임은 높이 실측 전 — 측정될 때까지 숨겨 잘못된 위치가 번쩍이지 않게
    visibility: bh > 0 ? "visible" : "hidden",
  };

  const globalNo = TOUR_OFFSETS[screen] + i + 1;

  return (
    <>
      {/* 스팟라이트 — 대상 영역만 밝게, 나머지는 거대 box-shadow로 dim.
          pointer-events 없음: 행동 스텝에서 실제 버튼을 그대로 누를 수 있다 */}
      <div
        style={{
          position: "fixed",
          left: sx,
          top: sy,
          width: sw,
          height: sh,
          borderRadius: 14,
          boxShadow: "0 0 0 2px rgba(255,255,255,.9), 0 0 0 200vmax rgba(10,10,12,.55)",
          transition: "left .35s cubic-bezier(.2,.8,.2,1), top .35s cubic-bezier(.2,.8,.2,1), width .35s cubic-bezier(.2,.8,.2,1), height .35s cubic-bezier(.2,.8,.2,1)",
          pointerEvents: "none",
          zIndex: 600,
        }}
      />

      {/* 말풍선 — 영역을 꼬리로 가리키며 설명. '다음'은 이 안에 */}
      <div style={wrap}>
        <div ref={bubbleRef} key={screen + i} style={css("position:relative;background:var(--onair-surface);border-radius:14px;box-shadow:var(--sh-modal);padding:15px 17px 13px;animation:coachIn .3s var(--ease-out);font-family:" + FONT)}>
          {/* 꼬리 — 스팟라이트를 가리키는 삼각형. 크기 고정, 위치는 위에서 계산 */}
          <span style={tail} />

          <div style={css("display:flex;align-items:center;gap:7px;margin-bottom:7px")}>
            <span style={css("font:700 14px " + FONT + ";color:var(--gray-1000)")}>{step.title}</span>
            <div style={css("flex:1")} />
            <span style={css("font:600 10.5px " + FONT + ";color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px;flex:none")}>
              {SCREEN_LABELS[screen]} 화면
            </span>
          </div>
          <div style={css("font:400 12.5px/1.6 " + FONT + ";color:var(--gray-900)")}>{step.body}</div>

          <div style={css("display:flex;align-items:center;gap:9px;margin-top:12px")}>
            <span onClick={onExit} style={css("font:600 11.5px " + FONT + ";color:var(--gray-500);cursor:pointer")} title="Esc로도 종료됩니다">
              투어 종료
            </span>
            <div style={css("flex:1;text-align:center;font:600 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-500)")}>
              {globalNo} / {TOUR_TOTAL}
            </div>
            {step.act ? (
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:700 12px " + FONT + ";color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:7px 12px")}>
                <span className="mi" style={css("font-size:15px;color:var(--amber-700)")}>touch_app</span>직접 눌러보세요
              </span>
            ) : (
              <span
                onClick={() => setIdx(i + 1)}
                style={css("display:inline-flex;align-items:center;gap:3px;font:600 12px " + FONT + ";background:var(--blue-700);color:#fff;border-radius:9999px;padding:7px 11px 7px 14px;cursor:pointer")}
              >
                다음 <span className="mi" style={css("font-size:15px")}>arrow_forward</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
