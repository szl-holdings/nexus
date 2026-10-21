import { useEffect, useRef, useState } from "react";
import { AERO_INTERFACE_PATH, readAeroResearchStatus } from "@/lib/nexus/aero-research";

/** The Python research interface is an optional separately mounted capability. */
export function AeroResearch() {
  const [state, setState] = useState<"disconnected" | "checking" | "available">("disconnected");
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function inspect() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState("checking");
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const status = await readAeroResearchStatus(controller.signal);
      if (request.current === controller && !controller.signal.aborted) {
        setState(status ? "available" : "disconnected");
      } else if (request.current === controller) {
        setState("disconnected");
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <section className="nx-boundaries" aria-labelledby="aero-research-title">
      <div>
        <p className="nx-eyebrow">Optional research reference</p>
        <h2 id="aero-research-title">Aero-FF research</h2>
        <p>A separate Python interface for attributed source claims and fixed diagnostics.</p>
      </div>
      <div className="nx-boundary-content">
        <p role="status">
          {state === "checking"
            ? "Checking the research interface…"
            : state === "available"
              ? "Research interface available. Its source claims remain unverified."
              : "Not connected. No Aero-FF research backend has been established by this page."}
        </p>
        <p>
          This connection does not certify a theorem, physical model, or deployment. Research
          records do not control the instrument. Energy remains UNAVAILABLE; Conjecture 1 remains
          OPEN.
        </p>
        <div className="nx-source-actions">
          <button
            type="button"
            className="nx-btn"
            onClick={() => void inspect()}
            disabled={state === "checking"}
          >
            {state === "checking" ? "Checking…" : "Check research connection"}
          </button>
          {state === "available" ? (
            <a href={AERO_INTERFACE_PATH}>Open Python research interface</a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
