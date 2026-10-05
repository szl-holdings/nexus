# SPDX-License-Identifier: Apache-2.0
"""Classical two-beam software checks, independent of the runtime expansion.

These validate simulated intensity and the existing clamped voltage readout,
not a field inverse, quantum/ENZ hardware, or measured energy.
"""
from __future__ import annotations

import cmath
import math

import pytest

from nexus_dynamics.analog import optical_interfere, optical_reconstruct


AMPLITUDES = [(0.0, 0.0), (0.0, 0.5), (0.7, 0.0), (0.2, 0.8), (1.7, 1.7)]
PHASES = [(0.0, 0.0), (math.pi, 0.0), (math.pi / 2, 0.0), (0.37, -1.2), (-2.4, 2.8)]


@pytest.mark.parametrize(("obj_amp", "ref_amp"), AMPLITUDES)
@pytest.mark.parametrize(("obj_phase", "ref_phase"), PHASES)
def test_intensity_matches_complex_magnitude_squared(obj_amp, ref_amp, obj_phase, ref_phase) -> None:
    field = cmath.rect(obj_amp, obj_phase) + cmath.rect(ref_amp, ref_phase)
    intensity = optical_interfere(obj_amp, obj_phase, ref_amp, ref_phase)
    assert intensity == pytest.approx(abs(field)**2, rel=1e-12, abs=1e-14)


@pytest.mark.parametrize(("obj_phase", "ref_phase"), PHASES)
def test_intensity_is_symmetric_under_beam_exchange(obj_phase, ref_phase) -> None:
    assert optical_interfere(0.2, obj_phase, 0.8, ref_phase) == pytest.approx(
        optical_interfere(0.8, ref_phase, 0.2, obj_phase), rel=1e-12, abs=1e-14,
    )


@pytest.mark.parametrize("shift", [-3.7, 0.4, 2 * math.pi])
@pytest.mark.parametrize(("obj_phase", "ref_phase"), PHASES)
def test_intensity_is_invariant_under_common_phase_shift(obj_phase, ref_phase, shift) -> None:
    assert optical_interfere(0.2, obj_phase + shift, 0.8, ref_phase + shift) == pytest.approx(
        optical_interfere(0.2, obj_phase, 0.8, ref_phase), rel=1e-12, abs=1e-14,
    )


@pytest.mark.parametrize("factor", [0.0, 0.25, 3.0])
@pytest.mark.parametrize(("obj_phase", "ref_phase"), PHASES)
def test_intensity_scales_as_amplitude_squared(obj_phase, ref_phase, factor) -> None:
    assert optical_interfere(factor * 0.2, obj_phase, factor * 0.8, ref_phase) == pytest.approx(
        factor**2 * optical_interfere(0.2, obj_phase, 0.8, ref_phase), rel=1e-12, abs=1e-14,
    )


def test_one_intensity_does_not_identify_object_amplitude() -> None:
    # Even with known r=0.5 and delta=pi, I=(a-r)**2 has two positive solutions.
    intensities = [optical_interfere(a, math.pi, 0.5, 0.0) for a in (0.2, 0.8)]
    assert intensities == pytest.approx([0.09, 0.09], rel=1e-12, abs=1e-14)
    readouts = [optical_reconstruct(intensity, math.pi) for intensity in intensities]
    assert readouts == pytest.approx([-0.045, -0.045], rel=1e-12, abs=1e-14)


@pytest.mark.parametrize(("intensity", "phase", "voltage"), [
    (0.0, 0.0, 0.0), (1.0, 0.0, 0.5), (3.0, 0.0, 1.0),
    (3.0, math.pi, -1.0), (1.0, math.pi / 2, 0.0),
])
def test_reconstruct_remains_a_clamped_voltage_readout(intensity, phase, voltage) -> None:
    assert optical_reconstruct(intensity, phase) == pytest.approx(voltage, rel=1e-12, abs=1e-14)
