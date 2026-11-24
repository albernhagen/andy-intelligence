import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Outlet, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SlidersHorizontal } from "lucide-react";
import { Stage, type BoardTicket, type ReadyFilters } from "@andy/contracts";
import {
  boardStages,
  matchesReadyFilters,
  milestoneOf,
  parseWorkView,
  sortByStartScore,
  needsYouParts,
  workViewCounts,
  workViews,
  type WorkView,
} from "@andy/domain";
import { BoardCard } from "@/components/board/BoardCard";
import { BoardDispatchStatus } from "@/components/DispatchControls";
import { IdeateForm } from "@/components/IdeateForm";
import { EpicControls } from "@/components/board/EpicControls";
import { WorkViewChips, WorkViewMenu } from "@/components/board/WorkViewChips";
import {
  EpicGroupHeader,
  Lane,
  LaneZone,
  ReadyFilterMenu,
  ReadySortToggle,
} from "@/components/board/Lane";
import { readySearch } from "@/lib/ready";
import { QueryError } from "@/components/Status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  COLLAPSED_STAGES,
  IDEAS_ZONE,
  UP_NEXT_ZONE,
  isBacklogZone,
  nextUp,
  openBlockers,
  openingStage,
  planDrop,
  planUpNextDrop,
  splitBacklog,
} from "@/lib/board";
import {
  boardEpics,
  epicProgress,
  type EpicGroup,
  groupByEpic,
  inEpic,
  loadGroupByEpic,
  sameGroup,
  saveGroupByEpic,
} from "@/lib/board-groups";
import {
  useBoard,
  useBoardMove,
  useMilestones,
  useQuickAdd,
  useRankTicket,
  useSetUpNext,
} from "@/lib/queries";
import { STAGE_LABELS, dropMove, groupByStage, visibleTickets } from "@/lib/tickets";
import { showsError } from "@/lib/live";
import { useIsPhone } from "@/lib/use-phone";
import { Segmented } from "@/components/ui/segmented";

/**
 * Board v2 (AI-28; ADR-0059 row "Board"): one swim lane per stage, cards with status markers,
 * Ready as a numbered queue with the next card marked. Drag within a lane to reorder (the order
 * is the priority, ADR-0058), across lanes to move: an allowed transition is a normal move, any
 * other a forced one (ADR-0057). Backlog has two parts (ADR-0075): a drop into Up next starts refine, Ideas costs nothing. Moves and reorders show at once and roll back with the API's
 * message on the card. Group by epic (AI-86) puts a header per epic inside each lane; the epic
 * filter shows one epic's tickets. Work view chips (AI-187) narrow it to one fixed view, kept in
 * the URL (`?view=`); both filters combine. Child routes (the ticket panel) render in the Outlet.
 * On a phone (AI-337) the board shows one stage at a time under stage tabs, the chips become one
 * View menu and the other controls fold under Options; moving between stages is the panel's Move.
 */
