import { useEffect } from "react";
import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";
import { MiniPipeline } from "./RoutingFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

/** 상담카드 상세 — 피드 타임라인 행 클릭 시. 그 콜의 카드 전체(요약·라우팅 근거·위험·진행)를 보여준다. */
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

  const chip = (text: string, color = "var(--gray-900)") => (
    <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:" + color + ";border-radius:9999px;padding:3px 10px;white-space:nowrap")}>
      {text}
    </span>
  );

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:560px;max-width:92vw;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 — S/G/E 신호 + 업무명 + 상태 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 10px")}>
          {meta ? (
            <span style={css("flex:none;display:inline-flex;align-items:center;gap:7px;font:700 13px 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>
              <span style={css("width:10px;height:10px;border-radius:9999px;flex:none;background:" + meta.bar)} />
              {sge} · {meta.label}
            </span>
          ) : (
            <span className="mi" style={css("font-size:16px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
          )}
          <span style={css("font:700 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
            {card ? card.businessType : "분류 중…"}
          </span>
          <div style={css("flex:1")} />
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100);flex:none")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div style={css("padding:0 20px 18px;display:flex;flex-direction:column;gap:11px")}>
          {/* 요약 */}
          {card && (
            <div style={css("font:400 13px/1.65 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);background:var(--background-200);border-radius:10px;padding:11px 14px")}>
              {card.summary}
            </div>
          )}

          {/* 라우팅 근거 · 위험 사유 */}
          {card?.routingReason && (
            <div style={css("display:flex;gap:8px;align-items:flex-start")}>
              <span style={css("flex:none;font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);width:60px;padding-top:2px")}>배정 근거</span>
              <span style={css("font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{card.routingReason}</span>
            </div>
          )}
          {card?.riskReason && (
            <div style={css("display:flex;gap:8px;align-items:flex-start")}>
              <span style={css("flex:none;font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900);width:60px;padding-top:2px")}>위험 사유</span>
              <span style={css("font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>{card.riskReason}</span>
            </div>
          )}

          {/* 메타 칩 */}
          <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
            {chip(record.department ?? card?.department ?? "부서 미정")}
            {record.confidence != null && chip(`확신 ${Math.round(record.confidence * 100)}%`)}
            {record.risk === "high" && chip("사고징후 높음", "var(--red-900)")}
            {record.transferTo && chip(`이관 → ${record.transferTo}`, "var(--blue-900)")}
            {chip(stateLabel, ended ? "var(--gray-700)" : "var(--blue-900)")}
            {chip(card?.source === "backend" ? "실백엔드" : "데모", card?.source === "backend" ? "var(--green-900)" : "var(--gray-700)")}
          </div>

          {/* 이 콜의 파이프라인 진행 */}
          <div style={css("border-top:1px solid var(--gray-200);padding-top:10px")}>
            <MiniPipeline stages={record.stages} />
          </div>

          <div style={css("display:flex;align-items:center;gap:10px;font:500 10px 'Geist Mono',monospace;color:var(--gray-600)")}>
            <span>{fmtTime(record.startedAt)} 접수{record.endedAt ? ` · ${fmtTime(record.endedAt)} 종료` : ""}</span>
            <div style={css("flex:1")} />
            <span>{record.callId}</span>
          </div>
        </div>
      </div>
    </>
  );
}
