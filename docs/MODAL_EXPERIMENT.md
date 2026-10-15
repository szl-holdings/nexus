# Modal geometry reference experiment

This additive Python module provides dimensionless spatial coefficients for an ideal fixed-ended string and a uniform, unloaded Euler–Bernoulli cantilever. It is an original implementation of established formulas for research fixtures. It does not replace the workstation's audio engine or add a runtime endpoint.

## API

Import directly from `nexus_dynamics.modal_geometry`:

- `string_mode_weights(excitation, modes)` returns `sin(n*pi*excitation)` for modes 1 through the requested count (1–64).
- `string_modal_response(excitation, pickup, modes)` returns excitation and pickup coefficient products. It is spatial coupling, not a time-domain response.
- `cantilever_mode_shape(mode, position)` returns one of the first four beam shapes with signed normalization to +1 at the free tip.

Positions are finite real fractions of length in [0, 1]. Boolean positions/counts, invalid types, nonfinite positions and out-of-range inputs are rejected. Counts are integers. String fixed endpoints return exact zeros; interior nodes have ordinary floating-point residuals.

## Why geometry matters

Midpoint point-excitation suppresses the even modes of the ideal fixed-ended string to numerical tolerance. Off-center excitation restores coupling to some of these modes. A pickup at a node can independently suppress an excited mode.

This symmetry does not transfer unchanged to a clamped-free beam. The beam's second mode at the midpoint is approximately -0.7136658320566765 when tip-normalized, so its midpoint is not a node. The reference tests distinguish these geometries rather than assuming one universal odd-mode rule.

The beam formula uses positive roots of `cosh(beta)*cos(beta) = -1`, with the first four stored as binary64 constants. Its shape is

`cosh(beta*x) - cos(beta*x) - sigma*(sinh(beta*x) - sin(beta*x))`

where `sigma = (cosh(beta)+cos(beta))/(sinh(beta)+sin(beta))`.

The result is divided by the signed tip value. Tip normalization is not modal-mass normalization. Limiting the API to four modes also bounds cancellation in this elementary hyperbolic-function representation; it is not an arbitrary-order beam solver. Very near the clamp, subtraction can lose relative accuracy for tiny shape values (including rounding a tiny nonzero value to zero). Validation uses absolute error tolerances; these coefficients are unsuitable as high-relative-precision near-clamp or derivative estimates.

## Validation and next gate

From the repository's `python` directory, use its pytest configuration:

`python -m pytest tests/test_modal_geometry.py`

Then run the complete existing Python test suite and normal hosted checks on the exact candidate head. Focused local tests alone do not qualify a release. Independent expected values, invalid-input tests and geometry-discriminating tests should remain regression requirements.

Before connecting coefficients to synthesis or routing, separately define damping, frequencies, modal masses, force units, normalization, sample rate, energy accounting and a baseline comparison. Require bounded output and integration tests. A routing analogy needs its own queue model and measured evaluation; these mechanical coefficients establish no router advantage.

## Qualification limits

These are idealized simulation coefficients, not measured hardware, a continuum-fluid proof, a turbulence solution, a performance claim or a proof of Lambda uniqueness. Lambda / Conjecture 1 remains OPEN. Energy UNAVAILABLE. CHECKED numerical fixtures are distinct from Lean PROVEN statements and live runtime qualification.

No dependencies, credentials, workflow changes, provider publication or public service endpoints are introduced. GitHub remains source authority. Any eventual canonical Space publication must use the existing central publication workflow and receive separate exact-revision and browser verification.

## References

- University of Texas: [Normal Modes of Uniform String](https://farside.ph.utexas.edu/teaching/315/Waves/node28.html), equation 4.37.
- Georgia Tech: [Beam Bending Example](https://aeresources.gatech.edu/strdyn/Webpage/BeamBending/Examples/BeamBending_p2.php), equations 15–17.
- TU Graz: [Cantilever beam](https://lampz.tugraz.at/~hadley/memm/mechanics/cbeam.php), characteristic equation and clamped-free boundary conditions.

The source is independently written; references identify the mathematics, not imported implementations.
