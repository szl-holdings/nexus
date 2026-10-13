import { useEffect, useRef, useState } from "react";
import {
  normalizeSourceRevision,
  SOURCE_REPOSITORY,
  UNAVAILABLE,
} from "@/lib/nexus/source-identity";

export type Surface = "dark" | "light";

export function IdentityBar({ surface, onTheme }: { surface: Surface; onTheme: () => void }) {
  return (
    <header className="nx-identity">
      <a
        className="nx-identity-brand"
        href="https://a-11-oy.com/"
        aria-label="SZL Holdings product home"
      >
        <span className="nx-native-mark">
          <img src="/assets/szl/szl-icon-32.svg" width="40" height="40" alt="" />
        </span>
        <span>
          <strong>SZL Holdings</strong>
          <span>Nexus · Instrument MK-II</span>
        </span>
      </a>
      <nav aria-label="Nexus source and appearance">
        <a href="https://github.com/szl-holdings/nexus">Source</a>
        <a href="#nexus-source">Build &amp; boundaries</a>
        <button
          type="button"
          className="nx-btn"
          aria-label={`Switch to ${surface === "dark" ? "light" : "dark"} appearance`}
          onClick={onTheme}
        >
          {surface === "dark" ? "Light" : "Dark"}
        </button>
      </nav>
    </header>
  );
}

const MODULE_NOTES = [
  ["01", "Grid", "Write a pattern. Explore the analog X×Y pen."],
  ["02", "Scope", "Inspect Y–T, X–Y, spectrum, and the hologram."],
  ["03", "Tape", "Shape time with echo, feedback, wow, and flutter."],
  ["04", "Patch", "Connect a source to a destination. Follow the signal."],
  ["05", "Sequence", "Set the rhythm with sixteen steps and Euclidean patterns."],
  ["06", "Voice", "Play, tune, and shape the browser’s synthesized sound."],
] as const;

function InstrumentStudy() {
  return (
    <figure className="nx-study" data-surface="dark">
      <div className="nx-study-caption">
        <span>Signal study / MK-II</span>
        <span>Illustrative</span>
      </div>
      <svg
        viewBox="0 0 480 360"
        role="img"
        aria-label="Illustrative intersecting signal paths, not a measured waveform"
      >
        <defs>
          <linearGradient id="nx-study-foil" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#E9EEF6" />
            <stop offset=".38" stopColor="#5cc4bf" />
            <stop offset=".72" stopColor="#DF735F" />
            <stop offset="1" stopColor="#E9EEF6" />
          </linearGradient>
        </defs>
        <g className="nx-study-grid" fill="none" stroke="#2B3749" strokeWidth="1">
          {[60, 120, 180, 240, 300, 360, 420].map((x) => (
            <path key={x} d={`M${x} 30V330`} />
          ))}
          {[60, 120, 180, 240, 300].map((y) => (
            <path key={y} d={`M30 ${y}H450`} />
          ))}
          <circle cx="240" cy="180" r="132" />
          <circle cx="240" cy="180" r="86" />
        </g>
        <g fill="none" stroke="url(#nx-study-foil)" strokeWidth="1.4">
          {Array.from({ length: 13 }, (_, i) => (
            <ellipse
              key={i}
              cx="240"
              cy="180"
              rx={138 - i * 6}
              ry={24 + i * 7}
              transform={`rotate(${i * 7 - 42} 240 180)`}
            />
          ))}
        </g>
        <path d="M30 180H70M410 180H450M240 30V54M240 306V330" stroke="#9AA7BD" />
        <circle cx="240" cy="180" r="5" fill="#DF735F" />
      </svg>
      <figcaption>
        <strong>Six modules. One signal.</strong>
        <span>Connect · shape · listen</span>
      </figcaption>
    </figure>
  );
}

