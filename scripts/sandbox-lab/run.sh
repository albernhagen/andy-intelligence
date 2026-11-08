#!/usr/bin/env bash
# Runs the build-sandbox test bed locally (AI-58; runbook agent-runs.md §9a): builds the image,
# runs the working tree (uncommitted changes included) through the build run's sandbox steps and one Haiku call, and prints the
# runbook §9 expectations. Needs Docker and a model credential in the environment
# (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, or ANTHROPIC_API_KEY); never printed.
#   scripts/sandbox-lab/run.sh            all checks (lint, typecheck, test, build)
#   LAB_CHECKS=fast scripts/sandbox-lab/run.sh   skip test and build
set -euo pipefail
# The credential reaches the container as a read-only file that lab.sh loads only into the
# claude call's environment, never as a container-wide variable. Its source: the environment,
# or a private file outside the repo (~/.config/andy-intelligence/sandbox-lab.env, mode 600, one
# line CLAUDE_CODE_OAUTH_TOKEN=...). For your own, trusted working tree only: the container runs
# with relaxed isolation (below).
cred_file="$HOME/.config/andy-intelligence/sandbox-lab.env"
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}${ANTHROPIC_API_KEY:-}" ]; then
  cred_file=$(umask 077 && mktemp)
  trap 'rm -f "$cred_file"' EXIT
  {
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$CLAUDE_CODE_OAUTH_TOKEN"
    [ -n "${ANTHROPIC_API_KEY:-}" ] && printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY"
  } > "$cred_file"
fi
[ -f "$cred_file" ] || { echo "No model credential: see runbook agent-runs.md §9a" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out="${TMPDIR:-/tmp}/sandbox-lab-out"
in="${TMPDIR:-/tmp}/sandbox-lab-in"
mkdir -p "$out" "$in"
# The working tree (tracked and untracked, not ignored) as a tarball: a worktree's .git points
# at a host path the container can't see.
# COPYFILE_DISABLE stops macOS tar adding ._* AppleDouble files for extended attributes.
(cd "$repo" && git ls-files -z -co --exclude-standard | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf "$in/src.tar")
docker build -q -t andy-intelligence-sandbox-lab "$here" > /dev/null
# bubblewrap needs user namespaces and its own /proc inside the container; nothing else is relaxed.
docker run --rm \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
  -v "$in:/in:ro" -v "$out:/out" -v "$cred_file:/run/lab-cred:ro" \
  -e LAB_CHECKS \
  andy-intelligence-sandbox-lab
