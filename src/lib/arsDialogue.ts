import { useEffect, useRef, useState } from "react";
import type { CallFlowVM } from "../hooks/useCallFlow";
import { ARS_BY_PHASE } from "../data/arsScript";
import type { StreamItem } from "../components/LiveTranscriptPanel";

/**
 * 통화 대화 스트림 — AI(KARI-NA) 안내와 실제 전사를 **한 줄기로** 합친다.
 *
 * 이 스트림이 그려지는 곳은 오른쪽 전사 패널(파동 아래)뿐이다. 실제 통화 중 휴대폰 화면에는
 * 대화 내용이 뜨지 않으므로(전화 중에 대화창이 올라오는 일은 없다) 폰은 통화 시간·상대
 * 이름·컨트롤만 보여주고, 말을 읽는 건 상담사 쪽 일이다.
 *
 * 끊는 단위는 **발화**다. 5초 같은 고정 간격으로 자르면 문장이 중간에서 끊겨 읽기 어렵고,
 * 백엔드(faster-whisper)가 침묵으로 발화를 확정해 보내주므로 그 경계를 그대로 쓰면 된다.
 *
 * 순서 보존 방식: AI 안내는 "그때까지 쌓인 발화 개수"를 같이 기록해 두고, 렌더할 때 그
 * 자리에 끼워 넣는다. 발화 배열을 스냅샷으로 복사하지 않기 때문에 진행 중인 발화의 글자가
 * 자라나는 것(타자기)도 그대로 살아 있다.
 */

type SaidLine = { id: string; text: string; afterCount: number };

/**
 * 안내 한 줄의 음성 파일 주소.
 *
 * 규칙: `public/demo/ars/<id>.mp3` — **대본의 id가 곧 파일명**이라 파일만 넣으면 잡힌다
 * (코드를 고칠 필요가 없다). 다른 이름을 쓰려면 대본에 audio를 적어 덮어쓴다.
 * 파일이 없으면 재생이 error로 떨어지고 그 줄은 대본의 sec만큼 머물다 넘어간다.
 */
function audioUrl(line: { id: string; audio?: string }) {
  return "/demo/" + (line.audio ?? `ars/${line.id}.mp3`);
}

/**
 * @param spoken 실제 전사에서 만든 스트림(고객·상담원). 호출부가 실통화/demoBus 중
 *   정본을 골라 넘긴다.
 * @param playAudio 안내 음성을 이 화면에서 재생할지. 창이 여러 개 열려 있을 때 한 곳만
 *   켜야 같은 안내가 겹쳐 들리지 않는다.
 */
export function useConversationStream(
  vm: CallFlowVM,
  spoken: StreamItem[],
  playAudio = false
): StreamItem[] {
  const [said, setSaid] = useState<SaidLine[]>([]);
  const playedRef = useRef<Set<string>>(new Set());
  // 타이머 콜백이 항상 '지금'의 발화 개수를 보도록 ref로 들고 있는다
  const countRef = useRef(0);
  countRef.current = spoken.length;

  const idle = vm.phIdle;
  const phase = vm.phase;

  // 새 통화가 시작되면(대기 화면으로 돌아오면) 안내 이력을 비운다
  useEffect(() => {
    if (idle) {
      playedRef.current.clear();
      setSaid([]);
    }
  }, [idle]);

  // phase가 바뀌면 그 단계의 안내를 줄 단위로 순서대로 띄운다(줄 길이 sec만큼 간격).
  // 같은 통화에서 같은 줄을 두 번 말하지 않는다.
  //
  // 진행을 무엇이 이끄는가 — **녹음이 있으면 녹음이, 없으면 대본의 sec이 이끈다.**
  // 예전엔 모든 줄을 sec 누적으로 미리 예약했다. 그러면 mp3를 넣을 때마다 실제 길이에 맞춰
  // sec을 손으로 고쳐야 하고, 안 고치면 말풍선과 목소리가 어긋난다. 지금은 한 줄을 띄우고
  // 그 줄의 재생이 끝나면(ended) 다음 줄로 넘어가므로, **파일만 넣으면 알아서 맞는다.**
  // 파일이 없거나(error) 자동재생이 막히면 그 줄만 sec으로 넘어간다 — 화면은 끊기지 않는다.
  useEffect(() => {
    if (idle) return;
    const lines = ARS_BY_PHASE[phase];
    if (!lines) return;
    const queue = lines.filter((l) => !playedRef.current.has(l.id));
    if (!queue.length) return;
    queue.forEach((l) => playedRef.current.add(l.id));

    let cancelled = false;
    let timer = 0;
    let audio: HTMLAudioElement | null = null;

    const speak = (i: number) => {
      if (cancelled || i >= queue.length) return;
      const line = queue[i];
      // 말풍선을 먼저 띄우고 그 다음 소리를 낸다 — 글과 목소리가 같은 순간에 시작한다
      setSaid((prev) => [...prev, { id: line.id, text: line.text, afterCount: countRef.current }]);

      let advanced = false;
      const next = () => {
        if (advanced || cancelled) return;
        advanced = true;
        speak(i + 1);
      };
      const bySec = () => {
        timer = window.setTimeout(next, Math.max(0.6, line.sec) * 1000);
      };

      if (!playAudio) {
        bySec();
        return;
      }
      audio = new Audio(audioUrl(line));
      audio.addEventListener("ended", next);
      // 파일 없음·디코드 실패 → 그 줄만 대본 길이로 넘긴다(다음 줄엔 소리가 있을 수 있다)
      audio.addEventListener("error", bySec);
      audio.play().catch(bySec); // 자동재생 차단도 같은 처리
    };

    speak(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      audio?.pause();
    };
  }, [idle, phase, playAudio]);

  if (!said.length) return spoken;

  const out: StreamItem[] = [];
  let ai = 0;
  for (let i = 0; i <= spoken.length; i++) {
    while (ai < said.length && said[ai].afterCount <= i) {
      out.push({ id: "ars-" + said[ai].id, text: said[ai].text, who: "ai" });
      ai++;
    }
    if (i < spoken.length) out.push(spoken[i]);
  }
  // 발화가 줄어든 경우(리셋 직후 등) 남은 안내는 뒤에 붙인다 — 사라지지 않게
  for (; ai < said.length; ai++) {
    out.push({ id: "ars-" + said[ai].id, text: said[ai].text, who: "ai" });
  }
  return out;
}
