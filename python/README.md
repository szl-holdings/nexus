# nexus_dynamics

The canonical NEXUS simulation engine, Python binding. It is stdlib only, so
IMMUNE Channel B can vendor it unchanged. The TypeScript binding is
`src/lib/nexus/math.ts` + `src/lib/nexus/dynamics.ts`. Both bindings produce
identical hashes for every vector in `contracts/nexus-parity-v2.json`.

That is a tested-vector guarantee, not universal cross-platform hash identity.
Python's platform math library and JavaScript engines can round `sin`, `cos`,
`exp`, `log`, `atan2` and `hypot` differently. A last-bit difference can cross
the nine-decimal canonical rounding boundary or amplify along a chaotic
trajectory. Keep the engine, source revision and runtime environment with
reproduction evidence; use the same qualified implementation to verify an
arbitrary run. Do not admit a different hash as equivalent or regenerate the
published vectors to conceal a mismatch. The per-input probe below checks
exact hashes on the current local Python/Node pair.

This is executable software simulation. It is not a physical analog or
neuromorphic chip. Energy is UNAVAILABLE. Λ uniqueness is Conjecture 1 (OPEN).

## Programs and methods

Each method advances one tick of `dt` (clamped to 0.0004..0.08) in 4 substeps
of `h = dt / 4`.

| Program | Model | euler4 | rk4 | symplectic |
|---|---|---|---|---|
| lorenz | `lorenz/1` | yes | yes | no |
| harmonic | `harmonic/1` | yes | yes | velocity Verlet |
| vanderpol | `vanderpol/1` | yes | yes | no |
| duffing | `duffing/1` | yes | yes | Strang split: Verlet on the double well plus the exact damped/forced flow |
| lotka | `lotka/2` (F-05) | yes | yes | no |
| nemo | `nemo/1` | instrument scheme only | no | no |

- `euler4` (`euler4/1`) follows the browser instrument's `analogStep`
  arithmetic order and IMMUNE's port, with parity checked on the published
  vectors. It is first order and not conservative: harmonic energy
  grows 54.568× in 60 s at ω = 4. For Lorenz it can diverge when dt > 0.04.
- `rk4` (`rk4/1`) is classical Runge-Kutta on the exact vector field. Lotka runs
  without the instrument's 0.02 floor.
- `symplectic` (`strang-verlet/1`) is described in the table above.
- An unsupported pair raises `UNSUPPORTED_METHOD`. A NaN or Infinity result
  raises `NON_FINITE_OUTPUT` and is never serialized.
- `step()` rejects a malformed state with `INVALID_STATE`: a value that is not
  a `NexusState`, a coordinate or bank cell that is not a number (a bool
  included), or a bank that is not a tuple or list. The bank check runs on
  every program; a finite numeric bank on a non-NEMO state is still ignored. A
  NaN or infinite state value raises `NON_FINITE_NUMBER`, and so does an int
  too large for a float, there and at the contract boundary (`JSON.parse` gives
  Infinity for it, which `dynamics.ts` and `math.ts` reject the same way).
- `clamp01` is `Math.min(1, Math.max(0, c))` as in `math.ts`, so a NaN chaos
  stays NaN in `coefficients()` and `advance()` fails closed on it with
  `NON_FINITE_OUTPUT`. Finite results are unchanged.
- `step()` converts validated integer coordinates to binary64 before
  arithmetic. Overflow inside trigonometry produces NaN as in JavaScript,
  allowing the existing `NON_FINITE_OUTPUT` checks and optical fallbacks to
  run. Finite trigonometric results still use the platform math library.
- Direct malformed-state APIs differ: Python `step()` raises `INVALID_STATE`
  for a non-`NexusState`, non-number coordinate or bank cell, or a bank that
  is not a tuple or list, on every program. TypeScript `analogIntegrate`
  raises `NON_FINITE_NUMBER` for a non-number coordinate, checks NEMO bank
  shape before its cells, ignores banks on other programs, and throws
  `TypeError` for a null state. A missing NEMO bank is seeded on both sides.
  Use `NexusRunInput.from_dict` / `normalizeDynamicsInput` for the JSON
  contract boundary.
- A directly constructed `NexusRunInput` revalidates but does not normalize
  stored values. An integer such as `2**53 + 1` is rejected with
  `INVALID_REQUEST`; `from_dict` stores its rounded binary64 value instead.

## API

