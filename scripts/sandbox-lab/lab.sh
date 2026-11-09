#!/usr/bin/env bash
# The test bed (AI-58, AI-63). It repeats what .github/workflows/claude-executor.yml does for a
# build run, in order, then runs Claude Code twice, each session making one Bash call in the
# sandbox: the workflow's exact check command (then the verify step), and probe.sh. Then it asserts
# the runbook §9 expectations. Keep the steps in step with the workflow: they are copies, not
# shared code; only the check command is read from the workflow.
#   In Docker (run.sh): as root, one Haiku call per session, credential in /run/lab-cred.
#   On the runner (platform/actions/sandbox-self-test): LAB_ON_RUNNER=1, as the runner user.
#   LAB_MODEL=stub: stub-model.mjs answers instead of a model; only fake credentials exist.
# $LAB_IN/src.tar is the working tree, $LAB_OUT receives the report. Exit 0 only if every
# expectation holds.
set -euo pipefail
WS=${LAB_WS:-/home/runner/work/andy-intelligence/andy-intelligence}
TEMP=${LAB_TEMP:-/home/runner/work/_temp}
IN=${LAB_IN:-/in}
OUT=${LAB_OUT:-/out}
STUB_PORT=18765
if [ -n "${LAB_ON_RUNNER:-}" ]; then
  as_runner() { "$@"; }
  as_root() { sudo "$@"; }
else
  as_runner() { sudo -u runner -H env PATH="$PATH" "$@"; }
  as_root() { "$@"; }
fi
own() { [ -n "${LAB_ON_RUNNER:-}" ] || chown -R runner:runner "$@"; }

echo "== Checkout (the working tree as one commit; origin as on the runner)"
mkdir -p "$WS"
tar -xf "$IN/src.tar" -C "$WS"
own /home/runner/work
as_runner git -C "$WS" init -q -b main
as_runner git -C "$WS" -c user.name=lab -c user.email=lab@localhost add -A
as_runner git -C "$WS" -c user.name=lab -c user.email=lab@localhost commit -q -m lab
as_runner git -C "$WS" remote add origin https://github.com/albernhagen/andy-intelligence

echo "== Install the permission profile as managed settings"
as_runner node "$WS/scripts/executor-profile.mjs" --step build --root "$WS" \
  --codeowners "$WS/.github/CODEOWNERS" --out "$TEMP/managed-settings.json"
as_root rm -rf /etc/claude-code
as_root install -D -m 0644 "$TEMP/managed-settings.json" /etc/claude-code/managed-settings.json

echo "== Prepare the sandbox (build)"
mkdir -p /tmp/agent
if [ -z "${LAB_ON_RUNNER:-}" ]; then chown runner:runner /tmp/agent; fi
as_runner bash -c "
  set -euo pipefail; cd '$WS'
  mkdir -p .git/refs .git/info .git/objects/info .git/modules .git/worktrees
  [ -e .git/commondir ] || printf '.\n' > .git/commondir
  [ -e .git/config.worktree ] || : > .git/config.worktree
  [ -e .git/packed-refs ] || : > .git/packed-refs
  git status --porcelain > /dev/null
  cp -a .git '$TEMP/pristine.git'
  git ls-files -z --cached --others --exclude-standard > '$TEMP/workspace-before.manifest'
"

echo "== Install dependencies (build)"
as_runner bash -c "cd '$WS' && pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile \
  --store-dir '$TEMP/pnpm-store' --reporter=silent"

# claude-code-action's own git writes (src/github/operations/git-config.ts, restore-config.ts).
action_git_writes() {
  as_runner bash -c "
    cd '$WS'
    git config user.name 'claude[bot]'
    git config user.email '41898282+claude[bot]@users.noreply.github.com'
    git remote set-url origin \"https://x-access-token:\$(printf lab-fake)@github.com/albernhagen/andy-intelligence.git\"
    printf '/.claude-pr/\n' >> .git/info/exclude
  "
}

# The credential goes only into the claude command's environment, never the container's.
model_env=()
if [ "${LAB_MODEL:-live}" = stub ]; then
  STUB_COMMAND_FILE="$TEMP/stub-command" STUB_PORT="$STUB_PORT" \
    node "$WS/scripts/sandbox-lab/stub-model.mjs" 2> "$TEMP/stub-model.log" &
  trap 'kill $! 2>/dev/null || true' EXIT
  model_env=(ANTHROPIC_BASE_URL="http://127.0.0.1:$STUB_PORT" ANTHROPIC_API_KEY=lab-fake
    CLAUDE_CODE_OAUTH_TOKEN=lab-fake CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1)
