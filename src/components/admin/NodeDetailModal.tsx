import { useEffect } from "react";
import { css } from "../../lib/css";
import type { PipelineNodeDef } from "../../data/adminContent";

const STATUS_COLOR: Record<string, string> = {
  실가동: "var(--green-900)",
  "연동 대기": "var(--amber-900)",
  "데모 대체": "var(--gray-700)",
};

/** 파이프라인 노드 상세 — 설명 모드에서 노드 클릭 시.
 *  이 단계가 실제로 어떤 엔진으로 도는지(실가동/연동 대기/데모 대체)를 정직하게 보여준다.
 *  발표 Q&A에서 "이거 진짜예요?"에 답하는 화면. */
export default function NodeDetailModal({
  node,
  onClose,
}: {
  node: PipelineNodeDef;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { spec } = node;
  const row = (label: string, value: string) => (
    <div style={css("display:flex;gap:12px;align-items:flex-start")}>
      <span style={css("flex:none;width:64px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);padding-top:1px")}>{label}</span>
      <span style={css("flex:1;font:400 12.5px/1.6 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{value}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out;cursor:pointer")} />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:520px;max-width:92vw;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 — 노드 아이콘 + 이름 + 가동 상태 */}
        <div style={css("display:flex;align-items:center;gap:10px;padding:16px 20px 12px")}>
          <span style={css("width:34px;height:34px;border-radius:11px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex:none")}>
            <span className="mi" style={css("font-size:19px;color:var(--gray-800)")}>{node.icon}</span>
          </span>
          <span>
            <span style={css("display:block;font:700 14.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.2px")}>{node.label}</span>
            <span style={css("display:block;font:500 10px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--gray-700)")}>{node.tech}</span>
          </span>
          <div style={css("flex:1")} />
          <span style={css("display:inline-flex;align-items:center;gap:5px")}>
            <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + (spec.status === "실가동" ? "var(--green-700)" : spec.status === "연동 대기" ? "var(--amber-700)" : "var(--gray-500)"))} />
            <span style={css("font:700 11.5px 'Avenir Next','Pretendard',sans-serif;color:" + STATUS_COLOR[spec.status])}>{spec.status}</span>
          </span>
          <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
          </span>
        </div>

        <div style={css("padding:2px 20px 18px;display:flex;flex-direction:column;gap:12px")}>
          {/* 엔진·입출력·상태 — 실제 구성 그대로 */}
          <div style={css("display:flex;flex-direction:column;gap:9px;background:var(--background-200);border-radius:12px;padding:13px 15px")}>
            {row("엔진", spec.engine)}
            {row("입출력", spec.io)}
            {row("상태", spec.statusNote)}
          </div>

          {/* 왜 이렇게 연결되는가 */}
          <div style={css("display:flex;flex-direction:column;gap:5px")}>
            {spec.lines.map((t) => (
              <div key={t} style={css("display:flex;gap:8px;align-items:flex-start")}>
                <span style={css("flex:none;width:4px;height:4px;border-radius:9999px;background:var(--gray-600);margin-top:7px")} />
                <span style={css("font:400 12px/1.6 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
              </div>
            ))}
          </div>

          <div style={css("font:400 10px ui-monospace,'SF Mono',Menlo,Consolas,monospace;color:var(--gray-600)")}>
            근거: backend/app · database/rag · hippo 07 Outputs 라우팅/RAG 문서
          </div>
        </div>
      </div>
    </>
  );
}
