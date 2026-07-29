import { useEffect } from "react";
import { BrandSymbol } from "../BrandLogo";
import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";
import { MiniPipeline } from "./RoutingFeed";
import { Thermometer, EMOTION_LABEL as EMO_LABEL, EMOTION_SCORE, EMOTION_INK } from "../desktop/CardSignals";

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
        {/*
          **상담사 카드와 같은 표지.**

          여기만 자기 조판을 갖고 있었다 — 로고 대신 브리핑 글자, % 대신 도넛 고리, 큰
          빨간 배지. 같은 통화인데 상담사가 보는 카드와 관리자가 보는 카드가 다르게 생겼다는
          뜻이고, 두 화면을 나란히 켜는 시연에서 그게 바로 드러난다.

          이제 BriefingCardBody의 표지 문법을 그대로 쓴다: 락업 → 가는 선 → 카드 이름 →
          오른쪽 끝에 AI 정확도 %. 긴급은 배지를 키우는 대신 **왼쪽 세로 획을 빨갛게** 한다
          (온에어: 색은 점·글자·가는 선에만).
        */}
        <div style={css("flex:none;padding:12px 22px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:15px")}>
          <BrandSymbol size={22} color="var(--blue-700)" />
          <span style={css("flex:none;width:1px;height:16px;background:var(--gray-300)")} />
          <span style={css("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>
            카드 브리핑 요약
          </span>
          {meta && (
            <span style={css("flex:none;display:inline-flex;align-items:center;gap:5px;font:700 11px 'Avenir Next','Pretendard',sans-serif;color:" + meta.fg)}>
              <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + meta.bar)} />
              {sge} · {meta.label}
            </span>
          )}
          {record.confidence != null && (
            <span style={css("flex:none;display:flex;align-items:baseline;gap:7px")}>
              <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>AI 정확도</span>
              <span style={css("font:800 17px/1 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.4px;font-variant-numeric:tabular-nums;color:var(--gray-1000)")}>
                {Math.round(record.confidence * 100)}
                <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>%</span>
              </span>
            </span>
          )}
          <span onClick={onClose} style={css("flex:none;cursor:pointer;display:flex;width:30px;height:30px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        {/*
          **좌: 흘끗 보는 지표 · 우: 전화 요약.**

          상담사 준비카드(BriefingCardBody)가 쓰는 그 갈림이다. 예전에는 감정·위험을 위에
          가로로 눕히고 요약을 헤더에 박아 뒀는데, 그러면 이 카드에서 가장 중요한 것(고객이
          무슨 말을 했나)이 제목처럼 한 줄로 지나간다. 요약을 오른쪽 큰 칸에 세우고 근거
          발화까지 붙여야 "AI가 이걸 보고 이렇게 판단했다"가 읽힌다.
        */}
        <div style={css("flex:1;overflow:auto;padding:16px 22px;display:grid;grid-template-columns:186px minmax(0,1fr);gap:12px;align-items:start")}>
          {/* ── 왼쪽 ── */}
          <div style={css("display:flex;flex-direction:column;gap:10px")}>
            <div style={css("background:var(--gray-100);border-radius:8px;padding:12px 13px")}>
              <div style={css("display:flex;align-items:center;gap:6px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>
                고객 감정온도
                <span style={css("font:600 9px 'Avenir Next','Pretendard',sans-serif;padding:2px 6px;border-radius:5px;background:var(--gray-200);color:var(--gray-600)")}>데모값</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:10px")}>
                <Thermometer score={emotion ? EMOTION_SCORE[emotion] : null} color={emotion ? EMOTION_INK[emotion] : "var(--gray-400)"} />
                <div style={css("display:flex;flex-direction:column")}>
                  <span style={css("font:800 30px/1 'Avenir Next','Pretendard',sans-serif;letter-spacing:-1.1px;color:" + (emotion ? EMOTION_INK[emotion] : "var(--gray-500)"))}>
                    {emotion ? EMOTION_SCORE[emotion] : "--"}°
                  </span>
                  <span style={css("margin-top:5px;font:800 13px 'Avenir Next','Pretendard',sans-serif;color:" + (emotion ? EMOTION_INK[emotion] : "var(--gray-500)"))}>
                    {emotion ? EMO_LABEL[emotion] : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* 배정 — 부서 · 업무코드 두 줄(준비카드와 같은 순서) */}
            <div style={css("background:var(--gray-100);border-radius:8px;padding:12px 13px")}>
              <div style={css("display:flex;align-items:baseline;gap:7px")}>
                <span style={css("flex:none;width:26px;font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>부서</span>
                <span style={css("font:700 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>
                  {record.department ?? card?.department ?? "분석 중"}
                </span>
              </div>
              <div style={css("display:flex;align-items:baseline;gap:7px;margin-top:6px")}>
                <span style={css("flex:none;width:26px;font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>업무</span>
                <span style={css("font:700 13px 'Avenir Next','Pretendard',sans-serif;font-variant-numeric:tabular-nums;color:" + (card?.businessCode ? "var(--gray-1000)" : "var(--gray-600)"))}>
                  {card?.businessCode ?? "미분류"}
                </span>
                {card?.businessCodeLabel && (
                  <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                    {card.businessCodeLabel}
                  </span>
                )}
              </div>
              <div style={css("margin-top:9px;font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{stateLabel}</div>
              {record.transferTo && (
                <div style={css("margin-top:4px;font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900)")}>이관 → {record.transferTo}</div>
              )}
            </div>

            {/* 사고 징후 — 높을 때만 면을 채운다. 낮으면 한 줄로 족하다 */}
            {record.risk === "high" ? (
              <div style={css("border-radius:8px;padding:12px 13px;background:var(--red-800)")}>
                <div style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:rgba(255,255,255,.85)")}>사고 징후</div>
                <div style={css("margin-top:5px;font:800 20px 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.6px;color:#fff")}>높음</div>
                {card?.riskReason && (
                  <div style={css("margin-top:6px;font:400 11px/1.45 'Avenir Next','Pretendard',sans-serif;color:rgba(255,255,255,.88)")}>{card.riskReason}</div>
                )}
              </div>
            ) : (
              <div style={css("background:var(--gray-100);border-radius:8px;padding:11px 13px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                사고 징후 <span style={css("color:var(--gray-900)")}>{record.risk === "low" ? "낮음" : "—"}</span>
              </div>
            )}

            {/* 본인인증 — 준비카드와 같은 자물쇠 줄 */}
            {record.verified != null && (
              <div style={css("display:flex;align-items:center;gap:7px;background:var(--onair-surface);border:1px solid " + (record.verified ? "var(--gray-300)" : "var(--amber-700)") + ";border-radius:8px;padding:9px 12px")}>
                <span className="mi" style={css("font-size:15px;color:" + (record.verified ? "var(--green-900)" : "var(--amber-900)"))}>
                  {record.verified ? "verified_user" : "gpp_maybe"}
                </span>
                <span style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:" + (record.verified ? "var(--gray-900)" : "var(--amber-900)"))}>
                  인증 {record.verified ? "완료" : "미완료"}
                </span>
              </div>
            )}
          </div>

          {/* ── 오른쪽 ── 전화 요약. 이 카드에서 가장 큰 비중 */}
          <div style={css("border:1px solid var(--blue-500);border-radius:8px;padding:14px 16px;min-height:220px;display:flex;flex-direction:column")}>
            <div style={css("display:flex;align-items:center;gap:6px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
              <span className="mi" style={css("font-size:14px")}>description</span>
              전화 요약 · 고객 발화 STT
            </div>
            <div style={css("margin-top:9px;font:700 17px/1.4 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
              {card ? card.summary : "분류 진행 중입니다…"}
            </div>

            {/* 근거 발화 — 요약이 어디서 나왔는지. 없으면 그리지 않는다 */}
            {card?.transcriptQuote && (
              <div style={css("margin-top:9px;font:400 11.5px/1.6 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                <span style={css("color:var(--gray-600)")}>근거 발화 · </span>
                <span style={css("font-style:italic")}>“{card.transcriptQuote}”</span>
              </div>
            )}

            {/* AI가 발화에서 분해한 요구사항 — 빈 배열이면 빈 채로 둔다(없는 분석을 만들지 않는다) */}
            {card?.summaryPoints && card.summaryPoints.length > 0 && (
              <ul style={css("margin:13px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px")}>
                {card.summaryPoints.map((t) => (
                  <li key={t} style={css("display:flex;gap:8px;font:500 12.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>
                    <span style={css("flex:none;width:5px;height:5px;border-radius:9999px;background:var(--blue-700);margin-top:7px")} />
                    {t}
                  </li>
                ))}
              </ul>
            )}

            {card?.routingReason && (
              <div style={css("margin-top:12px;font:400 11.5px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                {card.routingReason}
              </div>
            )}

            <div style={css("flex:1")} />

            {card?.needTags && card.needTags.length > 0 && (
              <div style={css("margin-top:13px;padding-top:11px;border-top:1px solid var(--gray-200);display:flex;align-items:center;gap:7px;flex-wrap:wrap")}>
                <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>핵심 니즈</span>
                {card.needTags.map((t) => (
                  <span key={t} style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900);background:var(--gray-100);border-radius:9999px;padding:4px 10px")}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div style={css("margin-top:13px")}>
              <div style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:3px")}>백엔드 처리 진행</div>
              <MiniPipeline stages={record.stages} />
            </div>
          </div>
        </div>

        {/* 푸터 — 시각·출처·ID (PrepCard 푸터 스트립 문법) */}
        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:13px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
            {fmtTime(record.startedAt)} 접수{record.endedAt ? ` · ${fmtTime(record.endedAt)} 종료` : ""}
          </span>
          <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:" + (card?.source === "backend" ? "var(--green-900)" : "var(--gray-700)"))}>
            {card?.source === "backend" ? "실백엔드" : "데모"}
          </span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>{record.callId}</span>
        </div>
      </div>
    </>
  );
}