else
  while IFS= read -r line; do
    case "$line" in CLAUDE_CODE_OAUTH_TOKEN=?* | ANTHROPIC_API_KEY=?*) model_env+=("$line") ;; esac
  done < <(cat /run/lab-cred 2>/dev/null)
  if [ "${#model_env[@]}" -eq 0 ]; then
    echo "FAIL no model credential in /run/lab-cred: see runbook agent-runs.md §9a" >&2
    exit 2
  fi
fi

# One Claude Code session whose single Bash call runs $1 in the sandbox. The env is the workflow's
# Claude step's, plus fake GitHub and Actions tokens the sandbox must hide. $2: extra VAR=value.
sandbox_call() {
  local command=$1 extra=$2 prompt="This is a sandbox test. Use the Bash tool exactly once to run this exact command, unchanged, and use no other tool, then reply with its exit code and nothing else:

$1"
  printf '%s' "$command" > "$TEMP/stub-command"
  # shellcheck disable=SC2086 # $extra is one VAR=value or empty
  as_runner env -i HOME="$HOME_DIR" USER=runner PATH="$PATH" "${model_env[@]}" $extra \
    GITHUB_TOKEN=lab-fake GH_TOKEN=lab-fake ACTIONS_RUNTIME_TOKEN=lab-fake \
    ACTIONS_ID_TOKEN_REQUEST_TOKEN=lab-fake CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 TMPDIR=/tmp/agent \
    npm_config_store_dir=/tmp/agent/pnpm-store npm_config_cache_dir=/tmp/agent/pnpm-cache \
    npm_config_state_dir=/tmp/agent/pnpm-state LAB_CHECKS="${LAB_CHECKS:-all}" \
    bash -c "cd '$WS' && claude -p \"\$1\" --model haiku --max-turns 3 --verbose --output-format stream-json" _ "$prompt" \
    | jq -s . > "$TEMP/claude-execution.json" || echo "claude exited $?"
}
HOME_DIR=/home/runner
check_git() { PRISTINE="$TEMP/pristine.git" LIVE="$WS/.git" node "$WS/scripts/executor-sandbox.mjs" check-git || echo "(check failed)"; }
restore_git() { rm -rf "$WS/.git" && cp -a "$TEMP/pristine.git" "$WS/.git"; own "$WS/.git"; }
drop_placeholders() { WORKSPACE="$WS" MANIFEST="$TEMP/workspace-before.manifest" node "$WS/scripts/executor-publish.mjs" drop-placeholders; }
pristine_git() {
  GIT_DIR="$TEMP/pristine.git" GIT_WORK_TREE="$WS" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.untrackedCache=false "$@"
}

echo "== Check the sandbox (build): the workflow's exact command"
check_command=$(sed -n "s/^ *check='\(.*\)'\$/\1/p" "$WS/.github/workflows/claude-executor.yml")
if [ -z "$check_command" ]; then
  echo "FAIL the check command isn't in claude-executor.yml: see runbook agent-runs.md §9a" >&2
  exit 2
fi
action_git_writes
nonce=$(openssl rand -hex 16)
sandbox_call "$check_command" "SANDBOX_CHECK_NONCE=$nonce"

echo "== Verify the sandbox check (build)"
check_tampered=$(check_git)
restore_git
verify=$(EXECUTION_FILE="$TEMP/claude-execution.json" COMMAND="$check_command" NONCE="$nonce" \
  MARKER="$WS/.executor-sandbox-check" node "$WS/scripts/executor-sandbox.mjs" verify-check || true)
drop_placeholders
check_dirty=$(pristine_git status --porcelain --untracked-files=all | tr '\n' ' ')

echo "== Claude Code: one Bash call runs probe.sh in the sandbox"
action_git_writes
sandbox_call "bash scripts/sandbox-lab/probe.sh" ""

echo "== Collect the change (build): check-git, restore, drop placeholders, add, diff"
tampered=$(check_git)
restore_git
mkdir -p "$OUT" && rm -rf "$OUT/report" && cp -a "$WS/.sandbox-lab-out" "$OUT/report" 2>/dev/null || true
rm -rf "$WS/.sandbox-lab-out"
drop_placeholders
pristine_git add -A
collected=$(pristine_git diff --cached --name-status --no-renames --no-ext-diff | tr '\n' ' ')

echo "== Runbook §9 expectations"
echo "Logs: $OUT/report/ (one file per check). Execution log: $TEMP/claude-execution.json."
REPORT="$OUT/report/report.txt" HOST_PID1="$(tr '\0' ' ' < /proc/1/cmdline | cut -c1-80)" \
  VERIFY="$verify" CHECK_TAMPERED="$check_tampered" CHECK_DIRTY="${check_dirty% }" \
  TAMPERED="$tampered" COLLECTED="${collected% }" EXPECTED_CHANGE=$'A\tsandbox-lab-change.txt' \
  LAB_CHECKS="${LAB_CHECKS:-all}" node "$WS/scripts/sandbox-lab/expectations.mjs"
