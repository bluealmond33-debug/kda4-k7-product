import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import { playTestCall } from "../../services/adminScenario";
import { PIPELINE_NODES } from "../../data/adminContent";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

/** 카드 속 미니 파이프라인 — 이 콜이 지금 8단계 중 어디를 지나는지.
 *  상단 큰 플로우가 '개념도'라면 이건 '이 콜의 실제 진행'이다 — 카드마다 제 프로세스가 돈다.
 *  done=초록 점 · 진행=파랑 점(점멸) · 대기=꺼진 점. compact는 스트립용(라벨 없음). */
function MiniPipeline({
  stages,
  compact = false,
}: {
  stages: AdminCallRecord["stages"];
  compact?: boolean;
}) {
  const active = PIPELINE_NODES.find((n) => stages[n.id] === "start") ?? null;
  const dots = (
    <span style={css("display:inline-flex;align-items:center;gap:" + (compact ? "3px" : "4px"))}>
      {PIPELINE_NODES.map((n) => {
        const st = stages[n.id];
        const size = compact ? 5 : 6;
        return (
          <span
            key={n.id}
            title={n.label}
            style={{
              width: size,
              height: size,
              borderRadius: 9999,
              flex: "none",
              background:
                st === "done"
                  ? "var(--green-700)"
                  : st === "start"
                  ? "var(--blue-700)"
                  : "rgba(107,111,116,.28)",
              ...(st === "start" ? { animation: "recBlink 1.2s infinite" } : null),
            }}
          />
        );
      })}
    </span>
  );
  if (compact) return dots;
  return (
    <div style={css("margin-top:8px;display:flex;align-items:center;gap:8px")}>
      {dots}
      {active && (
        <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900)")}>
          {active.label} 진행 중
        </span>
      )}
    </div>
  );
}

/**
 * [C] 실시간 라우팅 피드 — 최신 카드가 맨 위.
 * 가장 최근 콜은 카드 전체로 위에 얹히고(드롭인), 이전 콜들은 그 아래로 색 스트립이 겹쳐 쌓인다.
 * 콜이 들어올수록 아래로 덱이 두꺼워져 "얼마나 처리됐는지"가 한눈에 보인다.
 * 진행 중 긴급(E)은 정렬에서 맨 위 고정(useAdminFeed).
 */
