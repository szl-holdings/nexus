# nexus_dynamics

The canonical NEXUS simulation engine, Python binding. It is stdlib only, so
IMMUNE Channel B can vendor it unchanged. The TypeScript binding is
`src/lib/nexus/math.ts` + `src/lib/nexus/dynamics.ts`. Both bindings produce
identical hashes for every vector in `contracts/nexus-parity-v2.json`.

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

- `euler4` (`euler4/1`) is bit-for-bit the browser instrument's `analogStep`
  and IMMUNE's port. It is first order and not conservative: harmonic energy
  grows 54.568× in 60 s at ω = 4. For Lorenz it can diverge when dt > 0.04.
- `rk4` (`rk4/1`) is classical Runge-Kutta on the exact vector field. Lotka runs
  without the instrument's 0.02 floor.
- `symplectic` (`strang-verlet/1`) is described in the table above.
- An unsupported pair raises `UNSUPPORTED_METHOD`. A NaN or Infinity result
  raises `NON_FINITE_OUTPUT` and is never serialized.

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

## Tests

```sh
python -m venv .venv && .venv/Scripts/python -m pip install -r python/requirements-dev.txt   # POSIX: .venv/bin/python
cd python && ../.venv/Scripts/python -m pytest -q     # pytest + hypothesis
cd .. && node --test src/lib/nexus/*.test.ts          # includes parity.test.ts (TS == Python)
```
