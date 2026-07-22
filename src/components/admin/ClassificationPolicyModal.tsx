import { useEffect } from "react";
import { css } from "../../lib/css";
import {
  incidentRiskPolicy,
  routingDepartments,
} from "../../features/stt-classification/rules";
import { SGE_META } from "../../services";

/** 분류 정책 · 업무 카탈로그 모달 — 판정 순서(E→S→G), 위험 정책, 부서×담당 업무.
 *  발표에서 "무슨 기준으로 나뉘는가"를 받는 질문에 이 화면 하나로 답한다. */
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
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:760px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 13px;flex:none")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>rule</span>
          <span style={css("font:700 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 정책 · 업무 카탈로그</span>
          <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 긴급 → 단순 → 일반 순서로 판정합니다</span>
          <div style={css("flex:1")} />
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div style={css("flex:1;overflow-y:auto;padding:2px 20px 20px;display:flex;flex-direction:column;gap:14px")}>
          {/* 판정 순서 */}
          <div style={css("display:flex;align-items:center;gap:8px;background:var(--background-200);border-radius:12px;padding:13px 16px")}>
            {(["E", "S", "G"] as const).map((k, i) => (
              <span key={k} style={css("display:flex;align-items:center;gap:8px;flex:1")}>
                {i > 0 && <span className="mi" style={css("flex:none;font-size:16px;color:var(--gray-600)")}>arrow_forward</span>}
                <span style={css("flex:1;display:flex;flex-direction:column;gap:3px;border-radius:10px;padding:9px 12px;background:" + SGE_META[k].bg)}>
                  <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:" + SGE_META[k].fg)}>
                    {i + 1}. {k} · {SGE_META[k].label}
                  </span>
                  <span style={css("font:400 11px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{SGE_META[k].desc}</span>
                </span>
              </span>
            ))}
          </div>

          {/* 위험 판정 정책 */}
          <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:10px")}>
            <div style={css("border-radius:12px;background:var(--red-100);padding:13px 16px")}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                <span className="mi" style={css("font-size:15px;color:var(--red-900)")}>warning</span>
                <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>사고징후 높음(high) → 긴급 E</span>
              </div>
              {incidentRiskPolicy.high.map((t) => (
                <div key={t} style={css("display:flex;gap:7px;align-items:flex-start;padding:2.5px 0")}>
                  <span style={css("flex:none;width:5px;height:5px;border-radius:9999px;background:var(--red-700);margin-top:6px")} />
                  <span style={css("font:400 11.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{t}</span>
                </div>
              ))}
              <div style={css("margin-top:8px;font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>
                단일 단어만으로 긴급 판정하지 않습니다 — “기관 사칭 + 송금 요구”처럼 정황이 결합될 때 긴급.
              </div>
            </div>
            <div style={css("border-radius:12px;background:var(--green-100);padding:13px 16px")}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:8px")}>
                <span className="mi" style={css("font-size:15px;color:var(--green-900)")}>verified</span>
                <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>사고징후 낮음(low) → 단순 S / 일반 G</span>
              </div>
              {incidentRiskPolicy.low.map((t) => (
                <div key={t} style={css("display:flex;gap:7px;align-items:flex-start;padding:2.5px 0")}>
                  <span style={css("flex:none;width:5px;height:5px;border-radius:9999px;background:var(--green-700);margin-top:6px")} />
                  <span style={css("font:400 11.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{t}</span>
                </div>
              ))}
              <div style={css("margin-top:8px;font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>
                정형 조회·신청·변경은 ARS(AI)로 — 단순(S). 그 외 상담사 판단이 필요하면 일반(G).
              </div>
            </div>
          </div>

          {/* 부서 × 담당 업무 카탈로그 */}
          <div>
            <div style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:8px")}>라우팅 부서 × 담당 업무 (8개 부서 · RAG 8대분류와 공유)</div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {routingDepartments.map((d) => (
                <div key={d.name} style={css("display:flex;align-items:center;gap:10px;background:var(--background-200);border-radius:10px;padding:9px 13px")}>
                  <span style={css("flex:none;width:132px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{d.name}</span>
                  <span style={css("display:flex;flex-wrap:wrap;gap:5px")}>
                    {d.tasks.map((t) => (
                      <span key={t} style={css("font:500 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px")}>{t}</span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 3개 축 주의 */}
          <div style={css("display:flex;gap:9px;align-items:flex-start;background:var(--gray-100);border-radius:10px;padding:11px 13px")}>
            <span className="mi" style={css("flex:none;font-size:16px;color:var(--blue-700);margin-top:1px")}>info</span>
            <span style={css("font:400 11.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
              라우팅은 3층입니다 — <b>1층 S/G/E</b>(대기열 우선순위) → <b>2층 부서 8종</b>(누가 받나) → <b>3층 업무코드</b>(무슨 일).
              부서 코드는 규정검색(RAG) 8대분류와 공유되어, <b>부서가 확정되면 규정검색 필터도 함께 확정</b>됩니다.
              긴급(E)은 사고·신고(SG) 부서와 직결 — 긴급 게이트(규칙)가 LLM 판단보다 먼저 겁니다.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
