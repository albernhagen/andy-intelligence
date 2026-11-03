import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { newState, postManifest, takeState } from "@/lib/github-setup";
import { useConnectGitHub, useGitHub } from "@/lib/queries";

/** Settings → GitHub (ADR-0043): connect the App once, then install it on repos. */
export function GitHubPage() {
  const github = useGitHub();
  const api = useApi();
  const [name, setName] = useState("andy-intelligence-control");
  const [error, setError] = useState<unknown>(null);

  async function connect() {
    setError(null);
    try {
      const { postUrl, manifest } = unwrap(
        await api.GET("/api/github/manifest", { params: { query: { name } } }),
      );
      postManifest(postUrl, manifest, newState());
    } catch (e) {
      setError(e);
    }
  }

  return (
    <section className="max-w-xl space-y-4">
      <h2 className="text-lg font-medium">GitHub</h2>
      {github.isPending && <Loading />}
      {github.isError && <QueryError error={github.error} />}
      {github.data && !github.data.connected && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p>
            Creates a private GitHub App on your account for this control plane. GitHub asks you to
            confirm, then sends you back here.
          </p>
          <Field label="App name (unique on GitHub and not an existing account name)">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {error !== null && <QueryError error={error} />}
          <Button onClick={() => void connect()}>Connect GitHub</Button>
        </div>
      )}
      {github.data?.connected && (
        <div className="space-y-3">
          <p>
            Connected as <b>{github.data.slug}</b> (owner {github.data.owner}).
          </p>
          <p>
            <a
              className="underline"
              href={github.data.installUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Install on repos
            </a>{" "}
            — pick the repos the control plane may manage, then reload this page.
          </p>
          <h3 className="font-medium">Installed on</h3>
          {github.data.repos.length === 0 ? (
            <p className="text-muted-foreground">No repos yet.</p>
          ) : (
            <ul className="list-disc pl-5">
              {github.data.repos.map((r) => (
                <li key={r.fullName}>{r.fullName}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** GitHub redirects here after "Create GitHub App" with `code` and `state`. */
export function GitHubCallbackPage() {
  const search = useSearch({ strict: false }) as { code?: string; state?: string };
  const connect = useConnectGitHub();
  const navigate = useNavigate();
  const [stateOk] = useState(() => takeState(search.state));
  const started = useRef(false);

  useEffect(() => {
    if (!stateOk || !search.code || started.current) return;
    started.current = true;
    connect.mutate(search.code, {
      onSuccess: () => void navigate({ to: "/settings/github" }),
    });
  }, [stateOk, search.code, connect, navigate]);

  if (!stateOk) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This link didn&apos;t come from your &quot;Connect GitHub&quot; click in this tab. Start
        again from Settings → GitHub.
      </p>
    );
  }
  if (connect.isError) return <QueryError error={connect.error} />;
  return <Loading />;
}