```python
from nexus_dynamics import NexusRunInput, step, seed, coefficients
from nexus_dynamics.run import run

s = step("duffing", seed("duffing", 0.3), dt=0.02, chaos=0.69, drive=0.8, method="symplectic")
result = run(NexusRunInput.from_dict({
    "program": "lotka", "mode": "OP", "steps": 400, "dt": 0.02,
    "chaos": 0.45, "drive": 0.7, "seed": 0.2, "repeatEvery": 64,
}), method="rk4")
result["outputHash"]  # SHA-256 over IMMUNE's nine-decimal canonical projection
```

- `schema.py` defines dataclasses that mirror `contracts/immune-nexus.v1.json`.
  The contract is vendored byte-identical from `szl-holdings/immune`.
- `canonical.py` implements IMMUNE's `nexus_hash`.
- `immune_v1.py` rebuilds IMMUNE's v1 deterministic output. It reproduces all
  six hashes in IMMUNE's `contracts/immune-nexus-parity-v1.json`.

## Parity vectors

```sh
cd python
python -m nexus_dynamics.parity check   # exit 1 if contracts/nexus-parity-v2.json is stale
python -m nexus_dynamics.parity write   # regenerate (only for an intentional, versioned change)
```

## Check an arbitrary input across runtimes

Run the same engine input JSON through both local bindings (Node >=22.6 with
TypeScript stripping is required):

```sh
python experiments/numeric-parity-probe.py --input input.json --contract dynamics-v2 --method rk4
python experiments/numeric-parity-probe.py --input input.json --contract immune-v1
cat input.json | python experiments/numeric-parity-probe.py --input - --contract dynamics-v2
python experiments/numeric-parity-probe.py  # original IMMUNE lambda counterexample candidate
```

The JSON report names the selected contract/method, normalized inputs, exact
output hashes, Python/libc and Node/V8 versions, and SHA-256 digests of the local
engine and probe source files, including uncommitted changes. Different source
snapshots before and after execution fail the check. Exit **0** means
`MATCH_THIS_CASE`: both normalized inputs and output hashes match. Exit **1** means `MISMATCH`. Exit
**2** means `ERROR` (invalid input, unsupported method, missing/failed Node,
timeout, or source change); matching errors are never accepted as parity.
CLI syntax errors also exit 2 and print usage to stderr. `immune-v1` supports
only `euler4`.

Keep this report with the exact input and source checkout when investigating
reproducibility. It is local diagnostic evidence, not a signed receipt, a
universal parity proof, or evidence of deployed IMMUNE's revision. IMMUNE's
separate engine must be qualified separately. A mismatch must remain a failure;
this tool does not relax hash equality or rewrite historical vectors.

## Opt in to one shared execution authority

For Python and Node callers that need the **same result**, the new
`szl.nexus-authoritative-execution/v1` contract delegates both clients to one
explicitly admitted, long-lived Node process. Both clients receive and verify
that process's output. It does not make the existing native
Python/JavaScript engines independently identical.

From the repository root, start the authority in one terminal and keep it
running:

```sh
node --experimental-strip-types src/lib/nexus/authoritative-node.ts serve > authority.json
```

The service binds only `127.0.0.1` on an available port. Once startup succeeds,
`authority.json` contains one JSON record with its endpoint and complete
profile. Save it as UTF-8 without a BOM; Windows PowerShell 5 redirection may
otherwise use UTF-16. Inspect and retain that record as your explicit admission of this
process. The profile contains a fresh process ID, the algorithm contract,
source SHA-256 digests, and Node/V8/platform/architecture/launch metadata.
Startup rejects preload, loader and custom V8 flags. Use Node >=22.6 in a plain
source checkout; no npm packages or provider credentials are needed.

In another terminal, install the stdlib Python client in your chosen Python
environment (`python -m pip install ./python` from the checkout). Save an engine
input as `input.json`, for example:

```json
{"program":"harmonic","mode":"IC","steps":0,"dt":0.01,"chaos":0.5,"drive":0.5,"seed":0.2,"repeatEvery":32,"axes":[0.1622758695]}
```

Then execute against the saved, admitted process:

```sh
python -m nexus_dynamics.authoritative --authority-file authority.json --input input.json --contract immune-v1
python -m nexus_dynamics.authoritative --authority-file authority.json --input input.json --contract dynamics-v2 --method rk4
```

The installed client also works outside the checkout, using absolute paths for
those two JSON files. It needs no Node executable, TS assets, subprocess,
third-party package, or proxy in the client environment. The authority and its
Node client module require the checkout. The CLI emits the verified result on
success (exit 0) or a structured error (exit 2; syntax errors print usage).

The Node client uses that same saved profile and process:

