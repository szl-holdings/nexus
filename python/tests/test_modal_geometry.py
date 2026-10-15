# SPDX-License-Identifier: Apache-2.0
"""Independent, stdlib-only regression tests for experimental modal geometry.

These are analytical software checks, not measured audio or hardware evidence.
The string oracles use exact cardinal values and trigonometric identities.
The beam oracle independently solves cosh(beta)*cos(beta) + 1 = 0 with
70-digit Decimal arithmetic, then evaluates the public clamped-free formula:
https://lampz.tugraz.at/~hadley/memm/mechanics/cbeam.php

The oracle imports no implementation constants or private helpers. Its sine
and cosine use convergent power series, not the implementation's libm path.
Absolute tolerances accommodate binary64 argument reduction (64 string modes,
5e-14) and hyperbolic cancellation (four beam modes, 2e-11). They do not
encode physical measurement precision. The clamp-slope check has a separate
5e-8 tolerance for finite-difference truncation and roundoff. Free-tip checks
derive their tolerance from a high-precision stencil residual and the stencil
L1 norm's amplification of the stated binary64 shape tolerance.

Both unittest discovery and the repository's existing pytest discovery work.
No new dependency, renderer, upstream executable, or runtime is required.
"""
from __future__ import annotations

from decimal import Decimal, localcontext
from fractions import Fraction
import math
import unittest

from nexus_dynamics.modal_geometry import (
    cantilever_mode_shape,
    string_modal_response,
    string_mode_weights,
)


STRING_ABS_TOL = 5e-14
RESPONSE_ABS_TOL = 1e-13
BEAM_ABS_TOL = 2e-11
BEAM_POSITIONS = (
    "0", "0.0001", "0.125", "0.25", "0.37", "0.49", "0.5", "0.51",
    "0.625", "0.75", "0.875", "0.9999", "1",
)
TIP_STEP = Decimal("0.005")
TIP_POSITIONS = tuple(str(Decimal(1) - k * TIP_STEP) for k in range(7))
# Backward stencils: sum(w[k] * f(1 - k*h)) / h**order. These are exact
# through degree six; curvature has O(h**5), shear O(h**4) truncation.
TIP_STENCILS = {
    2: (
        Fraction(203, 45), Fraction(-87, 5), Fraction(117, 4),
        Fraction(-254, 9), Fraction(33, 2), Fraction(-27, 5), Fraction(137, 180),
    ),
    3: (
        Fraction(49, 8), Fraction(-29), Fraction(461, 8), Fraction(-62),
        Fraction(307, 8), Fraction(-13), Fraction(15, 8),
    ),
}


def _decimal_sin_cos(x: Decimal) -> tuple[Decimal, Decimal]:
    """Power-series oracle for |x| <= 11, evaluated at caller precision."""
    sine_term, cosine_term = x, Decimal(1)
    sine, cosine = sine_term, cosine_term
    for k in range(1, 200):
        sine_term *= -x * x / Decimal((2 * k) * (2 * k + 1))
        cosine_term *= -x * x / Decimal((2 * k - 1) * (2 * k))
        sine += sine_term
        cosine += cosine_term
        if abs(sine_term) < Decimal("1e-65") and abs(cosine_term) < Decimal("1e-65"):
            return sine, cosine
    raise AssertionError("Independent Decimal trigonometric oracle did not converge")


