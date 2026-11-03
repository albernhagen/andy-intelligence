/**
 * Browser side of GitHub's App manifest flow (ADR-0043). The state value lives only in this
 * tab's sessionStorage, so a callback link someone else crafted fails the check.
 */

export const STATE_KEY = "github-setup-state";

export function newState(): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  return state;
}

/** True once for the state this tab started with; the stored value is cleared either way. */
export function takeState(state: string | undefined): boolean {
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return Boolean(expected && state && expected === state);
}

/** Posts the manifest to GitHub as a form (GitHub's flow requires a top-level POST). */
export function postManifest(postUrl: string, manifest: unknown, state: string): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = `${postUrl}?state=${encodeURIComponent(state)}`;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
