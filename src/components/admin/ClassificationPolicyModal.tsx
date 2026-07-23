import { useEffect } from "react";
import { css } from "../../lib/css";
import {
  incidentRiskPolicy,
  routingDepartments,
} from "../../features/stt-classification/rules";
import { SGE_META, type Sge } from "../../services";

/** 1층 우선순위 게이트 — 판정 순서 그대로 위에서 아래로 E → S → G */
const LANES: Array<{
  k: Sge;
  title: string;
  dest: string;
  items: readonly string[];
  note: string | null;
}> = [
  {
    k: "E",
    title: "긴급 게이트",
    dest: "사고·신고 직결 · 대기열 최우선",
    items: incidentRiskPolicy.high,
    note: "단일 단어로는 판정하지 않습니다 — “기관 사칭 + 송금 요구”처럼 정황이 결합될 때만 긴급.",
  },
  {
    k: "S",
    title: "단순 판정",
    dest: "ARS·AI 즉시 응대 · 대기열 없음",
    items: ["정형 조회·신청·변경·재발송", "본인확인 후 자동 처리 가능한 업무"],
    note: null,
  },
  {
    k: "G",
    title: "일반 상담",
    dest: "부서 대기열 → 상담사 배정",
    items: incidentRiskPolicy.low,
    note: null,
  },
];

/** 층 사이 화살표 + 연결 설명 */
function LayerArrow({ text }: { text: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:10px;padding:9px 0 9px 16px")}>
      <span className="mi" style={css("font-size:20px;color:var(--gray-500)")}>arrow_downward</span>
      <span style={css("font:500 11px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{text}</span>
    </div>
  );
}

/** 층 카드 — 번호 배지 + 제목 + 부제, 안에 콘텐츠 */
function Layer({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={css("background:var(--gray-100);border-radius:12px;padding:14px 16px 16px")}>
      <div style={css("display:flex;align-items:baseline;gap:8px;margin-bottom:12px")}>
        <span style={css("flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:var(--gray-1000);color:#fff;font:800 11px 'Geist Mono',monospace;transform:translateY(2px)")}>{n}</span>
        <span style={css("font:800 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{n}층 · {title}</span>
        <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{sub}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * 분류 정책 · 라우팅 3층 구조 — 각주가 아니라 화면 골격.
 * 콜은 위→아래 3층을 순서대로 통과: 1층 우선순위 게이트(규칙 먼저, E→S→G) →
 * 2층 부서 7종(누가 받나=RAG 필터) → 3층 업무코드(무슨 일). 색은 신호에만(E/S/G·사고신고).
 */
export default function ClassificationPolicyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:760px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 14px;flex:none;border-bottom:1px solid var(--gray-200)")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>account_tree</span>
          <span style={css("font:800 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 정책 · 라우팅 3층 구조</span>
          <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 콜은 위에서 아래로 순서대로 통과합니다</span>
          <div style={css("flex:1")} />
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:16px 20px 20px")}>
          {/* ── 1층: 우선순위 게이트 (E/S/G 3레인) ── */}
          <Layer n={1} title="우선순위 게이트 · 어떻게 처리하나" sub="규칙 게이트 먼저 → 긴급(E) → 단순(S) → 일반(G)">
            <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px")}>
              {LANES.map((l) => {
                const meta = SGE_META[l.k];
                return (
                  <div key={l.k} style={css("background:var(--onair-surface);border-radius:10px;padding:11px 12px;border-top:2.5px solid " + meta.bar)}>
                    <div style={css("display:flex;align-items:center;gap:7px;margin-bottom:2px")}>
                      <span style={css("flex:none;width:22px;height:22px;border-radius:9999px;border:1.5px solid " + meta.bar + ";display:flex;align-items:center;justify-content:center;font:800 11px 'Geist Mono',monospace;color:" + meta.fg)}>{l.k}</span>
                      <span style={css("font:800 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{l.title}</span>
                      <span style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>{meta.label}</span>
                    </div>
                    <div style={css("font:500 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>{l.dest}</div>
                    <div style={css("display:flex;flex-direction:column;gap:4px")}>
                      {l.items.map((t) => (
                        <div key={t} style={css("display:flex;gap:6px;align-items:flex-start")}>
                          <span style={css("flex:none;width:3.5px;height:3.5px;border-radius:9999px;background:var(--gray-500);margin-top:6px")} />
                          <span style={css("font:400 11px/1.45 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                        </div>
                      ))}
                    </div>
                    {l.note && (
                      <div style={css("margin-top:8px;padding-top:7px;border-top:1px dashed var(--gray-300);font:400 10px/1.5 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>{l.note}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Layer>

          <LayerArrow text="긴급(E)은 사고·신고로 직결 · 단순(S)은 AI 즉시 처리(부서 무관) · 일반(G)만 아래 부서 대기열로" />

          {/* ── 2층: 부서 배정 ── */}
          <Layer n={2} title="부서 배정 · 누가 받나" sub="부서 코드 = RAG 규정검색 필터 (ETC는 문서분류 전용)">
            <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px")}>
              {routingDepartments.map((d) => {
                const incident = d.name === "사고·신고";
                return (
                  <div key={d.name} style={css("background:var(--onair-surface);border-radius:10px;padding:10px 12px" + (incident ? ";outline:1.5px solid var(--red-400)" : ""))}>
                    <div style={css("display:flex;align-items:center;gap:6px")}>
                      <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);white-space:nowrap")}>{d.name}</span>
                      {incident && (
                        <span style={css("font:800 9px 'Geist Sans','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:1.5px 6px;white-space:nowrap")}>E 직결</span>
                      )}
                    </div>
                    <div style={css("margin-top:4px;font:400 10px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
                      {d.tasks.join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </Layer>

          <LayerArrow text="부서가 정해지면 그 안에서" />

          {/* ── 3층: 업무코드 ── */}
          <Layer n={3} title="업무코드 · 무슨 일" sub="부서 안 세부 분류">
            <div style={css("display:flex;gap:8px;align-items:flex-start")}>
              <span className="mi" style={css("flex:none;font-size:15px;color:var(--blue-700);margin-top:1px")}>bookmark</span>
              <span style={css("font:400 11.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>
                부서 코드가 규정검색(RAG) 대분류와 같아서 <b style={css("color:var(--gray-1000)")}>부서 확정 = 규정검색 필터 확정</b>.
                긴급 게이트는 규칙 기반이라 LLM 판단보다 <b style={css("color:var(--gray-1000)")}>먼저</b> 겁니다.
              </span>
            </div>
          </Layer>
        </div>
      </div>
    </>
  );
}
