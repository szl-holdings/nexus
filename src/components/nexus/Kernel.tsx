import { LOCKED_EIGHT, LOCKED_NOTE, ORGAN_NODES, type LockedId } from "@/lib/nexus/formulas";
import { engine, useEngine } from "@/lib/nexus/use-engine";
import { ModuleFrame } from "./ModuleFrame";

export function KernelRail() {
  const snap = useEngine();
  const k = snap.kernel;
  const last = k.receipts.at(-1);

  return (
    <div className="nx-panel overflow-hidden px-3 py-2 sm:px-4">
      <span className="nx-screw left-2 top-2" />
      <span className="nx-screw right-2 top-2" />
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="nx-label">Yuyay · 13 axes</p>
            <p className="hidden font-mono text-micro tabular-nums text-muted sm:block">
              Σw=1 · F19 VCA · energy {k.energy}
            </p>
          </div>
          <div className="nx-yuyay">
            {k.axes.map((a) => (
              <button
                key={a.name}
                type="button"
                title={`${a.name} ${a.score.toFixed(3)} · w=${a.weight}`}
                className="flex h-5 flex-col justify-end rounded-sm border border-hairline bg-panel-hi"
              >
                <span
                  className={`block w-full rounded-sm ${a.score === 0 ? "bg-record" : "bg-phosphor"}`}
                  style={{ height: `${Math.max(12, a.score * 100)}%`, opacity: 0.35 + a.score * 0.65 }}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 rounded-sm border border-hairline bg-panel-hi px-3 py-1.5">
          <div>
            <p className="nx-label">Λ</p>
            <p className="font-display text-xl tabular-nums tracking-tight text-amber leading-none">
              {k.lambda.toFixed(4)}
            </p>
            <p className="font-mono text-micro text-amber-dim">CONJECTURE 1 · OPEN</p>
          </div>
          <div className="flex flex-col gap-1">
            <span className={`nx-led ${k.boundHolds ? "nx-led-amber" : "nx-led-rec"}`} title="min ≤ Λ ≤ max is SEMANTIC-VERIFIED; uniqueness is not" />
            <span className={`nx-led ${k.failClosed ? "nx-led-rec" : "nx-led-on"}`} title={k.failClosed ? "F12 latched" : "F12 clear"} />
            <span className={`nx-led ${k.replayOk ? "nx-led-on" : "nx-led-rec"}`} title="receipt chain" />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1 overflow-x-auto">
            {LOCKED_EIGHT.map((id) => (
              <Crystal key={id} id={id} live={k.lockedLive[id]} closed={id === "F12" && k.failClosed} />
            ))}
            <button
              type="button"
              className={`nx-btn min-h-9 shrink-0 px-3 ${k.puriqRunning ? "nx-btn-on" : ""}`}
              onClick={() => engine.runPuriq()}
            >
              Puriq
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {ORGAN_NODES.map((o) => (
              <span key={o} className="flex items-center gap-1">
                <span className={`nx-led ${k.organs[o] ? (o === "IMMUNE" ? "nx-led-on" : "nx-led-amber") : ""}`} />
                <span className="nx-label">{o}</span>
              </span>
            ))}
            <span className="ml-auto truncate font-mono text-micro tabular-nums text-phosphor-dim">
              {last ? last.hash.slice(0, 12) : "genesis"} · {k.signer}
              {k.haltReason ? ` · ${k.haltReason}` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Crystal({ id, live, closed }: { id: LockedId; live: boolean; closed: boolean }) {
  const meta = LOCKED_NOTE[id];
  return (
    <button
      type="button"
      title={`${id} ${meta.name} — ${meta.analog}`}
      className={`nx-btn min-h-9 min-w-11 shrink-0 px-2 ${closed ? "nx-btn-rec-on" : live ? "nx-btn-on" : ""}`}
      onClick={() => engine.injectLocked(id)}
    >
      {id}
    </button>
  );
}

export function Kernel() {
  const snap = useEngine();
  const k = snap.kernel;
  return (
    <ModuleFrame title="Formula kernel" serial="Λ-21">
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {LOCKED_EIGHT.map((id) => (
            <Crystal key={id} id={id} live={k.lockedLive[id]} closed={id === "F12" && k.failClosed} />
          ))}
          <button type="button" className="nx-btn min-h-9 px-3" onClick={() => engine.runPuriq()}>
            Puriq
          </button>
        </div>
        <p className="font-mono text-micro text-muted">
          Locked-8 crystals inject analog voltages. CHECKED ≠ Lean proof. Λ uniqueness stays amber. Energy {k.energy}.
        </p>
        <p className="font-mono text-micro tabular-nums text-phosphor-dim">
          leak {k.yarqaLeak.toFixed(2)} · tax {k.loopTax.toFixed(2)} · cycle {k.loopCycle}
          {k.withinBudget ? "" : " · budgetExhausted"} · {k.signer}
        </p>
        <ol className="grid grid-cols-1 gap-1 font-mono text-micro text-fg sm:grid-cols-2">
          {k.receipts.length === 0 ? (
            <li className="text-muted">No receipts yet — Run or PURIQ to knot the chain.</li>
          ) : (
            k.receipts
              .slice()
              .reverse()
              .map((r) => (
                <li key={`${r.index}-${r.hash}`} className="truncate rounded-sm border border-hairline bg-panel-hi px-2 py-1">
                  {String(r.index).padStart(2, "0")} {r.formula} {r.hash.slice(0, 16)}
                </li>
              ))
          )}
        </ol>
      </div>
    </ModuleFrame>
  );
}
