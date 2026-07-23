import { useEffect, useRef, useState } from "react";
import { demoBus } from "../services";

/**
 * 고객 화면의 실시간 통화 상태 — demoBus 구독 단일 소스.
 * 이 탭에서 건 콜이든, 같은 브라우저 다른 탭(시연 합본)의 콜이든 같은 이벤트로 흘러온다.
 * 실통화 STT·외부 서비스도 같은 Envelope(stt.utterance)만 흘리면 그대로 반영된다.
 *
 * status는 고객의 언어로만 쓴다 — "부서 배정" 같은 내부 파이프라인 용어는
 * 관리자 콘솔의 몫. 여기서는 "듣고 있어요 → 상담사 연결 중"으로 말한다.
 */

export interface LiveLine {
  id: string;
  text: string;
}

export function useLiveCallBus() {
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const offs = [
      demoBus.on("call.incoming", () => {
        seen.current.clear();
        setLines([]);
        setActive(true);
        setStatus("용건을 말씀해 주세요");
      }),
      demoBus.on("stt.utterance", (p) => {
        if (!p.isFinal) return;
        const key = `${p.callId}:${p.atMs}:${p.text}`;
        if (seen.current.has(key)) return;
        seen.current.add(key);
        setActive(true);
        setStatus("용건을 듣고 있어요");
        setLines((prev) => [...prev, { id: key, text: p.text }]);
      }),
      demoBus.on("pipeline.stage", (p) => {
        // 고객에게 의미 있는 전환만 — 내부 단계(위험분석·카드저장)는 말하지 않는다
        if (p.stage === "classify" && p.status === "start")
          setStatus("AI가 용건을 정리하고 있어요");
        if (p.stage === "route" && p.status === "done") setStatus("상담사 연결 중");
        if (p.stage === "rag" && p.status === "start") setStatus("상담사 상담 중");
      }),
      demoBus.on("call.ended", () => {
        setActive(false);
        setStatus("통화가 종료되었습니다");
      }),
      demoBus.on("demo.reset", () => {
        seen.current.clear();
        setLines([]);
        setActive(false);
        setStatus(null);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return { lines, status, active };
}