export default function RoutingFeed({
  feed,
  totalCards,
  explain,
}: {
  feed: AdminCallRecord[];
  totalCards: number;
  explain: boolean;
}) {
  const front = feed[0] ?? null;
  const rest = feed.slice(1);

  return (
    <div className="card" style={css("display:flex;flex-direction:column;min-height:0;padding:16px 0 8px")}>
      {/* 헤더 — 누적 카운트가 '쌓임'의 숫자 지표 */}
      <div style={css("display:flex;align-items:center;gap:10px;padding:0 18px 10px")}>
        <span className="sechd">실시간 라우팅 피드</span>
        <span style={css("display:inline-flex;align-items:baseline;gap:4px;background:var(--gray-100);border-radius:9999px;padding:3px 11px")}>
          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>오늘 누적</span>
          <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{totalCards}</span>
          <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <div style={css("flex:1")} />
        {(["E", "G", "S"] as const).map((k) => (
          <span key={k} style={css("display:inline-flex;align-items:center;gap:5px")}>
            <span style={css("width:8px;height:8px;border-radius:9999px;background:" + SGE_META[k].bar)} />
            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
              {k} {SGE_META[k].label}
            </span>
          </span>
        ))}
      </div>

      {/* 설명 모드 — 이 패널의 백엔드 역할 한 줄 */}
      {explain && (
        <div style={css("margin:0 16px 8px;font:400 11px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border-radius:8px;padding:7px 11px;animation:dockDown .25s var(--ease-out)")}>
          분류 파이프라인의 출구 — 카드 1장이 PostgreSQL 상담카드 1건입니다. 카드가 쌓이는 속도가 곧 시스템 처리량입니다.
        </div>
      )}

      <div style={css("flex:1;overflow-y:auto;padding:4px 16px 10px;min-height:0;display:flex;flex-direction:column")}>
        {!front && (
          /* 빈 상태 — 세로 중앙 + 바로 시작할 수 있는 고스트 CTA (발표자가 어디서든 쇼를 연다) */
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:32px;color:var(--gray-500)")}>quickreply</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.65")}>
              아직 분류된 콜이 없습니다.
              <br />
              상담사 화면의 콜 또는 테스트 콜이 여기 카드로 쌓입니다.
            </span>
            <span className="ghosttile" onClick={() => playTestCall("G")}>
              <span className="mi" style={css("font-size:15px")}>play_arrow</span>테스트 콜로 흐름 보기
            </span>
          </div>
        )}

        {/* 최신 카드 — 맨 위, 전체 상세 + 드롭인 */}
        {front && <FrontCard key={front.callId} r={front} />}

        {/* 이전 콜 — 아래로 겹쳐 쌓이는 색 스트립 (최신 순) */}
        {rest.length > 0 && (
          <div style={css("margin-top:9px;display:flex;flex-direction:column")}>
            {rest.map((r, i) => (
              <StripCard key={r.callId} r={r} idx={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 최신 카드 — 맨 위, 분류 결과 전체. 새로 얹힐 때 위에서 '딜'되는 모션(cardDeal). */
function FrontCard({ r }: { r: AdminCallRecord }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;

  if (!r.card || !sge || !meta) {
    return (
      <div style={css("position:relative;border-radius:12px;background:var(--background-200);box-shadow:var(--sh-focus);padding:14px 16px;overflow:hidden;animation:cardDeal .34s var(--ease-out)")}>
        <div style={css("display:flex;align-items:center;gap:9px")}>
          <span className="mi" style={css("font-size:16px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
          <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 중…</span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700)")}>{fmtTime(r.startedAt)}</span>
        </div>
        <div style={css("margin-top:8px;font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.utterances[r.utterances.length - 1] ?? "발화 수신 대기 중"}
        </div>
        <MiniPipeline stages={r.stages} />
      </div>
    );
  }

  return (
    <div style={css("position:relative;border-radius:12px;background:var(--onair-surface);box-shadow:var(--sh-focus);padding:13px 16px 14px;overflow:hidden;animation:cardDeal .34s var(--ease-out)")}>
      <div style={css("display:flex;align-items:center;gap:8px")}>
        {/* S/G/E 신호 — 틴트·색 바 없이 점 + 잉크 (ONAIR: 색은 점·글자에만) */}
        <span style={css("flex:none;display:inline-flex;align-items:center;gap:6px;font:700 12px 'Geist Sans','Pretendard',sans-serif;color:" + meta.fg)}>
          <span style={css("width:9px;height:9px;border-radius:9999px;flex:none;background:" + meta.bar)} />
          {sge} · {meta.label}
        </span>
        <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.card.businessType}
        </span>
        <div style={css("flex:1")} />
        <span style={css("flex:none;font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700)")}>{fmtTime(r.startedAt)}</span>
      </div>
      <div style={css("margin-top:7px;font:400 12.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
        {r.card.summary}
      </div>
      {/* 이 콜의 프로세스 진행 — 진행 중일 때만 (완료 카드는 조용히) */}
      {live && <MiniPipeline stages={r.stages} />}
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
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--red-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>warning</span>사고징후 높음
          </span>
        )}
        {r.transferTo && (
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--blue-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>sync_alt</span>이관 → {r.transferTo}
          </span>
        )}
        <div style={css("flex:1")} />
        <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:" + (r.card.source === "backend" ? "var(--green-900)" : "var(--gray-700)"))}>
          {r.card.source === "backend" ? "실백엔드" : "데모"}
        </span>
        {!live && <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>· 완료</span>}
      </div>
    </div>
  );
}

/** 이전 콜 스트립 — 최신 카드 아래로 겹쳐 쌓인다. 색 바 + 업무명 + 부서 + 시각. */
function StripCard({ r, idx }: { r: AdminCallRecord; idx: number }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  const live = r.endedAt === null;
  return (
    <div
      style={css(
        "position:relative;border-radius:9px;background:var(--background-200);box-shadow:var(--sh-near);padding:8px 12px;overflow:hidden;transition:opacity .3s;" +
          (idx === 0 ? "" : "margin-top:-3px;") +
          (live ? "" : "opacity:.72")
      )}
    >
      <div style={css("display:flex;align-items:center;gap:8px")}>
        {/* S/G/E 신호 — 점 + 잉크 (틴트·색 바 금지) */}
        {meta ? (
          <span style={css("flex:none;display:inline-flex;align-items:center;gap:5px;font:700 10.5px 'Geist Mono',monospace;color:" + meta.fg)}>
            <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + meta.bar)} />
            {sge}
          </span>
        ) : (
          <span className="mi" style={css("flex:none;font-size:13px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
        )}
        <span style={css("flex:1;min-width:0;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.card ? r.card.businessType : "분류 중…"}
        </span>
        {/* 진행 중인 콜은 스트립에서도 제 프로세스가 돈다 */}
        {live && <MiniPipeline stages={r.stages} compact />}
        <span style={css("flex:none;font:500 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px")}>
          {r.department ?? r.card?.department ?? ""}
        </span>
        <span style={css("flex:none;font:500 10px 'Geist Mono',monospace;color:var(--gray-700)")}>{fmtTime(r.startedAt)}</span>
      </div>
    </div>
  );
}
