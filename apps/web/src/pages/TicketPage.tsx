import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Size, TicketType, TierKey, type Ticket } from "@andy/contracts";
import { TIER_FOR_SIZE, isHeld, projectOfKey, ticketStatusLine, ticketsByRef } from "@andy/domain";
import { Activity } from "@/components/Activity";
import { AskQuestionForm } from "@/components/AskQuestionForm";
import { CancelArchiveControls } from "@/components/CancelArchiveControls";
import {
  EditableList,
  InlineText,
  MarkdownField,
  UnsavedDrafts,
  useTicketSave,
} from "@/components/InlineEdit";
import { WorkerControl } from "@/components/WorkerControls";
import { ExecutorControl } from "@/components/ExecutorControls";
import { useInFlight } from "@/components/InFlightPanel";
import { MoveControls } from "@/components/MoveControls";
import { QuestionCard } from "@/components/QuestionCard";
import { ScoreReasons } from "@/components/ScoreReasons";
import { TicketCostLine } from "@/components/TicketCostLine";
import { Markdown } from "@/components/Markdown";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  ticketQueryKey,
  useEvents,
  useAcceptAssumption,
  usePromoteAssumption,
  useReadiness,
  useRuns,
  useTicketByRef,
  useTicketQuestions,
  useWorker,
  useExecutor,
  useTickets,
} from "@/lib/queries";
import { STAGE_LABELS, TYPE_LABELS } from "@/lib/tickets";
import { showsError } from "@/lib/live";

/**
 * The story panel (ADR-0059: UX foundation, row "Story panel"): the ticket over the board,
 * rendered in the board route's `<Outlet />`. A status line, then one document (title,
 * description, checklist, scope) beside a rail of facts, then questions and one activity
 * timeline. Every field edits in place. Esc or Close goes back to the board.
 *
 * The URL holds the ticket key (`/p/ai/t/AI-2`); an older id link loads the ticket and swaps
 * in the key URL.
 */
export function TicketPage() {
  const { projectId, ticketRef } = useParams({ from: "/p/$projectId/t/$ticketRef" });
  const ticket = useTicketByRef(projectId, ticketRef);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const panel = useRef<HTMLElement>(null);
  const loaded = ticket.data;

  // The canonical URL is the ticket's own project + key: an id link or a key under another
  // project's path switches to it.
  useEffect(() => {
    if (!loaded || (loaded.key === ticketRef && loaded.projectId === projectId)) return;
    // Seed the canonical URL's query, so the swap shows no loading state.
    queryClient.setQueryData(ticketQueryKey(loaded.projectId, loaded.key), loaded);
    void navigate({
      to: "/p/$projectId/t/$ticketRef",
      params: { projectId: loaded.projectId, ticketRef: loaded.key },
      replace: true,
    });
  }, [loaded, ticketRef, projectId, navigate, queryClient]);

  const close = useCallback(
    () => void navigate({ to: "/p/$projectId", params: { projectId }, search: true }),
    [navigate, projectId],
  );
  useEscapeToClose(close);
  const drafts = useConfirmLeavingDrafts();
  // Keyboard first: the panel takes focus when it opens or shows another ticket.
  useEffect(() => panel.current?.focus({ preventScroll: true }), [ticketRef]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={loaded ? `${loaded.key}: ${loaded.title}` : ticketRef}
      className="fixed inset-x-0 top-12 bottom-0 z-30 overflow-y-auto bg-background shadow-lg outline-none min-[900px]:left-auto min-[900px]:w-[640px] min-[900px]:border-l min-[900px]:border-border"
    >
      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-background px-4 sm:px-6">
        {loaded && <StatusLine ticket={loaded} />}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto px-1"
          aria-label="Close"
          title="Close (Esc)"
          onClick={close}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <div className="px-4 py-4 sm:px-6">
        {ticket.isPending && <Loading />}
        {showsError(ticket) && <QueryError error={ticket.error} />}
        {loaded && (
          // Keyed by ticket: another ticket starts with fresh editors, never this one's drafts.
          <UnsavedDrafts.Provider value={drafts}>
            <Story key={loaded.id} ticket={loaded} />
          </UnsavedDrafts.Provider>
        )}
      </div>
    </aside>
  );
}