def _decimal_beam_reference(
    positions: tuple[str, ...] = BEAM_POSITIONS,
) -> dict[tuple[int, str], Decimal]:
    """Solve roots independently; evaluate tip-normalized analytical shapes."""
    result = {}
    with localcontext() as context:
        context.prec = 70
        # These seeds choose the first four roots; they are not expected roots.
        for mode, seed in enumerate(("1.8751", "4.6941", "7.8548", "10.9955"), 1):
            beta = Decimal(seed)
            for _ in range(12):
                sine, cosine = _decimal_sin_cos(beta)
                cosh = (beta.exp() + (-beta).exp()) / 2
                sinh = (beta.exp() - (-beta).exp()) / 2
                residual = cosh * cosine + 1
                derivative = sinh * cosine - cosh * sine
                beta -= residual / derivative
            sine, cosine = _decimal_sin_cos(beta)
            cosh = (beta.exp() + (-beta).exp()) / 2
            sinh = (beta.exp() - (-beta).exp()) / 2
            if abs(cosh * cosine + 1) > Decimal("1e-55"):
                raise AssertionError("Independent beam root did not converge")
            sigma = (cosh + cosine) / (sinh + sine)

            def raw(position: Decimal) -> Decimal:
                z = beta * position
                sin_z, cos_z = _decimal_sin_cos(z)
                cosh_z = (z.exp() + (-z).exp()) / 2
                sinh_z = (z.exp() - (-z).exp()) / 2
                return cosh_z - cos_z - sigma * (sinh_z - sin_z)

            tip = raw(Decimal(1))
            for position in positions:
                result[mode, position] = raw(Decimal(position)) / tip
    return result


