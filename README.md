---
title: NEXUS
emoji: 🎛️
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: "Analog formula computer: locked-8 voltages, Λ VCA, Khipu CRT"
tags:
  - web-audio
  - synthesizer
  - analog
  - visualization
  - crt
  - sequencer
  - szl-holdings
---

<!-- SZL-ESTATE-CARD:v2:START -->
<p align="center"><a href="https://a-11-oy.com/"><img src="https://huggingface.co/spaces/SZLHOLDINGS/README/resolve/main/assets/estate-banner-v2.svg" alt="SZL Holdings — governed, receipted, verifiable" width="100%"></a></p>
<p align="center">
  <a href="https://github.com/szl-holdings/.github/tree/main/doctrine"><img src="https://img.shields.io/badge/doctrine-v11%20LOCKED-0B1F3A?style=flat-square" alt="doctrine v11"></a>
  <a href="https://huggingface.co/spaces/SZLHOLDINGS/nexus"><img src="https://img.shields.io/badge/space-NEXUS%20MK--III-7CFF6B?style=flat-square" alt="NEXUS space"></a>
  <a href="https://github.com/szl-holdings/nexus"><img src="https://img.shields.io/badge/source-szl--holdings%2Fnexus-3A414C?style=flat-square" alt="GitHub source"></a>
</p>
<p align="center"><sub>Part of the <a href="https://huggingface.co/SZLHOLDINGS">SZL Holdings</a> estate. NEXUS is a local-first instrument — audio and patterns stay in the browser.</sub></p>
<!-- SZL-ESTATE-CARD:v2:END -->

# NEXUS MK-III

Analog formula computer. Phosphor CRT whose voltages are the SZL kernel.

The 21 canonical formulas from `szl-holdings/szl-formulas` run as analog physics. Locked-proven is exactly eight — F1 F4 F7 F11 F12 F18 F19 F22 — machine-enforced, CHECKED ≠ Lean proof. Λ is the weighted geometric mean over 13 Yuyay axes. Uniqueness stays **Conjecture 1 (open)** and is never painted green.

| Module | Role |
| --- | --- |
| **Yuyay rail** | 13 live analog axes. F19 VCA. Locked-8 crystals. Six organs. |
| **The Grid** | 16×8 phosphor matrix. Write cells, spatial XY to filter and pan. |
| **Oscilloscope** | Y-T, X-Y, FFT, **Λ radar**, **Khipu knot** (hash-chained phosphor). |
| **Tape Deck** | Stereo echo with wow, flutter, saturation. Bounce dumps eight seconds. |
| **Patchbay** | **YARQA canals** (voice / tape / out). Amber cables are leak. Leak is the bound. |
| **Sequencer** | 16-step clock with **Ouroboros loop-tax**. Amplitude decays; energy UNAVAILABLE. |
| **Voice** | Morph, ladder-ish filter, ADSR, unison, FM, folder, LFO, S&H, ring. |

Default chain: **VCO → VCF → DELAY → VCA → OUT**. Scope taps the master bus.

**F19** is the analog VCA: Λ = ∏ axisᵢ^{wᵢ}. A zero axis (F12 fail-closed) silences the instrument. Turning master up cannot compensate. That is non-compensatory scoring you can hear.

**PURIQ** runs a governed formula loop (bounded, homogeneous, Schur, Singleton, Reidemeister, Mādhava), knots a Khipu receipt chain (UNSIGNED-honest), and fail-closes on a validator halt.

Energy is **UNAVAILABLE**. Joules are never fabricated.

## Run it

Press **Press to engage** — that gesture unlocks Web Audio.

Then: **Euclid** → **Run**. Watch the Yuyay bars and the Λ meter. Press **P** or **Puriq** to knot the CRT.

**Frontier** (`F`) launches a deep-space patch. **PURIQ** (`P`) instills the formula corpus.

- **Z–M** piano (shift = octave)
- **Space** run / stop
- **Tab** cycle scope Y-T / X-Y / FFT / Λ / Knot
- **F** Frontier · **P** PURIQ
- Locked-8 crystals on the kernel rail
- **F12** latches fail-closed mute
- Scenes 1–8 on the header (shift-click stores)
- **Esc** panic (all notes off)
- **?** shortcuts

Patterns, patches, tape, and voice settings persist in IndexedDB on the machine that played them. No accounts. No backend.

## Source

- GitHub: [szl-holdings/nexus](https://github.com/szl-holdings/nexus)
- Space: [SZLHOLDINGS/nexus](https://huggingface.co/spaces/SZLHOLDINGS/nexus)
- Formulas: [szl-holdings/szl-formulas](https://github.com/szl-holdings/szl-formulas)
- Lean kernel: [szl-holdings/lutar-lean](https://github.com/szl-holdings/lutar-lean) · DOI [10.5281/zenodo.20434308](https://doi.org/10.5281/zenodo.20434308)

```bash
npm install
npm run dev
```
