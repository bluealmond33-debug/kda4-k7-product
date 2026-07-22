import { useEffect } from "react";
import { css } from "../../lib/css";
import {
  incidentRiskPolicy,
  routingDepartments,
} from "../../features/stt-classification/rules";
import { SGE_META, type Sge } from "../../services";

/** 판정 순서 그대로의 세로 스테퍼 데이터 — 위에서 아래로 E → S → G */
const STEPS: Array<{
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
    note: "단일 단어로는 판정하지 않습니다 — “기관 사칭 + 송금 요구”처럼 정황이 결합될 때 긴급.",
  },
  {
    k: "S",
    title: "단순 판정",
    dest: "ARS·AI 즉시 응대 — 대기열 없음",
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

/**
 * 분류 정책 · 업무 카탈로그 — 왼쪽은 판정 파이프라인(세로 스테퍼, E→S→G 순서 그대로),
 * 오른쪽은 8부서 카탈로그. 색은 점·글자·가는 선으로만(ONAIR).
 * 발표에서 "무슨 기준으로 나뉘는가"를 받는 질문에 이 화면 하나로 답한다.
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
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:880px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
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

        <div style={css("flex:1;overflow-y:auto;padding:4px 20px 18px")}>
          <div style={css("display:flex;gap:18px;align-items:flex-start")}>
            {/* ── 왼쪽: 판정 파이프라인 (세로 스테퍼) ── */}
            <div style={css("flex:none;width:340px;position:relative")}>
              <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.3px;color:var(--gray-700);padding:2px 0 10px")}>
                판정 파이프라인 — 위에서 순서대로
              </div>
              <div style={css("position:relative")}>
                {/* 스텝 원들을 잇는 세로 헤어라인 */}
                <div style={css("position:absolute;left:13px;top:14px;bottom:14px;width:1px;background:var(--gray-300)")} />
                {STEPS.map((s, i) => {
                  const meta = SGE_META[s.k];
                  return (
                    <div key={s.k} style={css("position:relative;display:flex;gap:12px;padding:0 0 " + (i < STEPS.length - 1 ? "16px" : "0"))}>
                      {/* 번호 원 — 색 테두리(가는 선) + 색 잉크, 축 위에 앉음 */}
                      <span style={css("flex:none;width:26px;height:26px;border-radius:9999px;border:1.5px solid " + meta.bar + ";background:var(--onair-surface);display:flex;align-items:center;justify-content:center;font:700 11.5px 'Geist Mono',monospace;color:" + meta.fg + ";z-index:1")}>
                        {s.k}
                      </span>
                      <div style={css("flex:1;min-width:0;padding-top:2px")}>
                        <div style={css("display:flex;align-items:baseline;gap:7px;flex-wrap:wrap")}>
                          <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                            {i + 1}. {s.title}
                          </span>
                          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>{meta.label}</span>
                        </div>
                        <div style={css("font:500 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>{s.dest}</div>
                        <div style={css("margin-top:7px;display:flex;flex-direction:column;gap:4px")}>
                          {s.items.map((t) => (
                            <div key={t} style={css("display:flex;gap:7px;align-items:flex-start")}>
                              <span style={css("flex:none;width:4px;height:4px;border-radius:9999px;background:var(--gray-600);margin-top:6px")} />
                              <span style={css("font:400 11.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                            </div>
                          ))}
                        </div>
                        {s.note && (
                          <div style={css("margin-top:7px;font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>{s.note}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 가는 세로 구분선 */}
            <div style={css("flex:none;width:1px;align-self:stretch;background:var(--gray-200);margin-top:26px")} />

            {/* ── 오른쪽: 부서 카탈로그 (2층 taxonomy) ── */}
            <div style={css("flex:1;min-width:0")}>
              <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.3px;color:var(--gray-700);padding:2px 0 10px")}>
                라우팅 부서 8종 — RAG 8대분류와 코드 공유
              </div>
              <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
                {routingDepartments.map((d) => {
                  const incident = d.name === "사고·신고";
                  return (
                    <div key={d.name} style={css("background:var(--background-200);border-radius:10px;padding:10px 12px" + (incident ? ";outline:1.5px solid var(--red-400)" : ""))}>
                      <div style={css("display:flex;align-items:center;gap:6px")}>
                        <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);white-space:nowrap")}>{d.name}</span>
                        {incident && (
                          <span style={css("font:700 9.5px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900);white-space:nowrap")}>긴급 직결</span>
                        )}
                      </div>
                      <div style={css("margin-top:4px;font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
                        {d.tasks.join(" · ")}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 3층 구조 각주 */}
              <div style={css("margin-top:12px;display:flex;gap:8px;align-items:flex-start;border-top:1px solid var(--gray-200);padding-top:10px")}>
                <span className="mi" style={css("flex:none;font-size:15px;color:var(--blue-700);margin-top:1px")}>info</span>
                <span style={css("font:400 11px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>
                  라우팅은 3층입니다 — <b>1층 S/G/E</b>(우선순위) → <b>2층 부서 8종</b>(누가 받나) → <b>3층 업무코드</b>(무슨 일).
                  부서 코드가 규정검색(RAG) 분류와 같아서 <b>부서 확정 = 규정검색 필터 확정</b>. 긴급 게이트는 규칙 기반이라 LLM 판단보다 먼저 겁니다.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
