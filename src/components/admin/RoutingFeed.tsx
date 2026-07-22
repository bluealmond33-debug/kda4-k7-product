import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

/**
 * [C] 실시간 라우팅 피드 — "쌓이는 카드 덱".
 * 맨 위(가장 최근)는 카드 전체를, 그 아래로는 분류된 콜들이 색 스트립으로 층층이 쌓인다.
 * 카드가 들어올수록 덱이 시각적으로 두꺼워져 "얼마나 처리했는지"가 한눈에 보인다.
 * 진행 중 긴급(E)은 피드 정렬에서 맨 위로 고정된다(useAdminFeed).
 */
export default function RoutingFeed({
  feed,
  totalCards,
}: {
  feed: AdminCallRecord[];
  totalCards: number;
}) {
  const front = feed[0] ?? null;
  const rest = feed.slice(1);

  return (
    <div className="card" style={css("display:flex;flex-direction:column;min-height:0;padding:16px 0 8px")}>
      {/* 헤더 — 누적 카운트가 '쌓임'의 숫자 지표 */}
      <div style={css("display:flex;align-items:center;gap:10px;padding:0 18px 12px")}>
        <span className="sechd">실시간 라우팅 피드</span>
        <span style={css("display:inline-flex;align-items:baseline;gap:4px;background:var(--gray-100);border-radius:9999px;padding:3px 11px")}>
          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>누적</span>
          <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{totalCards}</span>
          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <div style={css("flex:1")} />
        {(["E", "G", "S"] as const).map((k) => (
          <span key={k} style={css("display:inline-flex;align-items:center;gap:5px")}>
            <span style={css("width:8px;height:8px;border-radius:2.5px;background:" + SGE_META[k].bar)} />
            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
              {k} {SGE_META[k].label}
            </span>
          </span>
        ))}
      </div>

      {/* 덱 — 위: 최근 카드 전체 / 아래: 쌓이는 색 스트립 */}
      <div style={css("flex:1;overflow-y:auto;padding:4px 16px 12px;min-height:0")}>
        {!front && (
          <div style={css("display:flex;flex-direction:column;align-items:center;gap:8px;padding:52px 20px;color:var(--gray-600)")}>
            <span className="mi" style={css("font-size:30px;color:var(--gray-500)")}>quickreply</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              아직 분류된 콜이 없습니다.
              <br />
              상담사 화면의 콜 또는 테스트 콜이 여기 카드로 쌓입니다.
            </span>
          </div>
        )}

        {front && <FrontCard key={front.callId} r={front} />}

        {/* 뒤로 쌓이는 스트립 — 살짝 겹쳐 '한 벌의 덱'처럼 보인다 */}
        {rest.length > 0 && (
          <div style={css("margin-top:8px;display:flex;flex-direction:column")}>
            {rest.map((r, i) => (
              <StripCard key={r.callId} r={r} idx={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 맨 위 카드 — 최근 분류 결과 전체. 새로 얹힐 때 위에서 '딜'되는 모션(cardDeal). */
function FrontCard({ r }: { r: AdminCallRecord }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;

  if (!r.card || !sge || !meta) {
    // 분류 전 — 스켈레톤 히어로
    return (
      <div style={css("position:relative;border-radius:12px;background:var(--background-200);box-shadow:var(--sh-near);padding:14px 16px 14px 18px;overflow:hidden;animation:cardDeal .34s var(--ease-out)")}>
        <span style={css("position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--gray-400)")} />
        <div style={css("display:flex;align-items:center;gap:9px")}>
          <span className="mi" style={css("font-size:16px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
          <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 중…</span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
        </div>
        <div style={css("margin-top:8px;font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.utterances[r.utterances.length - 1] ?? "발화 수신 대기 중"}
        </div>
      </div>
    );
  }

  return (
    <div style={css("position:relative;border-radius:12px;background:var(--onair-surface);box-shadow:var(--sh-focus);padding:14px 16px 14px 20px;overflow:hidden;animation:cardDeal .34s var(--ease-out)")}>
      <span style={css("position:absolute;left:0;top:0;bottom:0;width:5px;background:" + meta.bar)} />
      <div style={css("display:flex;align-items:center;gap:8px")}>
        <span style={css("flex:none;font:700 11px 'Geist Sans','Pretendard',sans-serif;border-radius:7px;padding:3px 9px;background:" + meta.bg + ";color:" + meta.fg)}>
          {sge} · {meta.label}
        </span>
        <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.card.businessType}
        </span>
        <div style={css("flex:1")} />
        <span style={css("flex:none;font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
      </div>
      <div style={css("margin-top:7px;font:400 12.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
        {r.card.summary}
      </div>
      <div style={css("margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
        <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-900);border-radius:9999px;padding:3px 9px")}>
          {r.department ?? r.card.department}
        </span>
        {r.confidence != null && (
          <span style={css("font:600 10.5px 'Geist Mono',monospace;background:var(--gray-100);color:var(--gray-800);border-radius:9999px;padding:3px 9px")}>
            확신 {Math.round(r.confidence * 100)}%
          </span>
        )}
        {r.risk === "high" && (
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--red-100);color:var(--red-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>warning</span>사고징후 높음
          </span>
        )}
        {r.transferTo && (
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--blue-100);color:var(--blue-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>sync_alt</span>이관 → {r.transferTo}
          </span>
        )}
        <div style={css("flex:1")} />
        <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:" + (r.card.source === "backend" ? "var(--green-900)" : "var(--gray-600)"))}>
          {r.card.source === "backend" ? "실백엔드" : "데모"}
        </span>
        {!live && <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 완료</span>}
      </div>
    </div>
  );
}

/** 뒤로 쌓이는 스트립 — 색 바 + 업무명 + 부서 + 시각. 살짝 겹쳐 덱처럼 보인다. */
function StripCard({ r, idx }: { r: AdminCallRecord; idx: number }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;
  return (
    <div
      style={css(
        "position:relative;border-radius:9px;background:var(--background-200);box-shadow:var(--sh-near);padding:8px 12px 8px 15px;overflow:hidden;transition:opacity .3s;" +
          (idx === 0 ? "" : "margin-top:-3px;") +
          (live ? "" : "opacity:.72")
      )}
    >
      <span style={css("position:absolute;left:0;top:0;bottom:0;width:4px;background:" + (meta ? meta.bar : "var(--gray-400)"))} />
      <div style={css("display:flex;align-items:center;gap:8px")}>
        {meta ? (
          <span style={css("flex:none;font:700 9.5px 'Geist Mono',monospace;border-radius:5px;padding:2px 6px;background:" + meta.bg + ";color:" + meta.fg)}>{sge}</span>
        ) : (
          <span className="mi" style={css("flex:none;font-size:13px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
        )}
        <span style={css("flex:1;min-width:0;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.card ? r.card.businessType : "분류 중…"}
        </span>
        <span style={css("flex:none;font:500 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px")}>
          {r.department ?? r.card?.department ?? ""}
        </span>
        <span style={css("flex:none;font:500 10px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
      </div>
    </div>
  );
}
