import { useId, type ReactNode } from "react";

interface ModuleFrameProps {
  title: string;
  serial?: string;
  children: ReactNode;
  className?: string;
}

export function ModuleFrame({
  title,
  serial = "MK-II",
  children,
  className = "",
}: ModuleFrameProps) {
  const titleId = useId();
  return (
    <section
      className={`nx-panel nx-module flex min-h-0 flex-col p-3 sm:p-4 ${className}`}
      aria-labelledby={titleId}
    >
      <span className="nx-screw left-2 top-2" />
      <span className="nx-screw right-2 top-2" />
      <span className="nx-screw bottom-2 left-2" />
      <span className="nx-screw bottom-2 right-2" />
      <header className="mb-3 flex items-baseline justify-between gap-3 px-3">
        <h2 className="nx-label" id={titleId}>
          {title}
        </h2>
        <span className="font-mono text-micro tracking-widest text-muted">{serial}</span>
      </header>
      <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}
