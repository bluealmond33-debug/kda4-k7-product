import { useEffect } from "react";
import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";
import { MiniPipeline } from "./RoutingFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

const EMOTION_LABEL: Record<string, string> = { stable: "안정", caution: "주의", elevated: "고조" };
const EMOTION_FG: Record<string, string> = {
  stable: "var(--green-900)",
  caution: "var(--amber-900)",
  elevated: "var(--red-900)",
};

/**
 * 상담카드 상세 — 피드 타임라인 행 클릭 시.
 * 직원 화면 준비 카드(PrepCard)와 같은 문법: 캔버스(1440×900) "안"의 딤+모달이라
 * 스테이지와 함께 축소돼 카드 크기가 직원 화면과 동일하게 읽힌다.
 * 구조도 준비 카드 그대로 — 배지 → AI 요약 헤드라인 → 신호 밴드 → 배정 → 진행.
 */
export default function CallCardModal({
  record,
  onClose,
}: {
  record: AdminCallRecord;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sge = record.sge;
  const meta = sge ? SGE_META[sge] : null;
  const card = record.card;
  const ended = record.endedAt !== null;
  const stateLabel = ended
    ? sge === "S"
      ? "AI 자동 응대 완료"
      : "상담 완료"
    : sge === null
    ? "분류 중"
    : sge === "S"
    ? "AI 응대 중"
    : "대기열 대기 중";
  const emotion = card?.emotionLevel ?? null;

  return (
    <>
      {/* dim — PrepCard와 동일: 광원이 모달에 있으므로 뒤는 웜 블랙으로 가라앉는다 */}
      <div onClick={onClose} style={css("position:absolute;inset:0;z-index:80;background:rgba(22,20,17,.5);animation:fadeIn .18s ease-out;cursor:pointer")} />

      {/* 모달 — 준비 카드와 같은 캔버스 좌표계·같은 타입 래더 */}
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:81;width:680px;max-height:820px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
        {/* 헤더 — 배지(긴급/AI)와 AI 요약 헤드라인 (PrepCard 헤더 문법) */}
        <div style={css("padding:22px 28px 18px;border-bottom:1px solid var(--gray-200)")}>
          <div style={css("display:flex;align-items:flex-start;gap:10px")}>
            <div style={css("flex:1;min-width:0")}>
              {sge === "E" ? (
                <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
                  <span className="mi" style={css("font-size:13px")}>priority_high</span>
                  긴급 · 사고 징후 감지
                </span>
              ) : sge === "S" ? (
                <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
                  <span className="mi" style={css("font-size:13px")}>smart_toy</span>
                  단순 업무 · AI 자동 응대
                </span>
              ) : null}
              <div style={css("display:flex;gap:13px")}>
                <span style={css("width:4px;border-radius:2px;background:var(--blue-500);flex:none")} />
                <div style={css("min-width:0")}>
                  <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                    <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>graphic_eq</span>AI 상담카드 요약
                    {meta && (
                      <span style={css("display:inline-flex;align-items:center;gap:5px;margin-left:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>
                        <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + meta.bar)} />
                        {sge} · {meta.label}
                      </span>
                    )}
                  </div>
                  <div style={css("font:600 23px/1.35 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
                    {card ? card.summary : "분류 진행 중입니다…"}
                  </div>
                  {card && (
                    <div style={css("font:400 12.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:7px")}>
                      업무유형 · <span style={css("color:var(--gray-800)")}>{card.businessType}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <span onClick={onClose} style={css("flex:none;cursor:pointer;display:flex;width:32px;height:32px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
              <span className="mi" style={css("font-size:19px;color:var(--gray-600)")}>close</span>
            </span>
          </div>
        </div>

        <div style={css("flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px")}>
          {/* 신호 밴드 — PrepCard와 동일한 2타일 (감정온도 · 사고징후) */}
          <div style={css("display:flex;gap:12px")}>
            <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
              <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>고객 감정온도</div>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span className="lampdots">
                  <i className={"g" + (emotion === "stable" ? " lit" : "")} />
                  <i className={"a" + (emotion === "caution" ? " lit" : "")} />
                  <i className={"r" + (emotion === "elevated" ? " lit" : "")} />
                </span>
                <span style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:" + (emotion ? EMOTION_FG[emotion] : "var(--gray-700)"))}>
                  {emotion ? EMOTION_LABEL[emotion] : "—"}
                </span>
                <span style={css("font:600 9.5px 'Geist Mono',monospace;letter-spacing:.2px;padding:2px 6px;border-radius:5px;background:var(--gray-200);color:var(--gray-600)")}>데모값</span>
              </div>
            </div>
            <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                <span className="mi" style={css("font-size:14px;color:" + (record.risk === "high" ? "var(--red-900)" : "var(--green-900)"))}>gpp_maybe</span>사고 징후
              </div>
              <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:" + (record.risk === "high" ? "var(--red-900)" : "var(--green-900)"))}>
                {record.risk === "high" ? "높음" : record.risk === "low" ? "낮음" : "—"}
              </div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:" + (record.risk === "high" ? "var(--red-900)" : "var(--gray-700)") + ";margin-top:4px")}>
                {card?.riskReason ?? "특이 사고 징후 없음"}
              </div>
            </div>
          </div>

          {/* 배정 — PrepCard의 'AI 배정' 행 문법 */}
          <div style={css("background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
            <div style={css("display:flex;align-items:baseline;gap:7px;flex-wrap:wrap")}>
              <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{record.department ?? card?.department ?? "분석 중"}</span>
              {record.confidence != null && (
                <span style={css("font:600 10.5px 'Geist Mono','Geist Sans',monospace;color:var(--blue-900)")}>확신 {Math.round(record.confidence * 100)}%</span>
              )}
              <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>· {stateLabel}</span>
              {record.transferTo && (
                <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900)")}>· 이관 → {record.transferTo}</span>
              )}
            </div>
            {card?.routingReason && (
              <div style={css("font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);margin-top:6px")}>{card.routingReason}</div>
            )}
          </div>

          {/* 이 콜의 파이프라인 진행 */}
          <div>
            <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:2px")}>백엔드 처리 진행</div>
            <MiniPipeline stages={record.stages} />
          </div>
        </div>

        {/* 푸터 — 시각·출처·ID (PrepCard 푸터 스트립 문법) */}
        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:13px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("font:500 11px 'Geist Mono',monospace;color:var(--gray-700)")}>
            {fmtTime(record.startedAt)} 접수{record.endedAt ? ` · ${fmtTime(record.endedAt)} 종료` : ""}
          </span>
          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:" + (card?.source === "backend" ? "var(--green-900)" : "var(--gray-700)"))}>
            {card?.source === "backend" ? "실백엔드" : "데모"}
          </span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{record.callId}</span>
        </div>
      </div>
    </>
  );
}
