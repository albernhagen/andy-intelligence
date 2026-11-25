import { useRef, useState, type RefObject } from "react";
import type { MintedRunner, RunnerView } from "@andy/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { ListSkeleton } from "@/components/PageSkeleton";
import { SettingsTabs } from "@/components/SettingsTabs";
import { QueryError } from "@/components/Status";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { useMintRunner, useProjects, useRevokeRunner, useRunners } from "@/lib/queries";
import { dateOnly, dateTime } from "@/lib/format";

/**
 * Settings → Local runners (ADR-0089 part 3): mint a runner secret (shown once), see which
 * runners are present, revoke one. Only here, never over MCP: a stolen MCP token can't add one.
 */
export function RunnersPage() {
  const runners = useRunners();
  const [minted, setMinted] = useState<MintedRunner | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <section>
      <PageHeader title="Local runners">
        <SettingsTabs />
      </PageHeader>
      <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <section
          aria-label="Your runners"
          className="space-y-3 rounded-lg border border-border bg-raised p-4"
        >
          <h3 className="text-md font-semibold">Local runners</h3>
          <p className="text-muted-foreground">
            A runner on your Mac polls this control plane for tickets set to run locally; nothing
            connects in. It is present while it polled in the last 2 minutes. At most 2 runners;
            secrets expire after 90 days.
          </p>
          {runners.isPending && <ListSkeleton rows={2} className="border-0 p-0" />}
          {runners.isError && (
            <QueryError
              error={runners.error}
              what="the local runners"
              onRetry={() => void runners.refetch()}
            />
          )}
          {runners.data && runners.data.length === 0 && (
            <EmptyState
              title="No runners yet."
              description="Add one to run tickets set to run locally on your Mac."
              action={
                <Button className="h-11 sm:h-9" onClick={() => nameRef.current?.focus()}>
                  Add runner
                </Button>
              }
            />
          )}
          {runners.data && runners.data.length > 0 && (
            <ul
              aria-label="Runners"
              className="divide-y divide-border rounded-md border border-border"
            >
              {runners.data.map((r) => (
                <RunnerRow key={r.id} runner={r} />
              ))}
            </ul>
          )}
        </section>
        {minted ? (
          <ShownOnce minted={minted} onDone={() => setMinted(null)} />
        ) : (
          <MintForm onMinted={setMinted} nameRef={nameRef} />
        )}
      </div>
    </section>
  );
}

function MintForm({
  onMinted,
  nameRef,
}: {
  onMinted: (m: MintedRunner) => void;
  nameRef: RefObject<HTMLInputElement | null>;
}) {
  const projects = useProjects().data ?? [];
  const mint = useMintRunner();
  const [name, setName] = useState("Andy's Mac");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <form
      aria-label="New runner"
      className="space-y-3 rounded-lg border border-border bg-raised p-4"
      onSubmit={(e) => {
        e.preventDefault();
        mint.mutate({ name, projectIds: picked }, { onSuccess: onMinted });
      }}
    >
      <h3 className="text-md font-semibold">Add runner</h3>
      <Field label="Runner name">
        <Input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </Field>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">Projects it may run</legend>
        {projects.map((p) => (
          <Checkbox
            key={p.id}
            checked={picked.includes(p.id)}
            onCheckedChange={() => toggle(p.id)}
            label={`${p.key}: ${p.name}`}
          />
        ))}
      </fieldset>
      {mint.error && <QueryError error={mint.error} />}
      <Button
        type="submit"
        className="h-11 sm:h-9"
        disabled={mint.isPending || picked.length === 0 || !name.trim()}
      >
        Create runner secret
      </Button>
    </form>
  );
}

function ShownOnce({ minted, onDone }: { minted: MintedRunner; onDone: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-border bg-muted p-4">
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
    <li className="flex min-h-11 flex-wrap items-center gap-2 px-3 py-2 text-sm">
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
        {runner.lastSeenAt ? dateTime(runner.lastSeenAt) : "never"} · expires{" "}
        {dateOnly(runner.expiresAt)}
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
