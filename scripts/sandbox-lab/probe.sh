#!/usr/bin/env bash
# Runs inside Claude Code's sandbox, as the test bed's one Bash call (AI-58). Writes key=value
# facts and each check's log under .sandbox-lab-out/ in the checkout; never prints a variable's
# value. lab.sh asserts the facts after the session. LAB_CHECKS=fast skips test and build.
set -u
out=.sandbox-lab-out
mkdir -p "$out"
report="$out/report.txt"
: > "$report"
fact() { printf '%s=%s\n' "$1" "$2" >> "$report"; }
run() { # name, command...: exit code as a fact, output to <name>.log
  local name=$1; shift
  "$@" > "$out/$name.log" 2>&1
  fact "$name" "$?"
}

for v in CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY GITHUB_TOKEN GH_TOKEN ACTIONS_RUNTIME_TOKEN; do
  if printenv "$v" > /dev/null; then fact "env.$v" set; else fact "env.$v" unset; fi
done
fact pid1 "$(tr '\0' ' ' < /proc/1/cmdline | cut -c1-80)"
run sudo sudo -n true
run curl.example curl -sS --max-time 15 -o /dev/null https://example.com
run curl.registry curl -sS --max-time 15 -o /dev/null https://registry.npmjs.org
run git.update-index git update-index -q --refresh
run write.root touch .sandbox-lab-touch
run write.scripts touch scripts/.sandbox-lab-touch
run write.review-script sh -c ': >> scripts/review-gate.mjs'
run write.github touch .github/.sandbox-lab-touch
run write.git-config sh -c ': >> .git/config'
run write.git-hooks touch .git/hooks/sandbox-lab
rm -f .sandbox-lab-touch scripts/.sandbox-lab-touch
run pnpm.lint pnpm lint
run pnpm.typecheck pnpm typecheck
if [ "${LAB_CHECKS:-all}" = all ]; then
  run pnpm.test pnpm test
  run pnpm.build pnpm build
fi
fact done yes
