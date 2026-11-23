import type { ReactNode } from "react";

export function Window({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`window ${className}`}>
      <div className="titlebar">
        <div className="lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="wtitle">{title}</div>
        <div />
      </div>
      <div className="wbody">{children}</div>
    </div>
  );
}
