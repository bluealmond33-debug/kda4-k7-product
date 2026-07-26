import { css } from "../../lib/css";
import Spinner from "../Spinner";
import { SGE_META } from "../../services";
import { playTestCall } from "../../services/adminScenario";
import { PIPELINE_NODES } from "../../data/adminContent";
import AnimatedList from "../ui/AnimatedList";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

/** 카드 속 미니 파이프라인 — 이 콜이 지금 8단계 중 어디를 지나는지.
 *  상단 큰 플로우가 '개념도'라면 이건 '이 콜의 실제 진행'이다 — 카드마다 제 프로세스가 돈다.
 *  done=초록 점 · 진행=파랑 점(점멸) · 대기=꺼진 점. compact는 스트립용(라벨 없음). */
export function MiniPipeline({
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
        <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900)")}>
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
  onOpenCard,
}: {
  feed: AdminCallRecord[];
  totalCards: number;
  explain: boolean;
  /** 타임라인 행 클릭 → 상담카드 상세 팝업 */
  onOpenCard: (r: AdminCallRecord) => void;
}) {
  // "진행 중" = 분류 파이프라인이 도는 중(라우팅 전). 라우팅되면 이 피드의 여정은 끝 —
  // 대기열 배정(G/E)이든 AI 응대(S)든 타임라인으로 내려간다. (라우팅 후 통화·후처리는
  // 부서 보드·상담사 화면 몫 — 그래서 대기 중인 긴급 콜이 여기서 영원히 "진행 중"으로 남지 않는다)
  const pipelineLive = feed.filter((r) => r.endedAt === null && r.sge === null);
  const heroes = pipelineLive.length > 0 ? pipelineLive : feed.slice(0, 1);
  const heroIds = new Set(heroes.map((r) => r.callId));
  const strips = feed.filter((r) => !heroIds.has(r.callId));

  return (
    /* height:100% — 그리드 행이 부서 보드 높이로 늘어나도 이 카드가 따라 늘어나
       목록이 바닥까지 이어진다(짧게 서면 아래가 빈 채로 잘려 보인다) */
    <div className="card" style={css("height:100%;display:flex;flex-direction:column;min-height:0;padding:16px 0 8px")}>
      {/* 헤더 — 범례는 카드가 스스로 말하므로 없앴다(중복). 전부 nowrap: 좁아도 안 꺾인다 */}
      <div style={css("display:flex;align-items:center;gap:10px;padding:0 18px 10px;white-space:nowrap")}>
        <span className="sechd" style={css("white-space:nowrap")}>실시간 라우팅 피드</span>
        <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:4px;background:var(--gray-100);border-radius:9999px;padding:3px 11px;white-space:nowrap")}>
          <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>오늘 누적</span>
          <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{totalCards}</span>
          <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <div style={css("flex:1")} />
        {pipelineLive.length > 0 && (
          <span style={css("flex:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap")}>
            <span className="onairdot" style={{ animation: "recBlink 1.4s infinite" }} />
            <span style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>분류 중 {pipelineLive.length}건</span>
          </span>
        )}
      </div>

      {/* 설명 모드 — 이 패널의 백엔드 역할 한 줄 */}
      {explain && (
        <div style={css("margin:0 16px 8px;font:400 11px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border:1px solid var(--blue-500);border-radius:8px;padding:7px 11px;animation:dockDown .25s var(--ease-out)")}>
          분류 파이프라인의 출구 — 카드 1장이 PostgreSQL 상담카드 1건입니다. 카드가 쌓이는 속도가 곧 시스템 처리량입니다.
        </div>
      )}

      <div style={css("flex:1;overflow-y:auto;padding:4px 16px 10px;min-height:0;display:flex;flex-direction:column")}>
        {feed.length === 0 && (
          /* 빈 상태 — 세로 중앙 + 바로 시작할 수 있는 고스트 CTA (발표자가 어디서든 쇼를 연다) */
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:32px;color:var(--gray-500)")}>quickreply</span>
            <span style={css("font:400 12.5px 'Avenir Next','Pretendard',sans-serif;text-align:center;line-height:1.65")}>
              아직 분류된 콜이 없습니다.
              <br />
              상담사 화면의 콜 또는 테스트 콜이 여기 카드로 쌓입니다.
            </span>
            <span className="ghosttile" onClick={() => playTestCall("G")}>
              <span className="mi" style={css("font-size:15px")}>play_arrow</span>테스트 콜로 흐름 보기
            </span>
          </div>
        )}

        {/* 진행 중 콜 전부 — 카드마다 제 프로세스(미니 파이프라인)가 돈다 */}
        {heroes.length > 0 && (
          <div style={css("display:flex;flex-direction:column;gap:8px")}>
            {heroes.map((r) => (
              <FrontCard key={r.callId} r={r} />
            ))}
          </div>
        )}

        {/* 완료된 콜 — 관제실 처리 로그(타임라인): 시각 거터 + 헤어라인 위의 색 점 */}
        {strips.length > 0 && (
          <div style={css("margin-top:12px")}>
            <div style={css("font:700 9.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.4px;color:var(--gray-700);padding:0 2px 7px")}>
              처리 흐름 · {strips.length}건
            </div>
            <div style={css("position:relative")}>
              {/* 타임라인 축 — 점들이 이 선 위에 앉는다 */}
              <div style={css("position:absolute;left:57px;top:7px;bottom:7px;width:1px;background:var(--gray-300)")} />
              {/* 새 처리 건이 위에서 내려앉는다 — 관제는 목록이 '변했다'는 걸 숫자보다 먼저 봐야 한다 */}
              <AnimatedList>
                {strips.map((r) => (
                  <TimelineRow key={r.callId} r={r} onOpen={() => onOpenCard(r)} />
                ))}
              </AnimatedList>
            </div>
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
          <Spinner size={16} speedMs={800} />
          <span style={css("font:700 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>분류 중…</span>
          <div style={css("flex:1")} />
          <span style={css("font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{fmtTime(r.startedAt)}</span>
        </div>
        <div style={css("margin-top:8px;font:400 12px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
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
        <span style={css("flex:none;display:inline-flex;align-items:center;gap:6px;font:700 12px 'Avenir Next','Pretendard',sans-serif;color:" + meta.fg)}>
          <span style={css("width:9px;height:9px;border-radius:9999px;flex:none;background:" + meta.bar)} />
          {sge} · {meta.label}
        </span>
        <span style={css("font:700 14px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
          {r.card.businessType}
        </span>
        <div style={css("flex:1")} />
        <span style={css("flex:none;font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{fmtTime(r.startedAt)}</span>
      </div>
      <div style={css("margin-top:7px;font:400 12.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
        {r.card.summary}
      </div>
      {/* 이 콜의 프로세스 진행 — 진행 중일 때만 (완료 카드는 조용히) */}
      {live && <MiniPipeline stages={r.stages} />}
      <div style={css("margin-top:9px;display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
        <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-900);border-radius:9999px;padding:3px 9px")}>
          {r.department ?? r.card.department}
        </span>
        {r.confidence != null && (
          <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-800);border-radius:9999px;padding:3px 9px")}>
            확신 {Math.round(r.confidence * 100)}%
          </span>
        )}
        {r.risk === "high" && (
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:700 10.5px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);color:var(--red-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>warning</span>사고징후 높음
          </span>
        )}
        {r.transferTo && (
          <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 10.5px 'Avenir Next','Pretendard',sans-serif;background:var(--gray-100);color:var(--blue-900);border-radius:9999px;padding:3px 9px")}>
            <span className="mi" style={css("font-size:12px")}>sync_alt</span>이관 → {r.transferTo}
          </span>
        )}
        <div style={css("flex:1")} />
        <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:" + (r.card.source === "backend" ? "var(--green-900)" : "var(--gray-700)"))}>
          {r.card.source === "backend" ? "실백엔드" : "데모"}
        </span>
        {!live && <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>· 완료</span>}
      </div>
    </div>
  );
}

/** 완료 로그 한 줄 — 시각(거터) · 축 위의 색 점 · 업무명 · 부서.
 *  카드 더미 대신 관제실 처리 대장(ledger)으로 읽힌다. S는 AI 응대 표시가 붙는다. */
function TimelineRow({ r, onOpen }: { r: AdminCallRecord; onOpen: () => void }) {
  const sge = r.sge;
  const meta = sge ? SGE_META[sge] : null;
  return (
    <div
      onClick={onOpen}
      title="클릭하면 상담카드 상세"
      style={css("display:flex;align-items:center;gap:9px;padding:4.5px 6px 4.5px 2px;min-height:24px;border-radius:7px;cursor:pointer;transition:background .15s")}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--gray-100)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
    >
      <span style={css("flex:none;width:40px;text-align:right;font:500 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
        {fmtTime(r.startedAt)}
      </span>
      {/* 축 위의 점 — z-index로 헤어라인 위에 올라앉고, 흰 테두리가 선을 살짝 끊는다 */}
      <span
        style={css(
          "flex:none;position:relative;z-index:1;width:9px;height:9px;border-radius:9999px;border:2px solid var(--onair-surface);box-sizing:content-box;background:" +
            (meta ? meta.bar : "var(--gray-500)")
        )}
      />
      <span style={css("flex:1;min-width:0;font:500 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
        {r.card ? r.card.businessType : "분류 중…"}
      </span>
      {sge === "S" && (
        <span style={css("flex:none;display:inline-flex;align-items:center;gap:3px;font:600 9.5px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900)")}>
          <span className="mi" style={css("font-size:12px")}>smart_toy</span>AI
        </span>
      )}
      {/* 라우팅됐지만 아직 안 끝난 G/E — 부서 대기열에서 대기 중 */}
      {r.endedAt === null && (sge === "G" || sge === "E") && (
        <span style={css("flex:none;font:600 9.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>대기</span>
      )}
      <span style={css("flex:none;font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px")}>
        {r.department ?? r.card?.department ?? ""}
      </span>
    </div>
  );
}