/**
 * Leaving the ticket (Close, Esc, another card, a link, Back, a reload) with unsaved typing asks
 * first; Cancel keeps the panel and the draft. Returns the set the editors register in.
 */
function useConfirmLeavingDrafts(): Set<string> {
  const [drafts] = useState(() => new Set<string>());
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      drafts.size > 0 &&
      !window.confirm("Discard your unsaved changes to this ticket?"),
    enableBeforeUnload: () => drafts.size > 0,
  });
  return drafts;
}

/** Esc closes the panel, unless a field, an open editor or a menu took it first. */
function useEscapeToClose(close: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [role=menu]")) return;
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);
}

type TicketPath = { projectId: string; ticketId: string };
const pathOf = (t: Ticket): TicketPath => ({ projectId: t.projectId, ticketId: t.id });

/** "Waiting for you: 2 questions", "Refining · 1 min" … from data the API already returns. */
function StatusLine({ ticket }: { ticket: Ticket }) {
  const path = pathOf(ticket);
  const tickets = useTickets(ticket.projectId).data ?? [];
  const runs = useRuns(path).data ?? [];
  const questions = useTicketQuestions(path).data ?? [];
  const events = useEvents(path).data ?? [];
  const worker = useWorker(path).data?.worker;
  const executor = useExecutor(path).data?.next;
  const inFlight = useInFlight(ticket.projectId).data;
  const { text, tone } = ticketStatusLine(
    ticket,
    {
      tickets,
      runs,
      events,
      openQuestions: questions.filter((q) => q.status === "open").length,
      worker,
      inFlight,
      executor,
    },
    new Date(),
  );
  return (
    <p role="status" aria-label="Status" className="min-w-0 truncate">
      <Badge variant={tone} className="text-sm">
        {text}
      </Badge>
    </p>
  );
}

function Story({ ticket: t }: { ticket: Ticket }) {
  const title = useTicketSave(t);
  const body = useTicketSave(t);
  return (
    <article className="space-y-6">
      <TicketCostLine {...pathOf(t)} />
      <InlineText
        label="Title"
        required
        value={t.title}
        onSave={(v, done) => title.save({ title: v }, done)}
        onEdit={title.begin}
        pending={title.pending}
        error={title.error}
        wrap={(button) => (
          <h2 className="text-lg font-medium">
            <span className="text-muted-foreground tabular-nums">{t.key}:</span> {button}
          </h2>
        )}
      />
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="min-w-0 space-y-6">
          <MarkdownField
            label="Description"
            value={t.body}
            onSave={(v, done) => body.save({ body: v }, done)}
            onEdit={body.begin}
            pending={body.pending}
            error={body.error}
          />
          <ListField
            ticket={t}
            field="acceptanceCriteria"
            label={t.type === "chore" ? "Done when" : "Acceptance criteria"}
          />
          <ListField ticket={t} field="assumptions" label="Assumptions" />
          <ListField ticket={t} field="outOfScope" label="Out of scope" />
          <ListField ticket={t} field="touches" label="Touches" />
        </div>
        <Rail ticket={t} />
      </div>
      <ScoreReasons ticket={t} />
      <Questions {...pathOf(t)} />
      <Assumptions ticket={t} />
      <Timeline {...pathOf(t)} />
    </article>
  );
}

function ListField({
  ticket,
  field,
  label,
}: {
  ticket: Ticket;
  field: "acceptanceCriteria" | "assumptions" | "outOfScope" | "touches";
  label: string;
}) {
  const s = useTicketSave(ticket);
  return (
    <EditableList
      label={label}
      value={ticket[field]}
      onSave={(v, done) => s.save({ [field]: v }, done)}
      pending={s.pending}
      error={s.error}
    />
  );
}

