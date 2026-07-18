import type { ReactNode } from "react";
import { css } from "../../lib/css";

/**
 * The desktop "app window" canvas. Content is authored at 1440×900 (16:10,
 * 일반 노트북 비율) and scaled to fit the 1100×688 slot next to the phone.
 */
export default function DesktopShell({
  flex = false,
  children,
}: {
  flex?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={css("width:1100px;height:688px;position:relative;overflow:hidden")}>
      <div style={css("position:absolute;top:0;left:0;transform:scale(0.76389);transform-origin:top left")}>
        <div
          style={css(
            "width:1440px;height:900px;position:relative;background:var(--onair-bg);border:none;border-radius:20px;overflow:hidden;box-shadow:var(--sh-near)" +
              (flex ? ";display:flex;flex-direction:column" : "")
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
