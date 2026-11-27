import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Size, TicketType, type Ticket, type Worker } from "@andy/contracts";
import {
  isHeld,
  listedMilestoneHold,
  projectOfKey,
  ticketStatusLine,
  ticketsByRef,
} from "@andy/domain";
import { Activity } from "@/components/Activity";
import { AskQuestionForm } from "@/components/AskQuestionForm";
import { CancelArchiveControls } from "@/components/CancelArchiveControls";
import { EpicBreakdownPanel } from "@/components/EpicBreakdown";
import { EpicChildren } from "@/components/EpicChildren";
import { OverridesEditor } from "@/components/OverridesEditor";
import { RouteLayers } from "@/components/RouteLayers";
import { PullRequestLink, waitingPullRequest } from "@/components/PullRequestLink";
import { MergeButton, repoOfPullRequest } from "@/components/inbox/MergeButton";
import {
  EditableList,
  InlineText,
  MarkdownField,
  UnsavedDrafts,
  useTicketSave,
} from "@/components/InlineEdit";
import { WorkerControl } from "@/components/WorkerControls";
import { EXECUTOR_LABELS, ExecutorControl } from "@/components/ExecutorControls";
import { useInFlight } from "@/components/InFlightPanel";
import { TicketMilestone } from "@/components/MilestoneControls";
import { MoveControls } from "@/components/MoveControls";
import { QuestionCard } from "@/components/QuestionCard";
import { ScoreReasons } from "@/components/ScoreReasons";
import { TicketCostLine } from "@/components/TicketCostLine";
import { Markdown } from "@/components/Markdown";
import { Loading, QueryError } from "@/components/Status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { PanelSelect } from "@/components/PanelSelect";
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
  useProjects,
  useMilestones,
  useTicketRouting,
} from "@/lib/queries";
import { TYPE_LABELS } from "@/lib/tickets";
import { showsError } from "@/lib/live";

/**
 * The ticket panel (ADR-0059: UX foundation, row "Story panel"): the ticket over the board,
 * rendered in the board route's `<Outlet />`. A status line, then one document (title,
 * description, checklist, scope) beside a rail of facts, then questions and one activity
 * timeline. Every field edits in place. Esc or Close goes back to the board.
 *
 * Below 900 px the panel fills the screen under the header (AI-175: M7.5: Phone ticket detail):
 * on a phone the status line may wrap instead of truncating and Close is a 44 px target.
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
  useSlideIn(panel);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={loaded ? `${loaded.key}: ${loaded.title}` : ticketRef}
      // A phone gets the whole screen, clear of the notch (AI-379); the X closes it in one tap.
      className="fixed inset-x-0 top-12 bottom-0 z-30 overflow-y-auto bg-raised shadow-lg outline-none max-sm:top-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)] min-[900px]:left-auto min-[900px]:w-[640px] min-[900px]:border-l min-[900px]:border-border"
    >
      <div className="sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b border-border bg-raised px-4 py-1 sm:h-10 sm:py-0 sm:px-6">
        {loaded && <StatusLine ticket={loaded} />}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto size-11 shrink-0 gap-1.5 px-1 text-muted-foreground sm:h-8 sm:w-auto sm:px-2"
          aria-label="Close"
          aria-keyshortcuts="Escape"
          title="Close (Esc)"
          onClick={close}
        >
          <X aria-hidden className="size-4 sm:hidden" />
          <span aria-hidden className="max-sm:hidden">
            Close
          </span>
          <Kbd className="max-sm:hidden">Esc</Kbd>
        </Button>
      </div>
      <div className="px-4 py-4 sm:px-6">
        {ticket.isPending && <Loading />}
        {showsError(ticket) && (
          <QueryError
            error={ticket.error}
            what="the ticket"
            onRetry={() => void ticket.refetch()}
          />
        )}
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

/**
 * The panel slides in from the right when it opens (AI-375; design.md "Motion": 180 ms, opacity
 * and transform only, off under reduced motion). Not on switching tickets: the panel stays.
 */
function useSlideIn(panel: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = panel.current;
    if (!el?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { transform: "translateX(24px)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [panel]);
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
  const loadedTickets = useTickets(ticket.projectId).data;
  const tickets = loadedTickets ?? [];
  const milestones = useMilestones(ticket.projectId).data;
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
      // Dispatch's own rule (AI-306), once both lists are in; the API holds the same tickets.
      milestoneHold:
        loadedTickets && milestones ? listedMilestoneHold(ticket, loadedTickets, milestones) : null,
    },
    new Date(),
  );
  const repos = useProjects().data?.find((p) => p.id === ticket.projectId)?.repos ?? [];
  const pr = waitingPullRequest(events, repos);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <p role="status" aria-label="Status" className="min-w-0 sm:truncate">
        <Badge variant={tone} className="wrap-anywhere">
          {text}
        </Badge>
      </p>
      {pr && <span className="text-sm text-muted-foreground">PR #{pr.number} waits for you</span>}
    </div>
  );
}

