import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { apiFetch, signIn, watchUser } from "@/lib/auth";

/**
 * MCP OAuth consent (ADR-0039: MCP OAuth facade). /oauth/authorize sends the browser here
 * with the validated request in the query string; approving posts it back with the user's
 * Firebase ID token. The API re-validates everything, so the query string is only display.
 */
export function OAuthConsent() {
  const params = new URLSearchParams(window.location.search);
  const clientName = params.get("client_name") ?? "An app";
  const redirectHost = safeHost(params.get("redirect_uri"));
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    watchUser(setUser)
      .then((u) => (unsub = u))
      .catch((e: unknown) => setError(String(e)));
    return () => unsub?.();
  }, []);

  async function approve() {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(params);
    delete body.client_name;
    const res = await apiFetch("/api/oauth/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      window.location.assign(((await res.json()) as { redirect: string }).redirect);
      return;
    }
    setBusy(false);
    setError(
      res.status === 403
        ? `${user?.email ?? "This account"} is not allowed to use this control plane.`
        : `Approval failed (${res.status}).`,
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Connect {clientName}</h1>
      <p className="text-muted-foreground">
        {clientName} ({redirectHost}) wants to use andy-intelligence tools on your behalf.
      </p>
      {user === undefined && <p className="text-muted-foreground">Loading…</p>}
      {user === null && (
        <Button onClick={() => signIn().catch((e: unknown) => setError(String(e)))}>
          Sign in with Google
        </Button>
      )}
      {user && (
        <div className="space-y-2">
          <p>Signed in as {user.email}.</p>
          <Button disabled={busy} onClick={() => void approve()}>
            Approve
          </Button>
        </div>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

function safeHost(uri: string | null): string {
  try {
    return uri ? new URL(uri).host : "unknown";
  } catch {
    return "unknown";
  }
}
