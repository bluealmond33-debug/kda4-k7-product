import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import {
  uploadRegulationPdf,
  type RegulationUploadResult,
} from "../../services";

// 부서 코드 → 한글 라벨 (backend/app/routing/taxonomy.py와 동일 축)
const DEPT_LABEL: Record<string, string> = {
  DEP: "수신·예적금",
  LON: "여신·대출",
  CRD: "카드·결제",
  FX: "외환·수출입",
  EFN: "전자금융·디지털",
  INV: "연금·신탁·투자",
  SG: "사고·신고",
  ETC: "제도·민원·기타",
};

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; filename: string }
  | { kind: "done"; result: RegulationUploadResult }
  | { kind: "error"; message: string };

const STEPS = [
  "PDF 업로드 · 스캔본이면 OCR",
  "구조 기준 청킹 — 조항 분리 · 표는 별도",
  "부서·업무코드 자동 추천 (키워드 규칙)",
  "bge-m3 임베딩 (1024차원 · 로컬)",
  "pgvector 적재 — 즉시 검색 반영",
];

/**
 * 규정 PDF 자동 적재 모달 — 업로드 한 번으로 청킹→추천→임베딩→적재→검색 반영.
 * hippo RAG 설계 8장 (A) '백엔드 업로드 화면'의 구현. 처리는 서버(auto_ingest)가 하고,
 * 여기는 드롭존·진행 안내·결과(추천 근거·청크 수·개정 처리)를 보여준다.
 */
