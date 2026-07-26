import { css } from "../../lib/css";
import type { SheetSignal } from "../../data/demoContent";

/**
 * 사고 방지 표식 — 규정 시트의 내용 칸 앞에 세우는 한 글자짜리 경고.
 * 대기 화면 매뉴얼과 통화 중 규정 패널이 **같은 표식**을 쓴다(둘이 다르면 상담사가
 * 외운 규칙과 눈앞의 화면이 어긋난다).
 *
 * 세 가지를 지킨다:
 * - 리거처 원문("block"/"priority_high")이 본문에 섞이지 않게 — aria-hidden + 선택 불가.
 *   내용 칸은 상담사가 드래그해 CRM에 붙여넣는 텍스트라 영어 단어가 딸려가면 안 된다.
 * - 설명이 마우스에만 매달리지 않게 — 포커스 가능, 키보드로도 툴팁이 열린다.
 * - 선행(앰버)은 --amber-900. 흰 시트 위 대비 6.6:1로, 얼룩처럼 보이던 --amber-700(2.1:1)을
 *   대신한다. 안 보이는 경고는 없는 경고다.
 */
export default function SignalMark({ sig }: { sig: SheetSignal }) {
  const forbid = sig.kind === "금지";
  const label = sig.kind + " · " + sig.text;
  return (
    <span
      className="sigmark"
      role="img"
      tabIndex={0}
      aria-label={label}
      style={css("color:" + (forbid ? "var(--red-700)" : "var(--amber-900)"))}
    >
      <span className="mi" aria-hidden="true" style={css("font-size:14px;vertical-align:-2px")}>
        {forbid ? "block" : "priority_high"}
      </span>
      <span className="sigmark-tip" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
