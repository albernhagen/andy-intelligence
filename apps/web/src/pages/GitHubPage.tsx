import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { unwrap, useApi } from "@/lib/api";
import { newState, postManifest, takeState } from "@/lib/github-setup";
import { useConnectGitHub, useGitHub } from "@/lib/queries";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton } from "@/components/PageSkeleton";

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
    <section>
      <PageHeader title="GitHub">
        <SettingsTabs />
      </PageHeader>
      <div className="max-w-3xl space-y-4">
        {github.isPending && <ListSkeleton rows={3} />}
        {github.isError && (
          <QueryError
            error={github.error}
            what="the GitHub connection"
            onRetry={() => void github.refetch()}
          />
        )}
        {github.data && !github.data.connected && (
          <section
            aria-label="GitHub App"
            className="space-y-3 rounded-lg border border-border bg-raised p-4"
          >
            <h3 className="text-md font-semibold">GitHub App</h3>
            <p className="text-muted-foreground">
              Creates a private GitHub App on your account for this control plane. GitHub asks you
              to confirm, then sends you back here.
            </p>
            <Field label="App name (unique on GitHub and not an existing account name)">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {error !== null && <QueryError error={error} />}
            <Button className="h-11 sm:h-9" onClick={() => void connect()}>
              Connect GitHub
            </Button>
          </section>
        )}
        {github.data?.connected && (
          <section
            aria-label="GitHub App"
            className="space-y-3 rounded-lg border border-border bg-raised p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-md font-semibold">GitHub App</h3>
              <Badge variant="success">Connected</Badge>
              {github.data.installUrl && (
                <Button asChild variant="outline" className="ml-auto h-11 sm:h-9">
                  <a href={github.data.installUrl} target="_blank" rel="noreferrer">
                    Install on another repo
                    <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">
              Connected as <b className="text-foreground">{github.data.slug}</b> (owner{" "}
              {github.data.owner}). Pick the repos the control plane may manage on GitHub, then
              reload this page.
            </p>
            <h4 className="text-xs font-medium text-muted-foreground">Installed on</h4>
            {github.data.repos.length === 0 ? (
              <EmptyState
                title="Not installed on any repo yet."
                description="The control plane can manage only the repos you install the App on."
                action={
                  github.data.installUrl ? (
                    <Button asChild className="h-11 sm:h-9">
                      <a href={github.data.installUrl} target="_blank" rel="noreferrer">
                        Install on a repo
                      </a>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul
                aria-label="Repos"
                className="divide-y divide-border rounded-md border border-border"
              >
                {github.data.repos.map((r) => (
                  <li
                    key={r.fullName}
                    className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <span className="font-medium">{r.fullName}</span>
                    {r.private && <span className="text-xs text-muted-foreground">private</span>}
                    <Badge variant="success" className="ml-auto">
                      Installed
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
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