export function Welcome({
  booting,
  error,
  onEngage,
  onFrontier,
}: {
  booting: boolean;
  error: string;
  onEngage: () => void;
  onFrontier: () => void;
}) {
  return (
    <div className="nx-welcome">
      <section className="nx-welcome-hero" aria-labelledby="nexus-title">
        <div className="nx-welcome-copy">
          <p className="nx-eyebrow">Holographic analog computer</p>
          <h1 id="nexus-title">
            Nexus
            <span>
              Sound, shaped
              <br />
              by systems.
            </span>
          </h1>
          <p className="nx-welcome-lead">
            A playable Web Audio instrument for composing with circuits, patterns, and feedback.
          </p>
          <p className="nx-welcome-detail">
            Explore six programs across voice, tape, grid, and hologram. Sound is synthesized in
            your browser; no model generates it.
          </p>
          <div className="nx-welcome-actions" aria-busy={booting}>
            <button
              type="button"
              onClick={onEngage}
              className="nx-btn nx-primary"
              disabled={booting}
            >
              {booting ? "Starting audio…" : "Open instrument"}
            </button>
            <button type="button" onClick={onFrontier} className="nx-btn" disabled={booting}>
              Launch Frontier
            </button>
          </div>
          <p className="nx-welcome-note">
            Audio starts when you engage. Esc stops sound. MIDI connection is optional.
          </p>
          {error ? (
            <p className="nx-notice" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <InstrumentStudy />
      </section>
      <section className="nx-module-guide" aria-label="Explore the six instrument modules">
        {MODULE_NOTES.map(([number, title, text]) => (
          <article key={number}>
            <span className="nx-module-number">{number}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

type SourceState = { state: "idle" | "loading" | "unavailable" | "declared"; revision?: string };

export function NexusBoundaries() {
  const [source, setSource] = useState<SourceState>({ state: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function inspectSource() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 5000);
    setSource({ state: "loading" });
    try {
      const response = await fetch("/api/build-info", {
        signal: request.signal,
        redirect: "error",
        headers: { accept: "application/json" },
      });
      if (!response.ok || !response.body) throw new Error("unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 64 * 1024) throw new Error("oversize");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid");
      const row = data as Record<string, unknown>;
      const revision = normalizeSourceRevision(row.source_revision);
      if (
        row.schema !== "szl.nexus-source-binding/v2" ||
        row.source_repository !== SOURCE_REPOSITORY ||
        row.runtime !== "NITRO_NODE_WEB_AUDIO" ||
        row.source_bound !== true ||
        revision === UNAVAILABLE
      )
        throw new Error("unbound");
      if (!request.signal.aborted) setSource({ state: "declared", revision });
    } catch {
      if (controller.current === request) setSource({ state: "unavailable" });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <footer className="nx-boundaries" id="nexus-source">
      <div>
        <p className="nx-eyebrow">Instrument, source &amp; research</p>
        <h2>
          A visible boundary
          <br />
          around every claim.
        </h2>
        <p>
          Grok-origin instrument · canonical source edition. The playable workstation and the
          deterministic Python reference have distinct execution roles.
        </p>
      </div>
      <div className="nx-boundary-content">
        <div className="nx-boundary-facts">
          <span>Browser-local audio</span>
          <span>Energy UNAVAILABLE</span>
          <span>Conjecture 1 OPEN</span>
        </div>
        <p>
          Λ is advisory. CHECKED, Lean PROVEN, provider availability, and measured runtime evidence
          are separate states. The instrument’s local organ and probe indicators do not establish a
          proof-site admission.
        </p>
        <details
          onToggle={(e) => {
            if (e.currentTarget.open && source.state === "idle") void inspectSource();
          }}
        >
          <summary>Inspect declared build source</summary>
          <div className="nx-source-detail">
            <p aria-live="polite">
              {source.state === "loading"
                ? "Reading this runtime’s source declaration…"
                : source.state === "declared"
                  ? "Declared GitHub revision"
                  : source.state === "unavailable"
                    ? "Source declaration UNAVAILABLE. This page does not infer an accepted or published revision."
                    : "Open to read this runtime’s source declaration."}
            </p>
            {source.state === "declared" ? (
              <a
                className="nx-source-revision"
                href={`https://github.com/szl-holdings/nexus/commit/${source.revision}`}
              >
                {source.revision}
              </a>
            ) : null}
            <p>
              This is a declaration returned by this runtime. It does not independently verify
              signatures, central publication, provider readback, or live readiness.
            </p>
            <div className="nx-source-actions">
              <a href="/api/build-info">Raw source declaration</a>
              <button
                type="button"
                className="nx-btn"
                disabled={source.state === "loading"}
                onClick={() => void inspectSource()}
              >
                Read again
              </button>
            </div>
          </div>
        </details>
        <div className="nx-boundary-links">
          <a href="https://github.com/szl-holdings/nexus">Code &amp; technical guide</a>
          <a href="https://a11oy.net/">Proof &amp; evaluation</a>
          <a href="/assets/szl/PROJECTION.json">Native asset provenance</a>
        </div>
      </div>
    </footer>
  );
}