class StringModeWeightsTests(unittest.TestCase):
    def assert_close(self, actual: float, expected: float) -> None:
        self.assertAlmostEqual(actual, expected, delta=STRING_ABS_TOL)

    def test_returns_float_tuple_at_both_count_limits(self) -> None:
        for modes in (1, 64):
            with self.subTest(modes=modes):
                weights = string_mode_weights(0.37, modes)
                self.assertIsInstance(weights, tuple)
                self.assertEqual(len(weights), modes)
                self.assertTrue(all(isinstance(value, float) for value in weights))

    def test_midpoint_even_null_and_signed_odd_modes(self) -> None:
        weights = string_mode_weights(0.5, 64)
        for mode, actual in enumerate(weights, 1):
            expected = 0.0 if mode % 2 == 0 else float((-1) ** ((mode - 1) // 2))
            with self.subTest(mode=mode):
                self.assert_close(actual, expected)

    def test_off_center_even_modes_recover_on_both_sides(self) -> None:
        left = string_mode_weights(0.49, 64)
        right = string_mode_weights(0.51, 64)
        # All 32 even coefficients recover here, rather than an odd-mode mask.
        for index in range(1, 64, 2):
            with self.subTest(mode=index + 1):
                self.assertGreater(abs(left[index]), 0.05)
                self.assertGreater(abs(right[index]), 0.05)
                self.assert_close(left[index], -right[index])
        self.assert_close(left[1], math.sin(math.pi / 50))
        self.assert_close(right[1], -math.sin(math.pi / 50))

    def test_quarter_point_cardinal_sequence(self) -> None:
        h = math.sqrt(0.5)
        expected_cycle = (h, 1.0, h, 0.0, -h, -1.0, -h, 0.0)
        for mode, actual in enumerate(string_mode_weights(0.25, 64), 1):
            with self.subTest(mode=mode):
                self.assert_close(actual, expected_cycle[(mode - 1) % 8])

    def test_sixth_point_cardinal_sequence(self) -> None:
        h = math.sqrt(3) / 2
        expected_cycle = (0.5, h, 1.0, h, 0.5, 0.0, -0.5, -h, -1.0, -h, -0.5, 0.0)
        for mode, actual in enumerate(string_mode_weights(1 / 6, 64), 1):
            with self.subTest(mode=mode):
                self.assert_close(actual, expected_cycle[(mode - 1) % 12])

    def test_reflection_has_mode_dependent_sign(self) -> None:
        for position in (0.0, 0.13, 0.25, 0.37, 0.49, 0.5, 1.0):
            original = string_mode_weights(position, 64)
            reflected = string_mode_weights(1 - position, 64)
            for mode, (a, b) in enumerate(zip(original, reflected), 1):
                with self.subTest(position=position, mode=mode):
                    self.assert_close(b, a * (-1) ** (mode + 1))

    def test_both_fixed_endpoints_are_nodes(self) -> None:
        for position in (0, 1, -0.0):
            for mode, value in enumerate(string_mode_weights(position, 64), 1):
                with self.subTest(position=position, mode=mode):
                    self.assert_close(value, 0.0)

    def test_all_supported_modes_are_finite_and_bounded(self) -> None:
        for step in range(101):
            position = step / 100
            for mode, value in enumerate(string_mode_weights(position, 64), 1):
                with self.subTest(position=position, mode=mode):
                    self.assertTrue(math.isfinite(value))
                    self.assertLessEqual(abs(value), 1 + STRING_ABS_TOL)

    def test_requested_counts_preserve_prefix_and_determinism(self) -> None:
        reference = string_mode_weights(0.37, 64)
        for count in range(1, 65):
            with self.subTest(count=count):
                self.assertEqual(string_mode_weights(0.37, count), reference[:count])
        self.assertEqual(string_mode_weights(0.37, 64), reference)

    def test_real_number_positions_include_fractions(self) -> None:
        self.assertEqual(string_mode_weights(Fraction(1, 2), 8), string_mode_weights(0.5, 8))


class StringModalResponseTests(unittest.TestCase):
    def assert_close(self, actual: float, expected: float) -> None:
        self.assertAlmostEqual(actual, expected, delta=RESPONSE_ABS_TOL)

    def test_returns_float_tuple_at_both_count_limits(self) -> None:
        for modes in (1, 64):
            response = string_modal_response(0.37, 0.23, modes)
            self.assertIsInstance(response, tuple)
            self.assertEqual(len(response), modes)
            self.assertTrue(all(isinstance(value, float) for value in response))

    def test_independent_cardinal_product(self) -> None:
        h = math.sqrt(0.5)
        expected_cycle = (h, 0.0, -h, 0.0, -h, 0.0, h, 0.0)
        for mode, actual in enumerate(string_modal_response(0.25, 0.5, 64), 1):
            with self.subTest(mode=mode):
                self.assert_close(actual, expected_cycle[(mode - 1) % 8])

    def test_midpoint_pickup_hides_existing_even_excitation(self) -> None:
        excitation = string_mode_weights(0.37, 64)
        hidden = string_modal_response(0.37, 0.5, 64)
        visible = string_modal_response(0.37, 0.23, 64)
        self.assertGreater(abs(excitation[1]), 0.7)
        self.assertGreater(abs(visible[1]), 0.7)
        for index in range(1, 64, 2):
            self.assert_close(hidden[index], 0.0)
        self.assertEqual(string_mode_weights(0.37, 64), excitation)
        # A null readout does not mean that excitation was at a modal node.
        midpoint_excitation = string_mode_weights(0.5, 64)
        self.assert_close(midpoint_excitation[1], 0.0)

    def test_product_uses_each_position_for_every_mode(self) -> None:
        for excitation in (0.13, 0.37, 0.49, 0.5, 0.51, 0.83):
            for pickup in (0.17, 0.25, 0.5, 0.63):
                response = string_modal_response(excitation, pickup, 64)
                for mode, value in enumerate(response, 1):
                    expected = math.sin(mode * math.pi * excitation) * math.sin(mode * math.pi * pickup)
                    with self.subTest(excitation=excitation, pickup=pickup, mode=mode):
                        self.assert_close(value, expected)

    def test_excitation_pickup_reciprocity(self) -> None:
        for excitation, pickup in ((0.37, 0.23), (0.49, 0.5), (0.0, 0.75), (0.25, 1.0)):
            self.assertEqual(
                string_modal_response(excitation, pickup, 64),
                string_modal_response(pickup, excitation, 64),
            )

    def test_double_reflection_preserves_response(self) -> None:
        original = string_modal_response(0.37, 0.23, 64)
        reflected = string_modal_response(0.63, 0.77, 64)
        for a, b in zip(original, reflected):
            self.assert_close(a, b)

    def test_colocated_positions_give_nonnegative_squares(self) -> None:
        for position in (0.0, 0.13, 0.37, 0.5, 0.99, 1.0):
            for value in string_modal_response(position, position, 64):
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 1 + RESPONSE_ABS_TOL)

    def test_fixed_endpoint_at_either_position_gives_null_response(self) -> None:
        for endpoint in (0, 1):
            for values in (
                string_modal_response(endpoint, 0.37, 64),
                string_modal_response(0.37, endpoint, 64),
            ):
                for value in values:
                    self.assert_close(value, 0.0)

    def test_all_supported_modes_are_finite_and_bounded(self) -> None:
        for step in range(101):
            for value in string_modal_response(step / 100, 0.37, 64):
                self.assertTrue(math.isfinite(value))
                self.assertLessEqual(abs(value), 1 + RESPONSE_ABS_TOL)

    def test_real_number_positions_include_fractions(self) -> None:
        self.assertEqual(
            string_modal_response(Fraction(1, 4), Fraction(1, 2), 8),
            string_modal_response(0.25, 0.5, 8),
        )


class CantileverModeShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.reference = _decimal_beam_reference()
        cls.tip_reference = _decimal_beam_reference(TIP_POSITIONS)

    def test_all_four_modes_match_independent_high_precision_formula(self) -> None:
        for (mode, position), expected in self.reference.items():
            with self.subTest(mode=mode, position=position):
                self.assertAlmostEqual(
                    cantilever_mode_shape(mode, float(position)), float(expected), delta=BEAM_ABS_TOL,
                )

    def test_mode_two_midpoint_signed_cardinal_reference(self) -> None:
        # Independently derived at 70 decimal digits from the characteristic root.
        expected = -0.71366583205667647876794885916866319
        self.assertAlmostEqual(float(self.reference[2, "0.5"]), expected, delta=1e-15)
        self.assertAlmostEqual(cantilever_mode_shape(2, 0.5), expected, delta=BEAM_ABS_TOL)

    def test_clamped_end_and_tip_normalization_for_every_mode(self) -> None:
        for mode in range(1, 5):
            with self.subTest(mode=mode):
                self.assertAlmostEqual(cantilever_mode_shape(mode, 0), 0.0, delta=BEAM_ABS_TOL)
                self.assertAlmostEqual(cantilever_mode_shape(mode, 1), 1.0, delta=BEAM_ABS_TOL)

    def test_clamped_end_slope_is_zero(self) -> None:
        # Fourth-order one-sided derivative stays entirely inside [0, 1].
        h = 1e-4
        coefficients = (-25, 48, -36, 16, -3)
        for mode in range(1, 5):
            derivative = sum(
                coefficient * cantilever_mode_shape(mode, k * h)
                for k, coefficient in enumerate(coefficients)
            ) / (12 * h)
            with self.subTest(mode=mode):
                self.assertAlmostEqual(derivative, 0.0, delta=5e-8)

    def test_free_tip_stencils_are_exact_through_degree_six(self) -> None:
        for order, weights in TIP_STENCILS.items():
            for degree in range(7):
                moment = sum(weight * (-k) ** degree for k, weight in enumerate(weights))
                expected = math.factorial(order) if degree == order else 0
                with self.subTest(order=order, degree=degree):
                    self.assertEqual(moment, expected)

    def _assert_free_tip_derivative(self, order: int) -> None:
        weights = TIP_STENCILS[order]
        h = float(TIP_STEP)
        amplification = sum(abs(float(weight)) for weight in weights) / h**order
        # h=0.005 keeps all seven points in [0.97, 1]. Much smaller steps
        # magnify hyperbolic cancellation as h**(-order), especially for shear.
        # The shape-error budget is propagated through the entire stencil;
        # eight unit ulps additionally cover multiplication/compensated summing.
        numerical_budget = amplification * (BEAM_ABS_TOL + 8 * math.ulp(1.0))
        for mode in range(1, 5):
            with localcontext() as context:
                context.prec = 70
                truncation = sum(
                    Decimal(weight.numerator) / Decimal(weight.denominator)
                    * self.tip_reference[mode, position]
                    for weight, position in zip(weights, TIP_POSITIONS)
                ) / TIP_STEP**order
            actual = math.fsum(
                float(weight) * cantilever_mode_shape(mode, float(position))
                for weight, position in zip(weights, TIP_POSITIONS)
            ) / h**order
            # The analytical free-end derivative is zero. Its independently
            # computed finite-stencil residual is truncation, not a changed
            # boundary condition. Adding its magnitude to the propagated
            # roundoff budget gives a scale-aware absolute zero-check.
            tolerance = abs(float(truncation)) + numerical_budget
            with self.subTest(mode=mode, derivative_order=order):
                self.assertAlmostEqual(actual, 0.0, delta=tolerance)

    def test_free_tip_curvature_is_zero(self) -> None:
        self._assert_free_tip_derivative(2)

    def test_free_tip_shear_is_zero(self) -> None:
        self._assert_free_tip_derivative(3)

    def test_even_modes_are_not_universally_suppressed_at_midpoint(self) -> None:
        self.assertLess(cantilever_mode_shape(2, 0.5), -0.7)
        self.assertGreater(cantilever_mode_shape(4, 0.5), 0.7)

    def test_beam_does_not_inherit_fixed_string_reflection(self) -> None:
        self.assertGreater(cantilever_mode_shape(1, 0.75) - cantilever_mode_shape(1, 0.25), 0.5)
        self.assertLess(cantilever_mode_shape(2, 0.75), 0.0)
        self.assertGreater(cantilever_mode_shape(2, 0.875), 0.0)

    def test_every_mode_is_float_finite_bounded_and_deterministic(self) -> None:
        for mode in range(1, 5):
            for step in range(257):
                position = step / 256
                value = cantilever_mode_shape(mode, position)
                with self.subTest(mode=mode, position=position):
                    self.assertIsInstance(value, float)
                    self.assertTrue(math.isfinite(value))
                    self.assertLessEqual(abs(value), 1 + BEAM_ABS_TOL)
                    self.assertEqual(value, cantilever_mode_shape(mode, position))

    def test_real_number_positions_include_fractions(self) -> None:
        self.assertEqual(cantilever_mode_shape(2, Fraction(1, 2)), cantilever_mode_shape(2, 0.5))


class InputValidationTests(unittest.TestCase):
    # The public contract requires rejection, not one particular exception
    # subclass or text. TypeError and ValueError are the appropriate categories.
    INVALID_POSITIONS = (
        float("nan"), float("inf"), -float("inf"), True, False,
        -1e-12, 1 + 1e-12, -1, 2, None, "0.5", 0.5 + 0j, [], (), {},
    )
    INVALID_STRING_COUNTS = (
        True, False, 0, -1, 65, 10**9, 1.0, 2.5, "2", None,
        float("nan"), float("inf"), -float("inf"), 2 + 0j, [], (), {},
    )

    def test_weights_reject_invalid_excitation(self) -> None:
        for value in self.INVALID_POSITIONS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                string_mode_weights(value, 4)

    def test_response_rejects_invalid_excitation(self) -> None:
        for value in self.INVALID_POSITIONS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                string_modal_response(value, 0.5, 4)

    def test_response_rejects_invalid_pickup(self) -> None:
        for value in self.INVALID_POSITIONS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                string_modal_response(0.5, value, 4)

    def test_weights_reject_invalid_mode_counts(self) -> None:
        for value in self.INVALID_STRING_COUNTS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                string_mode_weights(0.5, value)

    def test_response_rejects_invalid_mode_counts(self) -> None:
        for value in self.INVALID_STRING_COUNTS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                string_modal_response(0.5, 0.37, value)

    def test_beam_rejects_invalid_positions(self) -> None:
        for value in self.INVALID_POSITIONS:
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                cantilever_mode_shape(2, value)

    def test_beam_rejects_invalid_modes(self) -> None:
        for value in self.INVALID_STRING_COUNTS + (5,):
            with self.subTest(value=repr(value)), self.assertRaises((TypeError, ValueError)):
                cantilever_mode_shape(value, 0.5)


if __name__ == "__main__":
    unittest.main()