/**
 * Led by the decision (AI-336): the next move, open questions and the PR first; then the title.
 * An epic then shows its outcome, breakdown (AI-383), tickets, milestone and night plan before
 * its fields.
 */
function Story({ ticket: t }: { ticket: Ticket }) {
  const title = useTicketSave(t, "Title");
  const body = useTicketSave(t, "Description");
  const isEpic = t.type === "epic";
  return (
    <article className="space-y-6">
      <Next ticket={t} />
      <div className="space-y-1">
        <InlineText
          label="Title"
          required
          value={t.title}
          onSave={(v, done) => title.save({ title: v }, done)}
          onEdit={title.begin}
          pending={title.pending}
          error={title.error}
          wrap={(button) => (
            // The key above the title in mono (mockup); the heading still reads "AI-1: …".
            <h2 className="text-lg font-semibold">
              <span className="block font-mono text-xs font-normal text-muted-foreground">
                {t.key}
                <span className="sr-only">:</span>
              </span>{" "}
              {button}
            </h2>
          )}
        />
        <TicketCostLine {...pathOf(t)} />
      </div>
      {isEpic && (
        <>
          <Outcome ticket={t} />
          <EpicBreakdownPanel ticket={t} />
          <EpicChildren
            {...pathOf(t)}
            milestone={
              <div className="max-w-sm">
                <TicketMilestone ticket={t} />
              </div>
            }
          />
        </>
      )}
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
          <ListFields ticket={t} />
        </div>
        <Rail ticket={t} />
      </div>
      <ScoreReasons ticket={t} />
      <Questions {...pathOf(t)} />
      <Assumptions ticket={t} />
      <Timeline path={pathOf(t)} ticket={t} />
    </article>
  );
}

/** The decision: the next move (the panel's one primary button), the PR, open questions. */
function Next({ ticket: t }: { ticket: Ticket }) {
  const events = useEvents(pathOf(t)).data ?? [];
  const repos = useProjects().data?.find((p) => p.id === t.projectId)?.repos ?? [];
  // AI-388: in Ready for review, its open PR can be merged from here, through the merge queue.
  const pr = t.stage === "ready_for_review" ? waitingPullRequest(events, repos) : null;
  const repo = pr ? repoOfPullRequest(pr.url) : null;
  return (
    <section aria-label="Next" className="space-y-2">
      <MoveControls
        ticket={t}
        aside={
          <>
            <PullRequestLink events={events} repos={repos} />
            {pr && repo && (
              <MergeButton
                projectId={t.projectId}
                repo={repo}
                number={pr.number}
                variant="outline"
              />
            )}
            {/* An epic never moves (ADR-0164), so its Definition of Ready decides nothing. */}
            {t.type !== "epic" && <Readiness {...pathOf(t)} />}
          </>
        }
      />
      {t.type !== "epic" && <ReadinessMissing {...pathOf(t)} />}
      <OpenQuestions {...pathOf(t)} />
    </section>
  );
}

type ListKey = "acceptanceCriteria" | "assumptions" | "outOfScope" | "touches";
const LIST_KEYS: readonly ListKey[] = [
  "acceptanceCriteria",
  "assumptions",
  "outOfScope",
  "touches",
];

function listLabel(t: Ticket, field: ListKey): string {
  switch (field) {
    case "acceptanceCriteria":
      // An epic's criteria are its "Done when" list (ADR-0108), as a chore's are.
      return t.type === "chore" || t.type === "epic" ? "Done when" : "Acceptance criteria";
    case "assumptions":
      return "Assumptions";
    case "outOfScope":
      return "Out of scope";
    case "touches":
      return "Touches";
  }
}

/**
 * The list fields (AI-330): one with items shows as always; empty ones fold into one "Add…"
 * row, so a bare ticket doesn't show four headings of nothing. Picking one opens it, focused;
 * a field shown once stays for this ticket, even if its last item is removed.
 */
