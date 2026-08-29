---
title: NEXUS
emoji: 🎛️
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: "Holographic analog computer: Lorenz, ouroboros, organs"
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
  <a href="https://huggingface.co/spaces/SZLHOLDINGS/nexus"><img src="https://img.shields.io/badge/space-NEXUS%20MK--II-7CFF6B?style=flat-square" alt="NEXUS space"></a>
  <a href="https://github.com/szl-holdings/nexus"><img src="https://img.shields.io/badge/source-szl--holdings%2Fnexus-3A414C?style=flat-square" alt="GitHub source"></a>
</p>
<p align="center"><sub>Part of the <a href="https://huggingface.co/SZLHOLDINGS">SZL Holdings</a> estate. NEXUS is a local-first instrument — audio and patterns stay in the browser.</sub></p>
<!-- SZL-ESTATE-CARD:v2:END -->

# NEXUS MK-II

Holographic analog computer. Lorenz core. Ouroboros. Five organs. Phosphor CRT.

Frontier is not a preset dump — it is a running analog computer. Three integrators solve Lorenz (σ, ρ, β). The function generator is a rise/fall triangle. Those voltages drive voice cutoff, pan, fold, tape delay, the grid pen, and the holographic CRT.

The SZL kernel is analog physics, not a seventh module. Ouroboros taxes amplitude over eight bounded bars. Eight falsifiable invariants hash the analog receipt chain. Five organs (YACHAY, YUYAY, YAWAR, OTel, KHIPU) fail-close the VCA. Hatun probes stay LIVE or honestly UNAVAILABLE. Energy is UNAVAILABLE — never a fabricated joule. Λ is advisory. Conjecture 1 remains OPEN.

Inspired by analog computing practice (THE ANALOG THING, CRT holograms, modular patchbays) — not a dashboard, not a generative-audio model.

| Module | Role |
| --- | --- |
| **The Grid** | 16×8 phosphor matrix. Write cells. Analog pen tracks Lorenz X×Y. |
| **Oscilloscope** | Y-T, X-Y, FFT, **HOLO**. Hologram is a 3D Lorenz volume plus five organ nodes and a WILLAY conscience ring. |
| **Tape Deck** | Stereo echo with wow, flutter, saturation. Analog Z modulates delay time. Bounce dumps eight seconds. |
| **Patchbay** | Sources include **ANLG** and **FUNC**. Drag source → dest. Click a cable to pull it. |
| **Sequencer** | 16-step clock, Euclidean hits, swing, probability, arp. Ouroboros closes the loop at eight bars in Frontier. |
| **Voice** | Morph VCO, ladder-ish VCF, ADSR, unison, FM, folder, LFO, S&H, ring. Analog computer: **IC / OP / HALT / REP**, Rate, Chaos, Drive. Λ and energy UNAVAILABLE on the panel. |

Default chain: **VCO → VCF → DELAY → VCA → OUT**. Scope taps the master bus.

Frontier patch: **ANLG → VCF**, **FUNC → PAN**, **S&H → VCF**. F19: a DOWN organ mutes the VCA. Master cannot compensate.

## Analog computer

| Mode | What it does |
| --- | --- |
| **IC** | Hold initial conditions. Seed voltages freeze. |
| **OP** | Operate. Integrators run. The attractor lives. |
| **HALT** | Freeze the current state. CV stays put. |
| **REP** | Repetitive operation. Reseed the attractor on a period set by Rate. |

Coefficient pots: **σ = 10**, **ρ = 18…40** (Chaos), **β = 8/3**. Rate is computer time. Drive is how hard the voltages hit the voice and tape.

## Kernel as voltages

| Organ | Quechua | Formulas | Analog face |
| --- | --- | --- | --- |
| BRAIN | YACHAY | F1 | Function generator. Read-only cortex. |
| HEART | YUYAY | F4 F11 | Λ weighted geometric mean. Zero axis fail-closes. |
| CIRCULATORY | YAWAR | F7 F22 | SHA-256 analog receipt chain. |
| NERVOUS | OTel | F12 | Loop-tax. Energy UNAVAILABLE. Hatun probe. |
| SKELETON | KHIPU | F18 F19 | Locked-8. CHECKED ≠ Lean PROVEN @ c7c0ba17. |

WILLAY is conscience, not a sixth organ — the hologram ring. Locked-proven exactly eight: F1 F4 F7 F11 F12 F18 F19 F22. ed25519 and flywheel stay UNAVAILABLE without a key or samples.

## Run it

**Launch Frontier** — unlocks Web Audio and boots the holographic analog computer.

Then play the keys, patch ANLG into VCF, watch HOLO, and throw Chaos.

- **Z–M** piano (shift = octave)
- **Space** run / stop sequencer
- **Tab** cycle scope Y-T / X-Y / FFT / HOLO
- **F** Frontier · Shift-F disengage · F again reseeds the loop
- Voice: **IC / OP / HALT / REP**
- Scenes F1–F22 on the header (shift-click stores)
- **Esc** panic (all notes off)
- **?** shortcuts

Patterns, patches, tape, and voice settings persist in IndexedDB on the machine that played them. No accounts. No backend.

## Source

- GitHub: [szl-holdings/nexus](https://github.com/szl-holdings/nexus)
- Space: [SZLHOLDINGS/nexus](https://huggingface.co/spaces/SZLHOLDINGS/nexus)

```bash
npm install
npm run dev
```
