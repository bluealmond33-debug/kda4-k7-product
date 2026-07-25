import { useEffect } from "react";
import { BrandSymbol } from "../BrandLogo";
import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";
import { MiniPipeline } from "./RoutingFeed";
import { Thermometer, ConfidenceRing, EMOTION_LABEL as EMO_LABEL, EMOTION_SCORE, EMOTION_INK } from "../desktop/CardSignals";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
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
                <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
                  <span className="mi" style={css("font-size:13px")}>priority_high</span>
                  긴급 · 사고 징후 감지
                </span>
              ) : sge === "S" ? (
                <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
                  <span className="mi" style={css("font-size:13px")}>smart_toy</span>
                  단순 업무 · AI 자동 응대
                </span>
              ) : null}
              <div style={css("display:flex;gap:13px")}>
                <span style={css("width:4px;border-radius:2px;background:var(--blue-500);flex:none")} />
                <div style={css("min-width:0")}>
                  <div style={css("display:flex;align-items:center;gap:6px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                    <BrandSymbol size={16} color="var(--blue-700)" />
                    <span style={css("font:800 12px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-1000)")}>KARI-NA 브리핑</span>
                    <span style={css("font:400 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>· 받기 전 미리 듣고 정리</span>
                    {meta && (
                      <span style={css("display:inline-flex;align-items:center;gap:5px;margin-left:6px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:" + meta.fg)}>
                        <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + meta.bar)} />
                        {sge} · {meta.label}
                      </span>
                    )}
                  </div>
                  <div style={css("font:600 23px/1.35 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
                    {card ? card.summary : "분류 진행 중입니다…"}
                  </div>
                  {card && (
                    <div style={css("font:400 12.5px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-top:7px")}>
                      업무유형 · <span style={css("color:var(--gray-800)")}>{card.businessType}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {record.confidence != null && (
              <span style={css("display:inline-flex;align-items:center;gap:8px;background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:9999px;padding:4px 6px 4px 13px;flex:none;box-shadow:var(--sh-near)")}>
                <span style={css("display:flex;flex-direction:column;line-height:1.15")}>
                  <span style={css("font:600 9px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);letter-spacing:.2px")}>AI 배정</span>
                  <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")}>확신도</span>
                </span>
                <ConfidenceRing pct={Math.round(record.confidence * 100)} />
              </span>
            )}
            <span onClick={onClose} style={css("flex:none;cursor:pointer;display:flex;width:32px;height:32px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
              <span className="mi" style={css("font-size:19px;color:var(--gray-600)")}>close</span>
            </span>
          </div>
        </div>

        <div style={css("flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px")}>
          {/* 신호 밴드 — PrepCard와 동일한 2타일 (감정온도 · 사고징후) */}
          <div style={css("display:flex;gap:12px;align-items:stretch")}>
            {/* 감정온도 — 온도계 + 색 텍스트(준비 카드와 동일) */}
            <div style={css("flex:1;min-height:104px;background:var(--gray-100);border-radius:8px;padding:12px 14px")}>
              <div style={css("display:flex;align-items:center;gap:6px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>
                고객 감정온도
                <span style={css("font:600 9px ui-monospace,'SF Mono',Menlo,Consolas,monospace;padding:2px 6px;border-radius:5px;background:var(--gray-200);color:var(--gray-600)")}>데모값</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <Thermometer score={emotion ? EMOTION_SCORE[emotion] : null} color={emotion ? EMOTION_INK[emotion] : "var(--gray-400)"} />
                <div style={css("display:flex;align-items:baseline;gap:7px")}>
                  <span style={css("font:800 34px 'Avenir Next','Pretendard',sans-serif;letter-spacing:-1.2px;color:" + (emotion ? EMOTION_INK[emotion] : "var(--gray-500)"))}>{emotion ? EMOTION_SCORE[emotion] : "--"}°</span>
                  <span style={css("font:800 15px 'Avenir Next','Pretendard',sans-serif;color:" + (emotion ? EMOTION_INK[emotion] : "var(--gray-500)"))}>{emotion ? EMO_LABEL[emotion] : "—"}</span>
                </div>
              </div>
            </div>
            {/* 사고 징후(위험도) — 낮음=초록 점/중립, 높음=강한 빨강 경고 */}
            <div style={css("flex:1;min-height:104px;border-radius:8px;padding:12px 14px;background:" + (record.risk === "high" ? "var(--red-800)" : "var(--gray-100)"))}>
              <div style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;margin-bottom:7px;color:" + (record.risk === "high" ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>
                사고 징후 <span style={css("font-weight:400;opacity:.7")}>(위험도)</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span style={css("width:12px;height:12px;border-radius:9999px;flex:none;background:" + (record.risk === "high" ? "#fff" : record.risk === "low" ? "var(--green-700)" : "var(--gray-400)"))} />
                <span style={css("font:800 26px 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.8px;color:" + (record.risk === "high" ? "#fff" : "var(--gray-1000)"))}>{record.risk === "high" ? "높음" : record.risk === "low" ? "낮음" : "—"}</span>
              </div>
              <div style={css("font:400 11.5px/1.45 'Avenir Next','Pretendard',sans-serif;margin-top:6px;color:" + (record.risk === "high" ? "rgba(255,255,255,.88)" : "var(--gray-600)"))}>
                {card?.riskReason ?? "특이 사고 징후 없음"}
              </div>
            </div>
          </div>

          {/* 배정 — PrepCard의 'AI 배정' 행 문법 */}
          <div style={css("background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
            <div style={css("display:flex;align-items:baseline;gap:7px;flex-wrap:wrap")}>
              <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
              <span style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{record.department ?? card?.department ?? "분석 중"}</span>
              <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>· {stateLabel}</span>
              {record.transferTo && (
                <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900)")}>· 이관 → {record.transferTo}</span>
              )}
            </div>
            {card?.routingReason && (
              <div style={css("font:400 12px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800);margin-top:6px")}>{card.routingReason}</div>
            )}
            {/* 본인인증 상태 — 이관 시 받는 부서가 재확인 필요한지 신호(완료=차분, 미완료=주의) */}
            {record.verified != null && (
              <div style={css("display:inline-flex;align-items:center;gap:6px;margin-top:10px;background:var(--onair-surface);border:1px solid " + (record.verified ? "var(--gray-300)" : "var(--amber-700)") + ";border-radius:9999px;padding:4px 11px 4px 8px")}>
                <span className="mi" style={css("font-size:15px;color:" + (record.verified ? "var(--green-900)" : "var(--amber-900)"))}>{record.verified ? "verified_user" : "gpp_maybe"}</span>
                <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:" + (record.verified ? "var(--gray-900)" : "var(--amber-900)"))}>
                  본인인증 {record.verified ? "완료" : "미완료"}
                </span>
                <span style={css("font:400 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                  {record.verified ? "· 연결 즉시 상담 가능" : "· 연결 후 본인확인 필요"}
                </span>
              </div>
            )}
          </div>

          {/* 이 콜의 파이프라인 진행 */}
          <div>
            <div style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:2px")}>백엔드 처리 진행</div>
            <MiniPipeline stages={record.stages} />
          </div>
        </div>

        {/* 푸터 — 시각·출처·ID (PrepCard 푸터 스트립 문법) */}
        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:13px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("font:500 11px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--gray-700)")}>
            {fmtTime(record.startedAt)} 접수{record.endedAt ? ` · ${fmtTime(record.endedAt)} 종료` : ""}
          </span>
          <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:" + (card?.source === "backend" ? "var(--green-900)" : "var(--gray-700)"))}>
            {card?.source === "backend" ? "실백엔드" : "데모"}
          </span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--gray-600)")}>{record.callId}</span>
        </div>
      </div>
    </>
  );
}
