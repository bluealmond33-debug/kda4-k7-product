import type { ReactNode } from "react";
import { css } from "../../lib/css";

/**
 * The desktop "app window" canvas. Content is authored at 1440×940 and scaled
 * to fit the 1040×679 slot next to the phone (matches the original mockup).
 */
export default function DesktopShell({
  flex = false,
  children,
}: {
  flex?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={css("width:1040px;height:679px;position:relative;overflow:hidden")}>
      <div style={css("position:absolute;top:0;left:0;transform:scale(0.72222);transform-origin:top left")}>
        <div
          style={css(
            "width:1440px;height:940px;position:relative;background:var(--onair-bg);border:none;border-radius:20px;overflow:hidden;box-shadow:var(--sh-near)" +
              (flex ? ";display:flex;flex-direction:column" : "")
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