function ListFields({ ticket: t }: { ticket: Ticket }) {
  const [opened, setOpened] = useState<{ keys: ListKey[]; focus: ListKey | null }>(() => ({
    keys: LIST_KEYS.filter((f) => t[f].length > 0),
    focus: null,
  }));
  const shown = LIST_KEYS.filter((f) => t[f].length > 0 || opened.keys.includes(f));
  const folded = LIST_KEYS.filter((f) => !shown.includes(f));
  return (
    <>
      {shown.map((f) => (
        <ListField
          key={f}
          ticket={t}
          field={f}
          label={listLabel(t, f)}
          autoFocus={opened.focus === f}
        />
      ))}
      {folded.length > 0 && (
        <div className="w-44">
          <PanelSelect
            label="Add a list"
            hideLabel
            placeholder="Add…"
            keepFocusOnPick
            value=""
            options={folded.map((f) => ({ value: f, label: listLabel(t, f) }))}
            onValueChange={(v) => {
              const f = v as ListKey;
              if (f) setOpened(({ keys }) => ({ keys: [...keys, f], focus: f }));
            }}
          />
        </div>
      )}
    </>
  );
}

function ListField({
  ticket,
  field,
  label,
  autoFocus,
}: {
  ticket: Ticket;
  field: ListKey;
  label: string;
  autoFocus: boolean;
}) {
  const s = useTicketSave(ticket, label);
  return (
    <EditableList
      label={label}
      value={ticket[field]}
      onSave={(v, done) => s.save({ [field]: v }, done)}
      pending={s.pending}
      error={s.error}
      autoFocus={autoFocus}
    />
  );
}

/** An epic's outcome: one line saying what is true when it is done (ADR-0108). */
function Outcome({ ticket: t }: { ticket: Ticket }) {
  const outcome = useTicketSave(t, "Outcome");
  return (
    <section aria-label="Outcome" className="space-y-1">
      <h3 className="text-sm font-medium">Outcome</h3>
      <InlineText
        label="Outcome"
        placeholder="What is true when this epic is done?"
        value={t.outcome ?? ""}
        onSave={(v, done) => outcome.save({ outcome: v || null }, done)}
        onEdit={outcome.begin}
        pending={outcome.pending}
        error={outcome.error}
      />
    </section>
  );
}

/**
 * The rail (AI-336): Details (type, size, epic, milestone, blocked by), then How it runs,
 * collapsed, then cancel and archive. An epic's milestone leads the panel instead.
 */
function Rail({ ticket: t }: { ticket: Ticket }) {
  const tickets = useTickets(t.projectId).data ?? [];
  const epics = tickets.filter((o) => o.type === "epic" && o.id !== t.id);
  const sizeReason = useTicketSave(t, "Size reason");

  return (
    <aside aria-label="Details" className="min-w-0 space-y-4">
      <h3 className="text-sm font-medium">Details</h3>
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
          options={[["", "No size"], ...Size.options.map((v) => [v, SIZE_LABELS[v]] as const)]}
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
        label="Epic"
        value={t.parentId ?? ""}
        options={[["", "None"], ...epics.map((e) => [e.id, `${e.key}: ${e.title}`] as const)]}
        patch={(v) => ({ parentId: v === "" ? null : v })}
      />
      {t.type !== "epic" && <TicketMilestone ticket={t} />}
      {t.type === "epic" && <NeedsCheckField ticket={t} />}
      <BlockedBy ticket={t} tickets={tickets} />
      <HowItRuns ticket={t} tickets={tickets} />
      <CancelArchiveControls ticket={t} />
    </aside>
  );
}

/** ADR-0164: with it on, the epic waits for Andy's check when its last ticket is Done. */
function NeedsCheckField({ ticket: t }: { ticket: Ticket }) {
  const s = useTicketSave(t, "Needs your check");
  return (
    <div className="space-y-1">
      <Switch
        label="Needs your check"
        description="Waits for you when its last ticket is Done"
        checked={t.needsCheck}
        disabled={s.pending}
        onCheckedChange={(on) => s.save({ needsCheck: on })}
      />
      {s.error}
    </div>
  );
}

const WORKER_LABELS: Record<Worker, string> = { agent: "Agent", me: "Mine", ask: "No worker" };

/**
 * Operating detail, collapsed (AI-336): worker, runs on, overrides and routing. The summary
 * names the current values, so it rarely needs opening.
 */
