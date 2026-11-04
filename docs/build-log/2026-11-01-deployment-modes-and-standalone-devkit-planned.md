# 2026-11-01 — Deployment modes and standalone devkit planned

- **Decided (Andy, ADR-0032: Deployment modes and a standalone devkit):** three layers: devkit (vendor-neutral procedures + skills over MCP), control plane (one host for it), deployment mode (`gcp` now, `local` later). Devkit first: installs into Claude Code and works alone, tickets as markdown in the project repo; full local control plane later. Devkit lives in `devkit/` in this repo as a Claude Code plugin marketplace.
- Rule from now on: GCP specifics (runs/config/spend storage, Cloud Tasks, Firebase Auth) go behind ports when first built or touched (affects M1.2: Ticket core, M1.6: Claude Code executor).
- Detailed design after M1: First end-to-end flow (ARCHITECTURE open question 11).