export default function RegulationUploadModal({
  onClose,
  onLoaded,
}: {
  onClose: () => void;
  onLoaded: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = phase.kind === "busy";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = (file: File | undefined | null) => {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPhase({ kind: "error", message: "PDF 파일만 업로드할 수 있습니다" });
      return;
    }
    setPhase({ kind: "busy", filename: file.name });
    uploadRegulationPdf(file)
      .then((result) => {
        setPhase({ kind: "done", result });
        onLoaded(); // 통계·가용성 즉시 재조회
      })
      .catch((err: unknown) => {
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "업로드에 실패했습니다",
        });
      });
  };

  return (
    <>
      <div
        onClick={busy ? undefined : onClose}
        style={css("position:fixed;inset:0;z-index:900;background:rgba(22,20,17,.45);animation:fadeIn .25s ease-out" + (busy ? "" : ";cursor:pointer"))}
      />
      <div style={css("position:fixed;left:50%;top:50%;z-index:901;transform:translate(-50%,-50%);width:560px;max-width:94vw;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);animation:modalIn .3s var(--ease-out);overflow:hidden")}>
        {/* 헤더 */}
        <div style={css("display:flex;align-items:center;gap:9px;padding:16px 20px 12px")}>
          <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>upload_file</span>
          <span style={css("font:700 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>규정 PDF 자동 적재</span>
          <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 업로드 즉시 검색에 반영</span>
          <div style={css("flex:1")} />
          {!busy && (
            <span onClick={onClose} style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
              <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
            </span>
          )}
        </div>

        <div style={css("padding:2px 20px 20px")}>
          {phase.kind === "idle" && (
            <>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  submit(e.dataTransfer.files?.[0]);
                }}
                style={css(
                  "display:flex;flex-direction:column;align-items:center;gap:9px;border:1.5px dashed " +
                    (dragOver ? "var(--blue-700)" : "var(--gray-500)") +
                    ";border-radius:14px;padding:34px 20px;cursor:pointer;transition:background .2s,border-color .2s;background:" +
                    "var(--background-200)"
                )}
              >
                <span className="mi" style={css("font-size:34px;color:" + (dragOver ? "var(--blue-700)" : "var(--gray-600)"))}>picture_as_pdf</span>
                <span style={css("font:600 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                  PDF를 끌어다 놓거나 클릭해서 선택
                </span>
                <span style={css("font:400 11.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);text-align:center")}>
                  업로드 한 번으로 청킹 → 부서 추천 → 임베딩 → 적재까지 자동으로 끝납니다.
                  <br />
                  같은 파일명 재업로드는 갱신, 대장의 문서면 개정본 처리(옛 버전 보관).
                </span>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                hidden
                onChange={(e) => {
                  submit(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </>
          )}

          {phase.kind === "busy" && (
            <div style={css("display:flex;flex-direction:column;gap:12px;padding:6px 2px")}>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span className="mi" style={css("font-size:18px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
                <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{phase.filename}</span>
                <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>처리 중 — 문서 크기에 따라 수십 초</span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:6px;background:var(--background-200);border-radius:10px;padding:12px 14px")}>
                {STEPS.map((s, i) => (
                  <div key={i} style={css("display:flex;gap:8px;align-items:baseline")}>
                    <span style={css("font:700 10.5px 'Geist Mono',monospace;color:var(--blue-900);flex:none")}>{i + 1}</span>
                    <span style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {phase.kind === "done" && (
            <DoneView result={phase.result} onMore={() => setPhase({ kind: "idle" })} onClose={onClose} />
          )}

          {phase.kind === "error" && (
            <div style={css("display:flex;flex-direction:column;gap:12px;padding:6px 2px")}>
              <div style={css("display:flex;gap:9px;align-items:flex-start;background:var(--background-200);border-radius:10px;padding:12px 14px")}>
                <span className="mi" style={css("flex:none;font-size:17px;color:var(--red-900);margin-top:1px")}>error</span>
                <span style={css("font:400 12.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>{phase.message}</span>
              </div>
              <div style={css("display:flex;gap:8px;justify-content:flex-end")}>
                <span onClick={() => setPhase({ kind: "idle" })} style={css("display:inline-flex;align-items:center;gap:5px;border-radius:9999px;padding:8px 15px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--blue-700);color:#fff;cursor:pointer")}>
                  <span className="mi" style={css("font-size:15px")}>refresh</span>다시 시도
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function DoneView({
  result,
  onMore,
  onClose,
}: {
  result: RegulationUploadResult;
  onMore: () => void;
  onClose: () => void;
}) {
  const dept = DEPT_LABEL[result.suggestion.department] ?? result.suggestion.department;
  return (
    <div style={css("display:flex;flex-direction:column;gap:12px;padding:2px")}>
      <div style={css("display:flex;align-items:center;gap:9px")}>
        <span style={css("width:30px;height:30px;border-radius:9999px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex:none")}>
          <span className="mi" style={css("font-size:18px;color:var(--green-900)")}>check</span>
        </span>
        <div>
          <div style={css("font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
            {result.title}
            {result.is_scanned && (
              <span style={css("margin-left:7px;font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900)")}>스캔본 · OCR</span>
            )}
          </div>
          <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:2px")}>
            청크 {result.chunks_loaded}개 적재 (본문 {result.n_text} · 표 {result.n_table})
            {result.revision_of && <> · 개정본 — 이전 버전({result.revision_of})은 보관 처리</>}
          </div>
        </div>
      </div>

      {/* AI 추천 분류 — 근거 키워드까지. 라우팅·검색 필터가 이 부서 태그를 그대로 쓴다 */}
      <div style={css("background:var(--background-200);border-radius:10px;padding:11px 14px")}>
        <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap")}>
          <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>자동 분류</span>
          <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--gray-100);border-radius:9999px;padding:3px 10px")}>
            {dept} · {result.suggestion.business_code}
          </span>
          <span style={css("font:600 10.5px 'Geist Mono',monospace;color:var(--blue-900)")}>
            확신 {Math.round(result.suggestion.confidence * 100)}%
          </span>
        </div>
        {result.suggestion.why.length > 0 && (
          <div style={css("margin-top:7px;display:flex;align-items:center;gap:5px;flex-wrap:wrap")}>
            <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>근거</span>
            {result.suggestion.why.slice(0, 6).map((w) => (
              <span key={w} style={css("font:500 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border-radius:9999px;padding:2px 8px")}>{w}</span>
            ))}
          </div>
        )}
      </div>

      <div style={css("display:flex;gap:9px;align-items:center;background:var(--background-200);border-radius:10px;padding:10px 13px")}>
        <span className="mi" style={css("flex:none;font-size:16px;color:var(--green-900)")}>manage_search</span>
        <span style={css("font:400 11.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>
          지금부터 검색에 반영됩니다 — 상담사 규정검색과 카드 라우팅의 부서 필터가 이 문서를 바로 참조합니다.
        </span>
      </div>

      <div style={css("display:flex;gap:8px;justify-content:flex-end")}>
        <span onClick={onMore} style={css("display:inline-flex;align-items:center;gap:5px;border:1px solid var(--color-border);border-radius:9999px;padding:8px 15px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}>
          <span className="mi" style={css("font-size:15px")}>add</span>다른 PDF 업로드
        </span>
        <span onClick={onClose} style={css("display:inline-flex;align-items:center;border-radius:9999px;padding:8px 17px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-1000);color:#fff;cursor:pointer")}>
          완료
        </span>
      </div>
    </div>
  );
}