export function BoardPage() {
  const { projectId } = useParams({ from: "/p/$projectId" });
  const board = useBoard(projectId);
  const [showArchived, setShowArchived] = useState(false);
  const search = useSearch({ from: "/p/$projectId" });
  const { sort } = search;
  const filters = readySearch(search);
  // Parsed again here: the router keeps unknown values in the URL, and they mean all tickets.
  const view = parseWorkView(search.view);
  const navigate = useNavigate({ from: "/p/$projectId" });
  const [grouped, setGrouped] = useState(loadGroupByEpic);
  const [chosenEpic, setChosenEpic] = useState<string | null>(null);
  const [ideating, setIdeating] = useState(false);
  const isPhone = useIsPhone();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const epics = useMemo(() => boardEpics(board.data ?? []), [board.data]);
  // An epic that left the board (another project's data, or deleted) stops filtering.
  const epicId = epics.some((e) => e.id === chosenEpic) ? chosenEpic : null;
  const tickets = useMemo(
    () => (board.data ? visibleTickets(board.data, showArchived) : []),
    [board.data, showArchived],
  );
  const allById = useMemo(() => new Map((board.data ?? []).map((t) => [t.id, t])), [board.data]);
  // Counts follow the epic filter, so a chip's number is what clicking it shows.
  const inScope = useMemo(() => tickets.filter((t) => inEpic(t, epicId)), [tickets, epicId]);
  const counts = useMemo(() => workViewCounts(inScope, allById), [inScope, allById]);
  const needsYou = useMemo(() => needsYouParts(inScope), [inScope]);
  // Folded under Options on a phone, a filter on still shows: its count on the button.
  const optionsOn = [epicId !== null, grouped, showArchived].filter(Boolean).length;
  const pickView = (next: WorkView | null) =>
    void navigate({ search: { sort, ...filters, view: next ?? undefined } });

  const chips = board.data && !isPhone && (
    <WorkViewChips
      view={view}
      counts={counts}
      needsYou={needsYou}
      total={inScope.length}
      onChange={pickView}
    />
  );

  return (
    <section className="space-y-4 max-sm:space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Title and work views share one row, as in the approved board mockup (AI-374). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-lg font-semibold">
            Board <BoardDispatchStatus projectId={projectId} />
          </h2>
          {chips}
        </div>
        {isPhone && (
          <div className="flex items-center gap-2">
            {board.data && (
              <WorkViewMenu
                view={view}
                counts={counts}
                needsYou={needsYou}
                total={inScope.length}
                onChange={pickView}
              />
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 min-w-11 gap-1 px-2"
              aria-label={optionsOn ? `Options, ${optionsOn} on` : "Options"}
              aria-expanded={optionsOpen}
              onClick={() => setOptionsOpen((open) => !open)}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              {optionsOn > 0 && <span className="tabular-nums">{optionsOn}</span>}
            </Button>
          </div>
        )}
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${isPhone ? (optionsOpen ? "w-full" : "hidden") : ""}`}
        >
          <EpicControls
            epics={epics}
            grouped={grouped}
            onGroupedChange={(on) => {
              setGrouped(on);
              saveGroupByEpic(on);
            }}
            epicId={epicId}
            onEpicChange={setChosenEpic}
          />
          <Switch
            label="Show cancelled and archived"
            checked={showArchived}
            onCheckedChange={setShowArchived}
          />
          {/* AI-299: an idea into an epic in Ideas, as MCP `ideate`; outline, not the primary. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 sm:h-8"
            aria-expanded={ideating}
            onClick={() => setIdeating((open) => !open)}
          >
            Ideate
          </Button>
        </div>
      </div>

      {ideating && <IdeateForm projectId={projectId} onClose={() => setIdeating(false)} />}
      {board.isPending && <BoardSkeleton />}
      {showsError(board) && (
        <QueryError error={board.error} what="the board" onRetry={() => void board.refetch()} />
      )}
      {board.data && (
        <Lanes
          tickets={tickets}
          showCancelled={showArchived}
          projectId={projectId}
          sortedByScore={sort === "score"}
          filters={filters}
          all={board.data}
          grouped={grouped}
          epicId={epicId}
          view={view}
          phone={isPhone}
        />
      )}
      {board.data && !isPhone && <KeyHints />}
      <Outlet />
    </section>
  );
}

/** The board's shape while it loads (design.md "Feedback components"): four lanes of cards. */
export function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading the board" className="flex gap-3">
      {[3, 2, 2, 1].map((cards, lane) => (
        <div
          key={lane}
          data-slot="lane-skeleton"
          className="flex w-64 shrink-0 flex-col gap-1.5 rounded-lg border border-border bg-muted p-2 xl:w-auto xl:flex-1 max-sm:w-full max-sm:[&:not(:first-child)]:hidden"
        >
          <Skeleton className="h-6 w-24 bg-foreground/10" />
          {Array.from({ length: cards }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg bg-raised" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The keys that work on the board (design.md "Keyboard"): `j`/`k` and Enter from the shortcut
 * layer, Space and the arrows from the drag sensor. Only keys that exist are listed.
 */
export function KeyHints() {
  return (
    <p
      aria-label="Board keys"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground"
    >
      <Kbd>J</Kbd>
      <Kbd>K</Kbd> card ·<Kbd>↵</Kbd> open ·<Kbd>Space</Kbd> pick up, arrows move,
      <Kbd>Space</Kbd> drop ·<Kbd>Esc</Kbd> cancel
    </p>
  );
}

/** Space picks a card up and drops it; Enter stays free to open the ticket link. */
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space"] };

function Lanes({
  tickets,
  showCancelled,
  projectId,
  sortedByScore,
  filters,
  all,
  grouped,
  epicId,
  view,
  phone,
}: {
  tickets: BoardTicket[];
  showCancelled: boolean;
  projectId: string;
  sortedByScore: boolean;
  /** The Ready lane's size, risk and confidence filters (AI-343); they hide cards only. */
  filters: ReadyFilters;
  /** Every ticket the board read returned, archived ones too: epics and their progress. */
  all: readonly BoardTicket[];
  grouped: boolean;
  /** Show only this epic's children; null shows every ticket. */
  epicId: string | null;
  /** Show only the tickets in this work view; null shows every ticket. */
  view: WorkView | null;
  /** One stage at a time, picked by tabs (AI-337). */
  phone: boolean;
}) {
  const navigate = useNavigate({ from: "/p/$projectId" });
  const move = useBoardMove(projectId);
  const rank = useRankTicket(projectId);
  const setUpNext = useSetUpNext(projectId);
  // Group headers show each epic's milestone (AI-311); read only while grouped.
  const milestones = useMilestones(projectId, grouped).data;
  // A drop shows at once: the card's new stage and rank until the API answers.
  const [pending, setPending] = useState<
    Record<string, { stage: Stage; rank: string; upNextRank: string | null }>
  >({});
  // One error per card, so a quick second drop can't hide the first one's failure.
  const [errors, setErrors] = useState<Record<string, Error>>({});
  const [expanded, setExpanded] = useState<Stage[]>([]);
  const [overLane, setOverLane] = useState<Stage | null>(null);
  const stages = boardStages(showCancelled);
  // Picked once, when the board first loads, from the tickets the filters show; a tab click
  // changes it after that.
  const [phoneStage, setPhoneStage] = useState<Stage>(() => {
    const byId = new Map(all.map((a) => [a.id, a]));
    return openingStage(stages, tickets, (t) => {
      const views = workViews(t, byId);
      return views.includes("needs-me") && inEpic(t, epicId) && (!view || views.includes(view));
    });
  });
  // Cancelled can be hidden again while picked.
  const shownStage = stages.includes(phoneStage) ? phoneStage : "in_progress";
  const suppressDropClick = useDropClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );

  const shown = useMemo(
    () => tickets.map((t) => (pending[t.id] ? { ...t, ...pending[t.id] } : t)),
    [tickets, pending],
  );
  const lanes = groupByStage(shown);
  const byId = useMemo(() => new Map(shown.map((t) => [t.id, t])), [shown]);
  const allById = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);
  // A filter hides cards only: drops still plan against whole lanes, as with the epic filter.
  const inView = (t: BoardTicket) => !view || workViews(t, allById).includes(view);
  const next = nextUp(
    lanes.ready.filter((t) => t.summary.worker === "agent"),
    byId,
  );
  // A view only: `lanes.ready` stays the queue, for drops, card numbers and the Next marker.
  const readyShown = sortedByScore ? sortByStartScore(lanes.ready) : lanes.ready;
  const shownIn = (stage: Stage) => (stage === "ready" ? readyShown : lanes[stage]);
  const now = Date.now();
  // Ungrouped is one group with no header.
  const groupCards = (cards: BoardTicket[]): EpicGroup<BoardTicket>[] =>
    grouped ? groupByEpic(cards, allById) : [{ epic: null, cards }];

  function laneOf(id: string | number | undefined): Stage | null {
    if (typeof id === "string" && isBacklogZone(id)) return "backlog";
    const stage = Stage.safeParse(id);
    return stage.success ? stage.data : (byId.get(String(id))?.stage ?? null);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setOverLane(null);
    const ticket = byId.get(String(active.id));
    if (!ticket || !over) return;
    // Grouped, a drop on a card under another epic's header in the same lane part would reorder
    // the lane but leave the card where it is: nothing happens. Moving between epics isn't a drag.
    const overCard = byId.get(String(over.id));
    if (
      grouped &&
      overCard &&
      overCard.stage === ticket.stage &&
      (overCard.upNextRank === null) === (ticket.upNextRank === null) &&
      !sameGroup(ticket, overCard, allById)
    )
      return;
    // Sorted by score, a card's place isn't its queue place: a drop on Ready means the lane (the
    // end of the queue, or nothing for a card already there) and never reorders it.
    const overId = sortedByScore && laneOf(over.id) === "ready" ? "ready" : String(over.id);
    const upNextPlan = planUpNextDrop(lanes.backlog, ticket, overId);
    // Ideas keep their own order: Up-next cards never count as neighbours.
    const ideas = splitBacklog(lanes.backlog).ideas;
    const ideaLanes = { ...lanes, backlog: ideas };
    const zoneTarget = overId === IDEAS_ZONE ? ideas[0]?.id : undefined;
    const lanePlan = zoneTarget
      ? planDrop(ideaLanes, ticket, zoneTarget)
      : isBacklogZone(overId)
        ? { to: "backlog" as const, rank: null }
        : planDrop(ideaLanes, ticket, overId);
    if (!lanePlan && !upNextPlan) return;
    // Up next has its own order; the lane rank is left alone by a drop there.
    const plan = upNextPlan ? { to: "backlog" as const, rank: null } : lanePlan!;
    if (plan.to === ticket.stage && !plan.rank && !upNextPlan) return;
    const stageMove = plan.to === ticket.stage ? null : dropMove(ticket.stage, plan.to);
    if (plan.to !== ticket.stage && !stageMove) return;

    const id = ticket.id;
    setErrors(({ [id]: _, ...rest }) => rest);
    setPending((p) => ({
      ...p,
      [id]: {
        stage: plan.to,
        rank: plan.rank ?? ticket.rank,
        upNextRank: upNextPlan
          ? upNextPlan.upNext
            ? (upNextPlan.rank ?? "9999999999")
            : null
          : plan.to === "backlog"
            ? ticket.upNextRank
            : null,
      },
    }));
    // mutateAsync, not mutate's per-call callbacks: those only fire for the latest call. Each
    // write refetches the board before it resolves, so dropping the pending entry shows the
    // API's state: the new place, or the old one after a refusal.
    try {
      if (stageMove) await move.mutateAsync({ ticketId: id, ...stageMove });
      if (plan.rank) await rank.mutateAsync({ ticketId: id, rank: plan.rank });
      if (upNextPlan) await setUpNext.mutateAsync({ ticketId: id, ...upNextPlan });
    } catch (error) {
      setErrors((e) => ({ ...e, [id]: error as Error }));
    } finally {
      setPending(({ [id]: _, ...rest }) => rest);
    }
  }

  const lanesByStage = stages.map((stage) => {
    const collapsible = !phone && COLLAPSED_STAGES.includes(stage);
    const collapsed = collapsible && !expanded.includes(stage);
    const toggle = () =>
      setExpanded((e) => (e.includes(stage) ? e.filter((s) => s !== stage) : [...e, stage]));
    const card = (t: BoardTicket) => (
      <BoardCard
        key={t.id}
        ticket={t}
        projectId={projectId}
        blockers={openBlockers(t, byId)}
        position={stage === "ready" ? lanes.ready.indexOf(t) + 1 : null}
        next={t.id === next?.id}
        now={now}
        error={errors[t.id] ?? null}
      />
    );
    // Backlog shows two parts (Up next, then Ideas); each is grouped on its own.
    const split = stage === "backlog" ? splitBacklog(lanes.backlog) : null;
    const parts = (split ? [split.upNext, split.ideas] : [shownIn(stage)]).map((cards) =>
      groupCards(
        cards.filter(
          (t) =>
            inEpic(t, epicId) &&
            inView(t) &&
            (stage !== "ready" || matchesReadyFilters(t, filters)),
        ),
      ),
    );
    // `ids` follows the order shown, so dnd-kit sorts what you see.
    const ordered = parts.flat().flatMap((g) => g.cards);
    const list = (groups: EpicGroup<BoardTicket>[]) =>
      groups.map(({ epic, cards }) => (
        <Fragment key={epic?.id ?? "none"}>
          {grouped && (
            <EpicGroupHeader
              epic={epic}
              progress={epic ? epicProgress(epic.id, all) : null}
              milestone={epic ? milestones?.find((m) => m.id === milestoneOf(epic, all)) : null}
            />
          )}
          {cards.map(card)}
        </Fragment>
      ));
    const count = (groups: EpicGroup<BoardTicket>[]) =>
      groups.reduce((n, g) => n + g.cards.length, 0);
    const lane = (
      <Lane
        key={stage}
        stage={stage}
        ids={ordered.map((t) => t.id)}
        collapsed={collapsed}
        onToggle={collapsible ? toggle : undefined}
        highlight={overLane === stage}
        fill={phone}
        top={
          stage === "backlog" ? (
            <QuickAdd projectId={projectId} />
          ) : stage === "ready" ? (
            <div className="flex flex-wrap items-center gap-2">
              <ReadySortToggle
                sorted={sortedByScore}
                onToggle={() =>
                  void navigate({
                    search: {
                      ...filters,
                      view: view ?? undefined,
                      sort: sortedByScore ? undefined : "score",
                    },
                  })
                }
              />
              {/* The same filters as MCP list_ready (AI-343: the Ready page's, moved here). */}
              <ReadyFilterMenu
                filters={filters}
                onChange={(next) =>
                  void navigate({
                    search: {
                      sort: sortedByScore ? "score" : undefined,
                      view: view ?? undefined,
                      ...next,
                    },
                  })
                }
              />
            </div>
          ) : undefined
        }
      >
        {!collapsed && split && (
          <>
            <LaneZone
              id={UP_NEXT_ZONE}
              label="Up next"
              count={count(parts[0]!)}
              hint="Drag a ticket here to start refine."
            />
            {list(parts[0]!)}
            <LaneZone id={IDEAS_ZONE} label="Ideas" count={count(parts[1]!)} />
            {list(parts[1]!)}
          </>
        )}
        {!collapsed && !split && list(parts[0]!)}
      </Lane>
    );
    return { stage, count: ordered.length, lane };
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ activatorEvent }: DragStartEvent) => {
        // A keyboard drag ends with Space, which never clicks the link.
        if (!(activatorEvent instanceof KeyboardEvent)) suppressDropClick();
      }}
      onDragOver={({ over }: DragOverEvent) => setOverLane(laneOf(over?.id))}
      onDragCancel={() => setOverLane(null)}
      onDragEnd={(e) => void onDragEnd(e)}
    >
      {phone && (
        <Segmented
          label="Stages"
          value={shownStage}
          className="relative flex-nowrap overflow-x-auto [scrollbar-width:none]"
          options={lanesByStage.map(({ stage, count }) => ({
            value: stage,
            label: (
              <>
                {STAGE_LABELS[stage]} <span className="tabular-nums">{count}</span>
              </>
            ),
          }))}
          onChange={setPhoneStage}
        />
      )}
      {/* relative: keeps the lanes' sr-only text inside this scroller (AI-325) */}
      <div className="relative flex items-stretch gap-3 overflow-x-auto pb-2">
        {lanesByStage.filter(({ stage }) => !phone || stage === shownStage).map((l) => l.lane)}
      </div>
    </DndContext>
  );
}

/** Type a title, press Enter: the ticket lands in Ideas; nothing runs until it moves to Up next. */
function QuickAdd({ projectId }: { projectId: string }) {
  const add = useQuickAdd(projectId);
  const [title, setTitle] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || add.isPending) return;
    add.mutate(t, { onSuccess: () => setTitle("") });
  }

  return (
    <form onSubmit={submit} className="space-y-1">
      <Input
        aria-label="Add a ticket"
        placeholder="Add a ticket"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={add.isPending}
        className="h-11 text-base sm:h-8 sm:text-sm"
      />
      {add.error && <QueryError error={add.error} />}
    </form>
  );
}

/**
 * A mouse or touch drag ends with a click on the card's link (AI-25). dnd-kit stops that click's
 * propagation at the document, so a React onClick never sees it and the browser follows the
 * href. A capture listener on window runs before dnd-kit's and cancels the click's default;
 * TanStack's Link skips navigation for a default-prevented click too. The flag lasts until that
 * click or the next pointer press, not a timer. Returns the function that arms it.
 */
function useDropClickSuppression() {
  const armed = useRef(false);
  useEffect(() => {
    function onClick(e: globalThis.MouseEvent) {
      if (!armed.current) return;
      armed.current = false;
      // detail 0 is Enter on the link (a touch drop leaves no click behind): let it open.
      if (e.detail > 0) e.preventDefault();
    }
    function disarm() {
      armed.current = false;
    }
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", disarm, true);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", disarm, true);
    };
  }, []);
  return () => (armed.current = true);
}