```ts
import { readFileSync } from "node:fs";
import { runAuthoritative } from "./src/lib/nexus/authoritative-node.ts";
const admitted = JSON.parse(readFileSync("authority.json", "utf8"));
const input = JSON.parse(readFileSync("input.json", "utf8"));
const result = await runAuthoritative(admitted.endpoint, admitted.profile, input, "immune-v1");
```

Every run requires the complete expected profile. Clients never rediscover it
implicitly or fall back to native execution. A restart changes the process ID:
old requests fail with `AUTHORITY_MISMATCH` even when source and runtime metadata
look identical. Explicitly inspect and admit the new startup record before
resuming. Stop the authority with Ctrl+C (or SIGTERM); requests then fail closed.
It is not registered as a system service and does not update the Python-only
Hugging Face Space or IMMUNE's separately deployed engine.

Both clients verify the selected legacy `outputHash` using its unchanged
nine-decimal canonical projection. The new `inputHash` and `resultHash` use an
exact binary64 structural encoding, folding signed zero for JSON transport, so
a difference below nine decimal places cannot substitute a different request
or returned value. The complete encoding and scope are specified in
`contracts/nexus-authoritative-execution-v1.json`. Existing outputs, native APIs,
engine/model versions and historical vectors are preserved.

This is delegated software execution, not independent numerical parity, a
portable math kernel, a signature, or remote attestation. Runtime metadata does
not describe the complete dynamic-library or CPU execution environment; no
claim is made for separately provisioned processes or machines. Different
observed source snapshots invalidate the running authority. Clients admit only
explicit loopback endpoints, reject redirects, bound message sizes, and apply a
total transport deadline. The service rejects browser origins. Start the service
through the standalone CLI in a stable checkout; source digests are observed
file snapshots, not attestation of the module loader or an embedding process.
Energy remains UNAVAILABLE and Conjecture 1 remains OPEN.

## Tests

```sh
python -m venv .venv && .venv/Scripts/python -m pip install -r python/requirements-dev.txt   # POSIX: .venv/bin/python
cd python && ../.venv/Scripts/python -m pytest -q     # pytest + hypothesis
cd .. && node --test src/lib/nexus/*.test.ts          # includes parity.test.ts (TS == Python)
```

The convergence tests sample a shared 0.1-second grid, require divisible step
sizes and horizons, and check lengths and timestamps before comparing states.
Every adjacent refinement must have the expected error ratio. Harmonic tests
also compare Euler, velocity Verlet, and RK4 with the analytical solution
`x = x0*cos(omega*tau) + y0/omega*sin(omega*tau)`,
`y = y0*cos(omega*tau) - omega*x0*sin(omega*tau)`, where `tau = t - t0`.
They cover three frequencies and nonzero initial velocities above roundoff.

`tests/test_symplectic_structure.py` checks the structure of the maps. A Verlet
substep of `-h` undoes one of `+h`, a momentum flip returns the start for the
conservative Verlet maps, and the Strang method undoes itself under
`advance(-h)`, while RK4 and Euler do not. Central-difference Jacobians give
`det J = 1` (`J^T Ω J = Ω`) for the Verlet maps and `det J = exp(-delta*h)` for
the damped Duffing substep, which is conformally symplectic rather than
area-preserving. The van der Pol RK4 substep follows Liouville's formula to
local order h^5. SI and CGS descriptions of one spring-mass set-up reduce to
the same engine inputs, and in each unit system the re-dimensionalized
trajectory follows the analytic spring-mass solution within the Verlet
truncation error. The nondimensionalization lives only in that test file; it
is not a unit contract. `test_integrators.py` also rejects non-finite state,
`dt`, `chaos` and `drive` at `step()`, rejects a malformed state with
`INVALID_STATE` (owner decision D1), checks that a NaN chaos stays NaN like the
TypeScript `clamp01` while finite clamps stay bit-identical (owner decision D2),
and pins the instrument's silent dt clamp as today's behaviour (an owner
decision, not a contract). These are software simulation checks;
`physicalHardware=false`, Energy UNAVAILABLE, and Conjecture 1 OPEN remain
unchanged.

The separate optical tests compare forward intensity with the squared magnitude
of the summed complex fields, plus beam symmetry, common-phase invariance, and
amplitude-squared scaling. One intensity cannot identify the object amplitude:
with reference amplitude 0.5 and phase difference pi, amplitudes 0.2 and 0.8
both give intensity 0.09. `optical_reconstruct` remains a clamped signed voltage
readout, not an inverse. These are software simulation checks;
`physicalHardware=false`, Energy UNAVAILABLE, and Conjecture 1 OPEN remain
unchanged. They establish no quantum or ENZ hardware claim.
