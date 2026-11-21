#!/usr/bin/env bash
# Setup for a Claude Code cloud environment (AI-149; runbook `coordinating-sessions.md` §8).
# The environment's setup script calls only this file. Safe as root on a fresh Ubuntu VM, needs
# no secret, and exits non-zero if any step fails, so a broken install never looks ready.
set -euo pipefail
cd "$(dirname "$0")/.."
corepack enable
pnpm install --frozen-lockfile
pnpm build
