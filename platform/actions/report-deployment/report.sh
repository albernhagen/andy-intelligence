#!/usr/bin/env bash
# Reports a deployment to the control plane (AI-180: M6.4). Called by action.yml with its inputs
# in the environment. Never fails the job: every error is a warning and a job-summary line, exit 0.
set -u
# Every input may be unset or empty; nothing below may trip `set -u` and fail the deploy.
PHASE="${PHASE:-}" IMAGE_DIGEST="${IMAGE_DIGEST:-}" DEPLOYMENT_ID="${DEPLOYMENT_ID:-}"
STATUS="${STATUS:-}" SERVICE="${SERVICE:-}" REGION="${REGION:-}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}" GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}" RUNNER_TEMP="${RUNNER_TEMP:-/tmp}"
# Keep the token out of logs: no `set -x` in this step.
not_recorded() {
  echo "::warning title=report-deployment::Deployment not recorded ($PHASE): $1"
  echo "⚠️ Deployment not recorded in the control plane ($PHASE): $1. The deploy itself is unaffected." >> "$GITHUB_STEP_SUMMARY"
  exit 0
}
[ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || not_recorded "no OIDC token (the job needs id-token: write)"

case "$PHASE" in
  start)
    [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || not_recorded "no image digest"
    body=$(jq -cn --arg d "$IMAGE_DIGEST" '{imageDigest: $d}')
    path="/deployments"
    ;;
  finish)
    [[ "$DEPLOYMENT_ID" =~ ^[A-Za-z0-9-]{1,80}$ ]] || not_recorded "the start report returned no deployment id"
    [[ "$STATUS" =~ ^(succeeded|failed)$ ]] || not_recorded "status must be succeeded or failed"
    # Only a succeeded deploy is serving its candidate; after a failure the latest ready revision
    # may be the previous good one, so a failed report names no revision.
    revision=""
    if [ "$STATUS" = succeeded ] && [ -n "$SERVICE" ] && [ -n "$REGION" ]; then
      revision=$(gcloud run services describe "$SERVICE" --region "$REGION" \
        --format='value(status.latestReadyRevisionName)' 2>/dev/null) || revision=""
    fi
    body=$(jq -cn --arg s "$STATUS" --arg r "$revision" \
      '{status: $s} + (if $r == "" then {} else {revision: $r} end)')
    path="/deployments/$DEPLOYMENT_ID/finish"
    ;;
  *) not_recorded "phase must be start or finish" ;;
esac

token=$(curl -sS --fail --max-time 10 -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$CONTROL_PLANE_URL" | jq -r .value) || token=""
[ -n "$token" ] && [ "$token" != null ] || not_recorded "could not get an OIDC token"
echo "::add-mask::$token"

response="$RUNNER_TEMP/deployment-report.json"
# A start is not idempotent (a retried start after a lost answer would record twice), so only a
# finish is retried; a finish that already landed answers 409, which counts as recorded.
retry=0
[ "$PHASE" = finish ] && retry=2
code=$(curl -sS --max-time 15 --retry "$retry" -o "$response" -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
  --data "$body" "$CONTROL_PLANE_URL$path") || code=000
case "$code" in
  2??) ;;
  409) [ "$PHASE" = finish ] || not_recorded "the control plane answered HTTP 409" ;;
  *) not_recorded "the control plane answered HTTP $code" ;;
esac

if [ "$PHASE" = start ]; then
  id=$(jq -r '.deploymentId // ""' "$response")
  [[ "$id" =~ ^[A-Za-z0-9-]{1,80}$ ]] || not_recorded "no deployment id in the answer"
  echo "deployment_id=$id" >> "$GITHUB_OUTPUT"
  echo "Deployment $id recorded as started." >> "$GITHUB_STEP_SUMMARY"
else
  echo "Deployment $DEPLOYMENT_ID recorded as $STATUS${revision:+ (revision $revision)}." >> "$GITHUB_STEP_SUMMARY"
fi
