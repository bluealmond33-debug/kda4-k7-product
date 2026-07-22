import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import { demoBus } from "../services";
import TextType from "./TextType";

/**
 * 고객 화면(?role=customer) 오른쪽 — 실시간 통화 현황 + 고객 발화 전사 스트림.
 *
 * 데이터는 전부 demoBus 구독으로만 받는다(관리자 콘솔과 같은 원칙):
 * 이 탭에서 건 콜이든, 같은 브라우저 다른 탭(시연 합본)의 콜이든 같은 경로로 흘러온다.
 * 라이브 마이크·팀원 외부 서비스도 같은 Envelope(stt.utterance)만 흘리면 그대로 표시된다.
 *
 * 발화는 TextType(React Bits)으로 "말이 타이핑되듯" 나온다 — 마지막 줄만 타이핑,
 * 이전 줄은 정적 텍스트로 굳는다(라이브 자막 감각).
 */

interface Line {
  id: string;
  text: string;
}

const IDLE_STATUS = "대기 중 — 통화가 시작되면 발화가 여기로 흐릅니다";

export default function LiveTranscriptPanel() {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState(IDLE_STATUS);
  const [active, setActive] = useState(false);
  const seen = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const offs = [
      demoBus.on("call.incoming", () => {
        seen.current.clear();
        setLines([]);
        setActive(true);
        setStatus("전화 연결 — 용건을 말씀해 주세요");
      }),
      demoBus.on("stt.utterance", (p) => {
        if (!p.isFinal) return;
        const key = `${p.callId}:${p.atMs}:${p.text}`;
        if (seen.current.has(key)) return;
        seen.current.add(key);
        setActive(true);
        setStatus("고객 발화 실시간 전사 중");
        setLines((prev) => [...prev, { id: key, text: p.text }]);
      }),
      demoBus.on("pipeline.stage", (p) => {
        if (p.stage === "classify" && p.status === "start")
          setStatus("AI가 용건을 요약·분류하는 중…");
        if (p.stage === "route" && p.status === "done")
          setStatus("담당 부서 배정 완료 — 상담사 연결 중");
        if (p.stage === "rag" && p.status === "done")
          setStatus("관련 규정 검색 완료 — 상담 진행 중");
      }),
      demoBus.on("card.created", (p) =>
        setStatus(`상담카드 생성 — ${p.department} 배정`)
      ),
      demoBus.on("call.ended", () => {
        setActive(false);
        setStatus("통화 종료 — 상담사가 후처리를 진행합니다");
      }),
      demoBus.on("demo.reset", () => {
        seen.current.clear();
        setLines([]);
        setActive(false);
        setStatus(IDLE_STATUS);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // 새 발화가 붙으면 스트림을 바닥으로 — 라이브 자막은 항상 최신이 보인다
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      style={css(
        "flex:none;width:470px;height:532px;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.4);overflow:hidden"
      )}
    >
      {/* 헤더 — 현재 상황이 한 줄로 (상단 데모 제어를 대신하는 '상황 표시') */}
      <div style={css("padding:16px 20px 13px;border-bottom:1px dashed var(--color-border)")}>
        <div style={css("display:flex;align-items:center;gap:7px")}>
          <span
            style={css(
              "width:8px;height:8px;border-radius:9999px;background:" +
                (active ? "var(--green-700)" : "var(--gray-400)") +
                (active ? ";animation:recBlink 1.1s infinite" : "")
            )}
          />
          <span style={css("font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
            실시간 통화
          </span>
          <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>
            LIVE TRANSCRIPT
          </span>
        </div>
        <div style={css("margin-top:6px;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
          {status}
        </div>
      </div>

      {/* 발화 스트림 — 마지막 줄만 타이핑 애니메이션, 이전 줄은 정적으로 굳는다 */}
      <div ref={scrollRef} style={css("flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px")}>
        {lines.length === 0 ? (
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--gray-500)")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              왼쪽 전화기의 통화 버튼을 누르면
              <br />
              고객의 말이 여기 실시간으로 표시됩니다
            </span>
          </div>
        ) : (
          lines.map((line, i) => {
            const isLast = i === lines.length - 1;
            return (
              <div key={line.id} style={css("display:flex;flex-direction:column;gap:3px;animation:fadeIn .2s ease-out")}>
                <span style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.4px;color:var(--gray-600)")}>
                  고객
                </span>
                <div
                  style={css(
                    "align-self:flex-start;max-width:100%;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:4px 14px 14px 14px;padding:10px 14px;font:400 14px/1.65 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)"
                  )}
                >
                  {isLast ? (
                    <TextType
                      as="span"
                      text={line.text}
                      typingSpeed={34}
                      loop={false}
                      showCursor
                      cursorCharacter="▍"
                      cursorBlinkDuration={0.45}
                    />
                  ) : (
                    line.text
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 푸터 — 데이터 출처를 정직하게 */}
      <div style={css("padding:9px 20px;border-top:1px solid var(--gray-200);display:flex;align-items:center;gap:6px")}>
        <span className="mi" style={css("font-size:13px;color:var(--gray-500)")}>podcasts</span>
        <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>
          시연 탭·이 탭의 통화가 실시간 이벤트(demoBus)로 흘러옵니다 — 실통화 STT 연동 시 같은 경로 사용
        </span>
      </div>
    </div>
  );
}
