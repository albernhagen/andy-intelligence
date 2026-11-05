#!/bin/sh
# Renders the screenshot checks in the same Playwright Linux image CI uses (fonts differ on
# macOS) and writes changed images to apps/web/e2e/__screenshots__. Needs Docker.
# Extra arguments go to `playwright test`, e.g. `-g board`.
set -eu
cd "$(dirname "$0")/../../.."
IMAGE=$(sed -n 's/^ *image: *\(mcr\.microsoft\.com\/playwright[^ ]*\).*/\1/p' .github/workflows/ui-screenshots.yml)
PNPM=$(node -p 'require("./package.json").packageManager')
docker run --rm -e CI=1 -v "$PWD:/src:ro" -v "$PWD/apps/web/e2e/__screenshots__:/out" "$IMAGE" sh -c '
  set -eu
  mkdir /work && cd /src && tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C /work
  cd /work && npm install -g --silent "$0" && pnpm install --frozen-lockfile --ignore-scripts --silent
  cd apps/web && status=0 && pnpm exec playwright test --update-snapshots "$@" || status=$?
  cp e2e/__screenshots__/*.png /out/ 2>/dev/null || true
  exit $status
' "$PNPM" "$@"