/** Stage and moves, then the facts: type, size, tier, epic, blocked by; cancel and archive. */
function Rail({ ticket: t }: { ticket: Ticket }) {
  const tickets = useTickets(t.projectId).data ?? [];
  const derived = t.size ? TIER_FOR_SIZE[t.size] : null;
  const epics = tickets.filter((o) => o.type === "epic" && o.id !== t.id);
  const sizeReason = useTicketSave(t);

  return (
    <aside aria-label="Details" className="min-w-0 space-y-4">
      <div className="space-y-2">
        <p className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Stage</span>
          <Badge>{STAGE_LABELS[t.stage]}</Badge>
        </p>
        <Readiness {...pathOf(t)} />
        <MoveControls ticket={t} />
      </div>
      <WorkerControl ticket={t} />
      <ExecutorControl ticket={t} />
      <SelectField
        ticket={t}
        label="Type"
        value={t.type ?? ""}
        options={[["", "No type"], ...TicketType.options.map((v) => [v, TYPE_LABELS[v]] as const)]}
        patch={(v) => ({ type: v === "" ? null : TicketType.parse(v) })}
      />
      <div className="space-y-1">
        <SelectField
          ticket={t}
          label="Size"
          value={t.size ?? ""}
          options={[["", "—"], ...Size.options.map((v) => [v, v] as const)]}
          patch={(v) => ({ size: v === "" ? null : Size.parse(v) })}
        />
        <InlineText
          label="Size reason"
          placeholder="Why this size?"
          value={t.sizeReason ?? ""}
          onSave={(v, done) => sizeReason.save({ sizeReason: v || null }, done)}
          onEdit={sizeReason.begin}
          pending={sizeReason.pending}
          error={sizeReason.error}
          className="text-xs"
        />
      </div>
      <SelectField
        ticket={t}
        label="Tier"
        value={t.overrides.tier ?? ""}
        // Tier comes from size; choosing one pins it (`overrides.tier`, ADR-0058).
        options={[
          ["", derived ? `${derived} (from size)` : "from size"],
          ...TierKey.options.map((v) => [v, `${v} (pinned)`] as const),
        ]}
        patch={(v) => {
          const rest = { ...t.overrides };
          delete rest.tier;
          return { overrides: v === "" ? rest : { ...rest, tier: TierKey.parse(v) } };
        }}
      />
      <SelectField
        ticket={t}
        label="Epic"
        value={t.parentId ?? ""}
        options={[["", "None"], ...epics.map((e) => [e.id, `${e.key}: ${e.title}`] as const)]}
        patch={(v) => ({ parentId: v === "" ? null : v })}
      />
      <BlockedBy ticket={t} tickets={tickets} />
      <CancelArchiveControls ticket={t} />
    </aside>
  );
}

/** A rail fact as a select that saves as soon as it changes. */
function SelectField({
  ticket,
  label,
  value,
  options,
  patch,
}: {
  ticket: Ticket;
  label: string;
  value: string;
  options: (readonly [string, string])[];
  patch: (value: string) => Parameters<ReturnType<typeof useTicketSave>["save"]>[0];
}) {
  const s = useTicketSave(ticket);
  return (
    <div className="space-y-1">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Select
          className="h-8"
          value={value}
          disabled={s.pending}
          onChange={(e) => s.save(patch(e.target.value))}
        >
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </label>
      {s.error}
    </div>
  );
}

/**
 * Blockers are ticket keys in any project (AI-96); entries from before hold same-project ids.
 * A blocker from another project links to its own project, by its key.
 */
