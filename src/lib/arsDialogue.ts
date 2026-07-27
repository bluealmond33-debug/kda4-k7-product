import { useEffect, useRef, useState } from "react";
import type { CallFlowVM } from "../hooks/useCallFlow";
import { ARS_BY_PHASE, ARS_HANDOFF_EMERGENCY } from "../data/arsScript";
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

// 안내 음성 단일 소유권 — 이 파일의 접수 큐(연결·확인·인계)와 useCallFlow.playArsAudio(본인인증)
// 가 서로 모른 채 각자 new Audio()를 만들다 보니, 타이밍이 겹치면 두 안내가 동시에 들렸다
// ("가장 최근 것만 나오게 해달라" 피드백). 새 안내가 시작될 때 이전 걸 여기서 멈춘다 —
// 두 재생 경로 모두 이 함수를 거쳐야 한다.
let currentArsAudio: HTMLAudioElement | null = null;
export function takeOverArsAudio(audio: HTMLAudioElement): void {
  if (currentArsAudio && currentArsAudio !== audio) currentArsAudio.pause();
  currentArsAudio = audio;
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
    // prep은 긴급(E) 분류면 전담 상담사 직결 안내로 갈아탄다 — 대기 설명 없이 짧게.
    const lines = phase === "prep" && vm.prepSge === "E" ? ARS_HANDOFF_EMERGENCY : ARS_BY_PHASE[phase];
    if (!lines) return;
    const queue = lines.filter((l) => !playedRef.current.has(l.id));
    if (!queue.length) return;
    queue.forEach((l) => playedRef.current.add(l.id));

    let cancelled = false;
    let timer = 0;
    let audio: HTMLAudioElement | null = null;
    // 재생을 "시작"만 하고 끝(ended/에러 폴백)을 못 본 줄의 인덱스 — cleanup에서 이 지점부터
    // playedRef 표시를 되돌린다(아래 return 참고).
    let reachedIndex = 0;

    const speak = (i: number) => {
      if (cancelled || i >= queue.length) return;
      reachedIndex = i;
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
      takeOverArsAudio(audio); // 다른 안내(본인인증 등)가 재생 중이면 여기서 멈춘다
      audio.play().catch(bySec); // 자동재생 차단도 같은 처리
    };

    speak(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      audio?.pause();
      // React StrictMode(dev)는 이 effect를 mount→cleanup→mount로 두 번 돌린다. playedRef는
      // ref라 두 마운트 사이에 안 비워지므로, 손 안 대면 "재생 시작"만 하고 곧장 끊긴 첫
      // 마운트의 줄이 이미 "말했음"으로 남아 진짜 마운트가 다시 시도하지 않는다(안내 음성이
      // 통째로 안 나오던 원인). 끝까지 못 본 줄만 되돌려 살아남는 마운트가 처음부터 잇는다.
      for (let i = reachedIndex; i < queue.length; i++) {
        playedRef.current.delete(queue[i].id);
      }
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
