import type { ReactNode } from "react";
import { css } from "../../lib/css";

/**
 * The desktop "app window" canvas. Content is authored at 1440×900 (16:10,
 * 일반 노트북 비율) and scaled to fit the 1100×688 slot next to the phone.
 */
export default function DesktopShell({
  flex = false,
  overlay = false,
  children,
}: {
  flex?: boolean;
  /** true면 앞 화면 위에 겹치는 투명 레이어 — 배경·그림자 없이 같은 1440×900 좌표계만 제공 */
  overlay?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={css(
        "width:1100px;height:688px;overflow:hidden" +
          (overlay ? ";position:absolute;top:0;left:0;pointer-events:none;border-radius:12px" : ";position:relative")
      )}
    >
      <div style={css("position:absolute;top:0;left:0;transform:scale(0.76389);transform-origin:top left")}>
        <div
          style={css(
            "width:1440px;height:900px;position:relative" +
              (overlay
                ? ""
                : ";background:var(--onair-bg);border:none;border-radius:12px;overflow:hidden;box-shadow:var(--sh-near)") +
              (flex ? ";display:flex;flex-direction:column" : "")
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