function BlockedBy({ ticket: t, tickets }: { ticket: Ticket; tickets: Ticket[] }) {
  const s = useTicketSave(t);
  const [key, setKey] = useState("");
  const byRef = ticketsByRef(tickets);
  const candidates = tickets.filter(
    (o) =>
      o.id !== t.id && !o.archived && !t.blockedBy.includes(o.id) && !t.blockedBy.includes(o.key),
  );
  const add = (ref: string, onSaved?: () => void) =>
    s.save({ blockedBy: [...t.blockedBy, ref] }, onSaved);
  return (
    <section aria-label="Blocked by" className="space-y-1">
      <span className="text-xs text-muted-foreground">Blocked by</span>
      {t.blockedBy.length > 0 && (
        <ul className="space-y-1">
          {t.blockedBy.map((ref) => {
            const b = byRef.get(ref);
            const elsewhere = b ? null : projectOfKey(ref);
            return (
              <li key={ref} className="flex items-center justify-between gap-1">
                {b ? (
                  <Link
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId: b.projectId, ticketRef: b.key }}
                    className="truncate underline"
                  >
                    {b.key}: {b.title}
                  </Link>
                ) : elsewhere ? (
                  <Link
                    to="/p/$projectId/t/$ticketRef"
                    params={{ projectId: elsewhere, ticketRef: ref }}
                    className="truncate underline"
                  >
                    {ref} (another project)
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Another ticket</span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 shrink-0 px-1 text-muted-foreground"
                  aria-label={`Remove blocker: ${b?.key ?? ref}`}
                  disabled={s.pending}
                  onClick={() => s.save({ blockedBy: t.blockedBy.filter((x) => x !== ref) })}
                >
                  <X aria-hidden className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Select
        aria-label="Add a blocker"
        className="h-8"
        value=""
        disabled={s.pending}
        onChange={(e) => e.target.value && add(e.target.value)}
      >
        <option value="">Add a blocker…</option>
        {candidates.map((o) => (
          <option key={o.id} value={o.key}>
            {o.key}: {o.title}
          </option>
        ))}
      </Select>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ref = key.trim().toUpperCase();
          if (ref) add(ref, () => setKey(""));
        }}
      >
        <Input
          aria-label="Add a blocker from another project"
          placeholder="Or another project's key, e.g. OPS-12"
          className="h-8"
          value={key}
          disabled={s.pending}
          onChange={(e) => setKey(e.target.value)}
        />
      </form>
      {s.error}
    </section>
  );
}

function Readiness(path: TicketPath) {
  const dor = useReadiness(path);
  return (
    <section aria-label="Definition of Ready" className="space-y-1 text-xs">
      {showsError(dor) && <QueryError error={dor.error} />}
      {dor.data?.met && <p className="text-muted-foreground">Definition of Ready: met.</p>}
      {dor.data && !dor.data.met && (
        <>
          <p className="text-muted-foreground">Definition of Ready missing:</p>
          <ul className="list-disc pl-4">
            {dor.data.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Questions(path: TicketPath) {
  const questions = useTicketQuestions(path);
  // Open questions first: they are what the ticket waits for.
  const sorted = [...(questions.data ?? [])].sort(
    (a, b) => Number(b.status === "open") - Number(a.status === "open"),
  );
  return (
    <section aria-label="Questions" className="space-y-2">
      <h3 className="text-sm font-medium">Questions</h3>
      {questions.isPending && <Loading />}
      {showsError(questions) && <QueryError error={questions.error} />}
      {sorted.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
      <AskQuestionForm {...path} />
    </section>
  );
}

/**
 * What refine decided without asking (ADR-0075): one click makes any of them a question. A held
 * gap (AI-75) keeps the ticket out of Ready until it is asked or accepted.
 */
function Assumptions({ ticket }: { ticket: Ticket }) {
  const promote = usePromoteAssumption(pathOf(ticket));
  const accept = useAcceptAssumption(pathOf(ticket));
  const canPromote = ticket.stage === "backlog" || ticket.stage === "ready";
  if (ticket.refineAssumptions.length === 0) return null;
  return (
    <section aria-label="Assumptions" className="space-y-2">
      <h3 className="text-sm font-medium">Assumptions</h3>
      {promote.error && <QueryError error={promote.error} />}
      {accept.error && <QueryError error={accept.error} />}
      <ul className="space-y-2">
        {ticket.refineAssumptions.map((a) => (
          <li key={a.id} className="space-y-1 rounded-md border border-border p-3 text-sm">
            <Markdown>{a.text}</Markdown>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{a.question}</span>
              {a.demotedBy && <Badge variant="attention">Over the question cap</Badge>}
              {isHeld(a) && <Badge variant="attention">Holds the ticket</Badge>}
              {a.status !== "assumed" && <Badge>{a.status}</Badge>}
              {a.status === "assumed" && canPromote && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={promote.isPending}
                  onClick={() => promote.mutate(a.id)}
                >
                  Ask me instead
                </Button>
              )}
              {isHeld(a) && ticket.stage === "backlog" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(a.id)}
                >
                  Accept as an assumption
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline(path: TicketPath) {
  const events = useEvents(path);
  const runs = useRuns(path);
  if (events.isPending || runs.isPending) return <Loading />;
  if (events.data === undefined || showsError(events)) return <QueryError error={events.error} />;
  if (runs.data === undefined || showsError(runs)) return <QueryError error={runs.error} />;
  return <Activity {...path} events={events.data} runs={runs.data} />;
}