function HowItRuns({ ticket: t, tickets }: { ticket: Ticket; tickets: Ticket[] }) {
  const path = pathOf(t);
  const worker = useWorker(path).data?.worker;
  const executor = useExecutor(path).data?.executor;
  const routing = useTicketRouting(path).data;
  const overrides = Object.values(t.overrides).filter((v) => v !== undefined).length;
  const values = [
    worker && WORKER_LABELS[worker],
    executor && EXECUTOR_LABELS[executor],
    routing && `${routing.tier.value} tier`,
    routing && (routing.route.value?.model ?? "no route"),
    overrides > 0 && `${overrides} ${overrides === 1 ? "override" : "overrides"}`,
  ].filter(Boolean);
  return (
    <details aria-label="How it runs" className="group space-y-4">
      <summary className="cursor-pointer list-none space-y-0.5">
        <span className="block text-sm font-medium">
          How it runs{" "}
          <span aria-hidden className="text-muted-foreground group-open:hidden">
            ▸
          </span>
          <span aria-hidden className="hidden text-muted-foreground group-open:inline">
            ▾
          </span>
        </span>
        <span className="block text-xs text-muted-foreground">{values.join(" · ")}</span>
      </summary>
      <WorkerControl ticket={t} />
      <ExecutorControl ticket={t} />
      {/* Tier comes from size; an override pins it, on the ticket or its epic (AI-116). */}
      <OverridesEditor ticket={t} tickets={tickets} />
      <RouteLayers ticket={t} />
    </details>
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
  const s = useTicketSave(ticket, label);
  return (
    <div className="space-y-1">
      <PanelSelect
        label={label}
        value={value}
        options={options.map(([v, text]) => ({ value: v, label: text }))}
        disabled={s.pending}
        onValueChange={(v) => s.save(patch(v))}
      />
      {s.error}
    </div>
  );
}

const SIZE_LABELS: Record<Size, string> = { S: "S · small", M: "M · medium", L: "L · large" };

/**
 * Blockers are ticket keys in any project (AI-96); entries from before hold same-project ids.
 * A blocker from another project links to its own project, by its key.
 */
function BlockedBy({ ticket: t, tickets }: { ticket: Ticket; tickets: Ticket[] }) {
  const s = useTicketSave(t, "Blocked by");
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
      <PanelSelect
        label="Add a blocker"
        hideLabel
        placeholder="Add a ticket…"
        value=""
        disabled={s.pending}
        options={candidates.map((o) => ({ value: o.key, label: `${o.key}: ${o.title}` }))}
        onValueChange={(v) => v && add(v)}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ref = key.trim().toUpperCase();
          if (ref) add(ref, () => setKey(""));
        }}
      >
        <Input
          aria-label="Add a blocker from another project"
          placeholder="Or a key, e.g. OPS-12"
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

/** The Definition of Ready as a marker at the end of the action row (mockup). */
function Readiness(path: TicketPath) {
  const dor = useReadiness(path);
  if (!dor.data) return null;
  return (
    <section aria-label="Definition of Ready" className="sm:ml-auto">
      {dor.data.met ? (
        <Badge variant="success">Definition of Ready met</Badge>
      ) : (
        <Badge variant="attention">Definition of Ready: {dor.data.missing.length} missing</Badge>
      )}
    </section>
  );
}

/** What the Definition of Ready still lacks, under the action row; or why it couldn't be read. */
function ReadinessMissing(path: TicketPath) {
  const dor = useReadiness(path);
  if (showsError(dor))
    return (
      <QueryError
        error={dor.error}
        what="the Definition of Ready"
        onRetry={() => void dor.refetch()}
      />
    );
  if (!dor.data || dor.data.met) return null;
  return (
    <section aria-label="Definition of Ready missing" className="text-xs">
      <ul className="list-disc pl-4 text-muted-foreground">
        {dor.data.missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </section>
  );
}

/** Open questions lead the panel: they are what the ticket waits for. */
function OpenQuestions(path: TicketPath) {
  const questions = useTicketQuestions(path);
  const open = (questions.data ?? []).filter((q) => q.status === "open");
  if (showsError(questions))
    return (
      <QueryError
        error={questions.error}
        what="the questions"
        onRetry={() => void questions.refetch()}
      />
    );
  if (open.length === 0) return null;
  return (
    <section aria-label="Open questions" className="space-y-2">
      {open.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
    </section>
  );
}

/** Answered and dropped questions, and asking a new one; open ones lead the panel. */
function Questions(path: TicketPath) {
  const questions = useTicketQuestions(path);
  const closed = (questions.data ?? []).filter((q) => q.status !== "open");
  return (
    <section aria-label="Questions" className="space-y-2">
      <h3 className="text-sm font-medium">Questions</h3>
      {questions.isPending && <Loading />}
      {closed.map((q) => (
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

function Timeline({ path, ticket }: { path: TicketPath; ticket: Ticket }) {
  const events = useEvents(path);
  const runs = useRuns(path);
  if (events.isPending || runs.isPending) return <Loading />;
  if (events.data === undefined || showsError(events))
    return (
      <QueryError
        error={events.error}
        what="the ticket's history"
        onRetry={() => void events.refetch()}
      />
    );
  if (runs.data === undefined || showsError(runs))
    return (
      <QueryError
        error={runs.error}
        what="the ticket's agent tasks"
        onRetry={() => void runs.refetch()}
      />
    );
  return <Activity {...path} ticket={ticket} events={events.data} runs={runs.data} />;
}
