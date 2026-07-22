import type { CSSProperties } from "react";
import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

// 3D 덱: 맨 앞(최신) 카드가 완전히 보이고, 이전 카드들이 위로 겹쳐 올라오며 물러난다.
const DECK_VISIBLE = 5; // 덱에 겹쳐 보일 최대 장수
const PEEK = 30; // 뒤 카드가 앞 카드 위로 삐져나오는 간격(px) — 상단 요약 줄이 보일 만큼
const CARD_H = 128; // 덱 카드 고정 높이(앞·뒤 동일해야 뒤 카드 상단이 정확히 삐져나온다)

/**
 * [C] 실시간 라우팅 피드 — 3D 카드 덱.
 * 앞(최신) 콜은 카드 전체로, 이전 콜들은 위로 겹쳐 올라오며 물러난다(덱이 두꺼워짐).
 * 덱에 못 담긴 오래된 콜은 아래 색 스트립 히스토리로 흐른다. 진행 중 긴급(E)은 맨 위 고정.
 * 콜이 들어올수록 덱이 시각적으로 두꺼워져 "얼마나 처리됐는지"가 한눈에 보인다.
 */
export default function RoutingFeed({
  feed,
  totalCards,
}: {
  feed: AdminCallRecord[];
  totalCards: number;
}) {
  const deck = feed.slice(0, DECK_VISIBLE);
  const tail = feed.slice(DECK_VISIBLE);

  return (
    <div className="card" style={css("display:flex;flex-direction:column;min-height:0;padding:16px 0 8px")}>
      {/* 헤더 — 누적 카운트가 '쌓임'의 숫자 지표 */}
      <div style={css("display:flex;align-items:center;gap:10px;padding:0 18px 10px")}>
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

      {!feed.length && (
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:var(--gray-600)")}>
          <span className="mi" style={css("font-size:32px;color:var(--gray-500)")}>quickreply</span>
          <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.65")}>
            아직 분류된 콜이 없습니다.
            <br />
            상담사 화면의 콜 또는 테스트 콜이 여기 카드로 쌓입니다.
          </span>
        </div>
      )}

      {/* 3D 덱 — 앞 카드는 완전히, 뒤 카드는 위로 겹쳐 올라오며 물러난다 */}
      {feed.length > 0 && (
        <div
          style={{
            position: "relative",
            flex: "none",
            margin: "4px 16px 0",
            height: CARD_H + (deck.length - 1) * PEEK,
          }}
        >
          {/* 뒤에서부터 그려 앞 카드(i=0)가 맨 위에 오도록 */}
          {deck
            .map((r, i) => (
              <DeckCard key={r.callId} r={r} i={i} front={i === 0} />
            ))
            .reverse()}
        </div>
      )}

      {/* 히스토리 — 덱에 못 담긴 오래된 콜은 색 스트립으로 흐른다 */}
      {tail.length > 0 && (
        <div style={css("flex:1;overflow-y:auto;padding:10px 16px 8px;min-height:0;display:flex;flex-direction:column")}>
          <div style={css("font:700 9.5px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.4px;color:var(--gray-600);padding:0 2px 6px")}>
            이전 처리 흐름 · {tail.length}건
          </div>
          {tail.map((r, i) => (
            <StripCard key={r.callId} r={r} idx={i} />
          ))}
        </div>
      )}
      {tail.length === 0 && feed.length > 0 && <div style={css("flex:1")} />}
    </div>
  );
}

/** 덱의 한 장 — 앞·뒤 동일 높이(CARD_H). 위로 갈수록 살짝 좁아지고(inset) 흐려져 물러난다. */
function DeckCard({ r, i, front }: { r: AdminCallRecord; i: number; front: boolean }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;

  const wrap: CSSProperties = {
    position: "absolute",
    left: i * 6,
    right: i * 6,
    bottom: 0,
    height: CARD_H,
    transform: `translateY(${-i * PEEK}px)`,
    zIndex: 50 - i,
    opacity: Math.max(0.74, 1 - i * 0.08),
    borderRadius: 12,
    background: "var(--onair-surface)",
    boxShadow: front ? "var(--sh-focus)" : "var(--sh-near)",
    overflow: "hidden",
    ...(front ? { animation: "cardDeal .34s var(--ease-out)" } : null),
  };
  const bar = (
    <span style={css("position:absolute;left:0;top:0;bottom:0;width:" + (front ? "5" : "4") + "px;background:" + (meta ? meta.bar : "var(--gray-400)"))} />
  );

  // 분류 전 — 스켈레톤
  if (!r.card || !sge || !meta) {
    return (
      <div style={wrap}>
        {bar}
        <div style={css("padding:12px 15px 12px 18px")}>
          <div style={css("display:flex;align-items:center;gap:9px")}>
            <span className="mi" style={css("font-size:15px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
            <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 중…</span>
            <div style={css("flex:1")} />
            <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
          </div>
          <div style={css("margin-top:8px;font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
            {r.utterances[r.utterances.length - 1] ?? "발화 수신 대기 중"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      {bar}
      <div style={css("padding:12px 16px 12px " + (front ? "20" : "18") + "px")}>
        {/* 상단 요약 줄 — 뒤 카드는 이 줄만 삐져나와 보인다 */}
        <div style={css("display:flex;align-items:center;gap:8px")}>
          <span style={css("flex:none;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;border-radius:6px;padding:2.5px 8px;background:" + meta.bg + ";color:" + meta.fg)}>
            {sge} · {meta.label}
          </span>
          <span style={css("font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
            {r.card.businessType}
          </span>
          <div style={css("flex:1")} />
          <span style={css("flex:none;font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
        </div>
        <div style={css("margin-top:7px;font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
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
    </div>
  );
}

/** 히스토리 스트립 — 덱 아래로 흐르는 오래된 콜. 살짝 겹쳐 흐름처럼 보인다. */
function StripCard({ r, idx }: { r: AdminCallRecord; idx: number }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;
  return (
    <div
      style={css(
        "position:relative;border-radius:9px;background:var(--background-200);box-shadow:var(--sh-near);padding:7px 12px 7px 15px;overflow:hidden;transition:opacity .3s;" +
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
        <span style={css("flex:none;font:500 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px")}>
          {r.department ?? r.card?.department ?? ""}
        </span>
        <span style={css("flex:none;font:500 10px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
      </div>
    </div>
  );
}
