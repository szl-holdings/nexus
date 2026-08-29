---
title: NEXUS
emoji: 🎛️
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: "Analog CRT workstation: grid, scope, tape, sequencer"
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

Analog computing workstation. Phosphor CRT, not a webpage with knobs painted on.

Six modules on one chassis:

| Module | Role |
| --- | --- |
| **The Grid** | 16×8 phosphor matrix. Write cells, spatial XY to filter and pan. |
| **Oscilloscope** | Real analyser beam — Y-T, X-Y lissajous, FFT. |
| **Tape Deck** | Stereo echo with wow, flutter, saturation. Bounce dumps eight seconds. |
| **Patchbay** | Drag source to dest. Cables sag. Sample-and-hold is a CV source. |
| **Sequencer** | 16-step clock, Euclidean fill, swing, probability, scale, hold-arp. |
| **Voice** | Morph, ladder-ish filter, ADSR, unison, FM, folder, LFO, S&H, ring. |

Default chain: **VCO → VCF → DELAY → VCA → OUT**. Scope taps the master bus.

Analog computer: **wavefolder**, **function generator** (LFO rate/depth into the cutoff), **sample & hold** clocked by the sequencer, **ring multiplier**, **orbit tank**.

## Run it

Press **Press to engage** — that gesture unlocks Web Audio.

Then: **Euclid** → **Run**. Watch the grid bloom and the beam write.

**Frontier** (or press `F`) launches a deep-space patch: minor euclid, orbit tank, X-Y computer scope, hold-arp, folder, S&H, ring.

- **Z–M** piano (shift = octave)
- **Space** run / stop
- **Tab** cycle scope Y-T / X-Y / FFT
- **F** Frontier
- Scenes 1–8 on the header (shift-click stores)
- **Esc** panic (all notes off)
- **?** shortcuts
- **Arp** on the sequencer while keys are held
- **Bounce** on the tape deck dumps eight seconds of the master bus
- Web MIDI if the browser grants it

Patterns, patches, tape, and voice settings persist in IndexedDB on the machine that played them. No accounts. No backend.

## Source

- GitHub: [szl-holdings/nexus](https://github.com/szl-holdings/nexus)
- Space: [SZLHOLDINGS/nexus](https://huggingface.co/spaces/SZLHOLDINGS/nexus)

```bash
npm install
npm run dev
```

Apache-2.0. Copyright 2026 SZL Holdings.
