---
title: NEXUS
emoji: 🎛️
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: Holographic analog computer: 6 programs, optical
---

> **Legacy card.** This page describes the stdlib Python hologram that
> `space/server.py` and `space/index.html` still carry (`space/server.py` is
> kept byte-identical to the root `server.py`). It is not the card or the image
> of the canonical Space. `space/Dockerfile` now builds the full Web Audio
> workstation: a `node:26` builder runs `npm ci` and `npm run build:static`, and
> a `python:3.12-slim` runtime serves the prerendered files through
> `space/app_server.py` (see the root [`README.md`](../README.md) and
> [`AGENTS.md`](../AGENTS.md)). The notes below about Hub `npm ci`, ECR Public
> and `mirror.gcr.io` are kept as history.

# NEXUS hologram

Holographic analog computer. Six programs. Optical core. Analog neuromorphic. Five organs. Phosphor CRT.

This Space is the **bootable hologram**. The full Web Audio / patchbay instrument lives on GitHub: [szl-holdings/nexus](https://github.com/szl-holdings/nexus). Hub cannot `npm ci` and cannot pull ECR Public (factory exit 128), so this payload is stdlib Python on `mirror.gcr.io/library/python:3.12-slim`.

Factory COPY resolves `server.py` and `index.html` at **repo root**. Nested `space/Dockerfile` is remapped to the Hub-root Dockerfile. Do not factory-reboot.

| Claim | Honesty |
|---|---|
| Six-program analog (LRNZ HARM VDP DFFG LTKA NEMO) | LIVE stdlib Euler, matches the instrument |
| NEMO five-organ AdEx anatomy + WILLAY second brain + analog correlator + hybrid IC + analog circuits + 3F STDP | LIVE math — **not** a physical chip |
| Two-beam optical analog `Ao²+Ar²+2AoAr cos(Δφ)` | LIVE |
| Kernel organs | **UNAVAILABLE** on hologram — never fabricated LIVE |
| Λ weighted geometric mean | advisory · uniqueness **Conjecture 1 OPEN** |
| Energy | **UNAVAILABLE** — never a fabricated joule |
| proven_trust | false |
| Full analog synth / Web Audio | GitHub only |

Inspired by analog computing practice (THE ANALOG THING, EAI hybrid IC/OP/HOLD, CRT holograms) and analog neuromorphic literature (Izhikevich 2003; BrainScaleS-2 analog STDP correlators; Mead analog VLSI) — take the **job**, never the code. Not a dashboard. Not a generative-audio model.

Apache-2.0 · Doctrine v11 LOCKED · 749/14/163.
