import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { MintedRunner, RunnerView } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Loading, QueryError } from "@/components/Status";
import { useMintRunner, useProjects, useRevokeRunner, useRunners } from "@/lib/queries";

/**
 * Settings → Local runners (ADR-0089 slice 3): mint a runner secret (shown once), see which
 * runners are present, revoke one. Only here, never over MCP: a stolen MCP token can't add one.
 */
export function RunnersPage() {
  const runners = useRunners();
  const [minted, setMinted] = useState<MintedRunner | null>(null);
  return (
    <section className="max-w-2xl space-y-4">
      <SettingsNav current="runners" />
      <h2 className="text-lg font-medium">Local runners</h2>
      <p className="text-sm text-muted-foreground">
        A runner on your Mac polls this control plane for tickets set to run locally; nothing
        connects in. It is present while it polled in the last 2 minutes. At most 2 runners; secrets
        expire after 90 days.
      </p>
      {minted ? (
        <ShownOnce minted={minted} onDone={() => setMinted(null)} />
      ) : (
        <MintForm onMinted={setMinted} />
      )}
      {runners.isPending && <Loading />}
      {runners.isError && <QueryError error={runners.error} />}
      {runners.data && runners.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No runners yet.</p>
      )}
      {runners.data && runners.data.length > 0 && (
        <ul aria-label="Runners" className="divide-y divide-border rounded-md border border-border">
          {runners.data.map((r) => (
            <RunnerRow key={r.id} runner={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Links between the settings pages. */
export function SettingsNav({ current }: { current: "github" | "runners" }) {
  const link = (to: string, label: string, here: boolean) =>
    here ? (
      <span aria-current="page" className="font-medium">
        {label}
      </span>
    ) : (
      <Link to={to} className="underline">
        {label}
      </Link>
    );
  return (
    <nav aria-label="Settings pages" className="flex gap-3 text-sm">
      {link("/settings/github", "GitHub", current === "github")}
      {link("/settings/runners", "Local runners", current === "runners")}
    </nav>
  );
}

function MintForm({ onMinted }: { onMinted: (m: MintedRunner) => void }) {
  const projects = useProjects().data ?? [];
  const mint = useMintRunner();
  const [name, setName] = useState("Andy's Mac");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form
      aria-label="New runner"
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        mint.mutate({ name, projectIds: picked }, { onSuccess: onMinted });
      }}
    >
      <Field label="Runner name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </Field>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">Projects it may run</legend>
        {projects.map((p) => (
          <label key={p.id} className="mr-3 inline-flex items-center gap-1">
            <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.key}: {p.name}
          </label>
        ))}
      </fieldset>
      {mint.error && <QueryError error={mint.error} />}
      <Button type="submit" disabled={mint.isPending || picked.length === 0 || !name.trim()}>
        Create runner secret
      </Button>
    </form>
  );
}

function ShownOnce({ minted, onDone }: { minted: MintedRunner; onDone: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium">
        Copy this secret now: it is shown once and can't be read again.
      </p>
      <Input
        aria-label="Runner secret"
        readOnly
        value={minted.secret}
        onFocus={(e) => e.target.select()}
      />
      <p className="text-xs text-muted-foreground">
        Paste it into <code>local-runner login</code> on the runner user; it is kept in that user's
        Keychain.
      </p>
      <Button size="sm" variant="outline" onClick={onDone}>
        I've copied it
      </Button>
    </div>
  );
}

function RunnerRow({ runner }: { runner: RunnerView }) {
  const revoke = useRevokeRunner();
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="font-medium">{runner.name}</span>
      {runner.state === "active" ? (
        <Badge variant={runner.present ? "success" : "default"}>
          {runner.present ? "Present" : "Away"}
        </Badge>
      ) : (
        <Badge variant="danger">{runner.state === "revoked" ? "Revoked" : "Expired"}</Badge>
      )}
      <span className="text-xs text-muted-foreground">
        {runner.projectIds.join(", ")} · last seen{" "}
        {runner.lastSeenAt ? new Date(runner.lastSeenAt).toLocaleString() : "never"} · expires{" "}
        {new Date(runner.expiresAt).toLocaleDateString()}
      </span>
      {runner.state === "active" && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate(runner.id)}
        >
          Revoke
        </Button>
      )}
      {revoke.error && <QueryError error={revoke.error} />}
    </li>
  );
}
