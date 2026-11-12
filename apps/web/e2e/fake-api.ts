import {
  InMemoryConfigChangeStore,
  InMemoryNightLaunchStore,
  InMemoryRunStore,
  InMemoryWorkTracker,
} from "@andy/contracts";
import type { NewTicket, Stage } from "@andy/contracts";
import { TicketService, rankBetween } from "@andy/domain";
import { createApp } from "@andy/api/app";
import { E2E_TOKEN } from "./token";

/** A fixed clock, so history timestamps (and the screenshots) never change. */
const NOW = new Date("2026-11-04T15:00:00.000Z");

const ready = {
  acceptanceCriteria: ["When Andy opens the app, the system shall show the project picker."],
  size: "M" as const,
  sizeReason: "A layout, routes and a CI job.",
};

/**
 * The real API (createApp) over in-memory fakes, seeded with two projects, tickets across the
 * stages and open questions. Served by e2e/vite.config.ts for the Playwright screenshot checks.
 */
export async function createFakeApp() {
  const tracker = new InMemoryWorkTracker(() => NOW);
  const runs = new InMemoryRunStore(() => NOW);
  const service = new TicketService(tracker);
  await tracker.createProject({
    name: "Andy Intelligence",
    key: "AI",
    repos: ["albernhagen/andy-intelligence"],
  });
  await tracker.createProject({ name: "Ops", key: "OPS" });

  const feature = (title: string, body = "") => ({ type: "feature" as const, title, body });
  const shell = await service.create(
    "ai",
    {
      ...feature(
        "Design source and app shell",
        [
          "Picking a project should feel like picking a tenant.",
          "",
          "## Shape",
          "",
          "- One **shell** on every screen, with the project picker",
          "- Tokens in `index.css`; see [the design source](https://github.com/albernhagen/andy-intelligence/blob/main/apps/web/design.md)",
        ].join("\n"),
      ),
      ...ready,
      outOfScope: ["Dashboards", "Command palette"],
      touches: ["apps/web/src/components/AppShell.tsx", "apps/web/design.md"],
    },
    "andy",
  );
  await service.move("ai", shell.id, "ready", "andy");
  await service.move("ai", shell.id, "in_progress", "andy");
  await tracker.linkPullRequest(
    "ai",
    shell.id,
    { number: 72, url: "https://github.com/albernhagen/andy-intelligence/pull/72", state: "open" },
    "system",
  );
  await service.comment("ai", shell.id, "Screenshots look right. **Ship it** after CI.", "andy");

  const drop = await service.create(
    "ai",
    {
      type: "bug",
      title: "Dropping a card opens the ticket",
      body: "Releasing a dragged card navigates to it.",
      ...ready,
      size: "S",
    },
    "andy",
  );
  await service.move("ai", drop.id, "ready", "andy");
  await service.move("ai", drop.id, "in_progress", "andy");
  await service.move("ai", drop.id, "ready_for_review", "andy");

  const panel = await service.create("ai", feature("Story side panel"), "andy");
  await service.ask("ai", panel.id, { text: "Should Esc close the panel?" }, "agent");
  const palette = await service.create(
    "ai",
    { type: "chore", title: "Command palette", body: "" },
    "andy",
  );
  const model = await service.create(
    "ai",
    { ...feature("Ticket model v2", "Shortcut-style types and fields."), ...ready },
    "andy",
  );
  await service.move("ai", model.id, "ready", "andy");

  await seedBoardMarkers(service, tracker, runs, { panel: panel.id, palette: palette.id, model });

  // OPS: a busy inbox (AI-30): four tickets, five questions, one stale.
  const backups = await service.create(
    "ops",
    { type: "chore", title: "Nightly backups", body: "" },
    "andy",
  );
  await service.ask(
    "ops",
    backups.id,
    {
      text: "Keep backups for 7 or 30 days?",
      options: ["7 days", "30 days"],
      suggestedAnswer: "30 days",
      assumptions: ["Backups go to the bucket used today."],
    },
    "agent",
  );
  const key = await service.create(
    "ops",
    {
      type: "chore",
      title: "Rotate the deploy key",
      body: "The deploy key has never been rotated.",
      acceptanceCriteria: ["Done when the key rotates on a schedule."],
      size: "S",
      sizeReason: "One scheduled job.",
    },
    "andy",
  );
  await service.ask(
    "ops",
    key.id,
    {
      text: "Rotate every 90 days or on every release?",
      options: ["Every 90 days", "Every release"],
      suggestedAnswer: "Every 90 days",
      assumptions: ["Only CI uses the key."],
      urgency: "high",
    },
    "agent",
  );
  await service.ask(
    "ops",
    key.id,
    {
      text: "Who gets the alert when a rotation fails?",
      options: ["Andy", "Nobody"],
      suggestedAnswer: "Andy",
    },
    "agent",
  );
  const alerts = await service.create(
    "ops",
    {
      type: "bug",
      title: "Alert e-mails arrive twice",
      body: "Every alert sends two e-mails.",
      ...ready,
      size: "S",
    },
    "andy",
  );
  await service.move("ops", alerts.id, "ready", "andy");
  await service.move("ops", alerts.id, "in_progress", "andy");
  await service.ask(
    "ops",
    alerts.id,
    { text: "Can the old alert rule be deleted?", options: ["Yes", "No"] },
    "agent",
  );
  const logs = await service.create(
    "ops",
    { type: "chore", title: "Move logs to the new bucket", body: "" },
    "andy",
  );
  await service.move("ops", logs.id, "done", "andy", { force: true });
  await service.ask("ops", logs.id, { text: "Delete the old bucket too?" }, "agent");
  await seedEpic(service);

  return createApp({
    verifier: {
      async verify(token) {
        if (token !== E2E_TOKEN) throw new Error("bad token");
        return { uid: "andy", email: "andy@example.com", emailVerified: true };
      },
    },
    allowedEmails: new Set(["andy@example.com"]),
    version: "e2e",
    webConfig: { firebaseApiKey: "k", firebaseAuthDomain: "d", projectId: "p" },
    tracker,
    runs,
    // ADR-0097: no findings, so a project inbox shows the empty "Config proposals" row.
    configChanges: new InMemoryConfigChangeStore(),
    nightLaunches: new InMemoryNightLaunchStore(),
  });
}

const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const route = { harness: "claude-code", provider: "claude-sub", model: "sonnet" } as const;

/**
 * AI-28: Board v2: tickets that put every card marker on the board: no type, a run in flight
 * (refine and build), a PR in each state, a blocked Ready card ranked above the next one, and
 * two Done tickets for the strip (no Monitoring stage until M6, ADR-0069). Nothing here flags a ticket or asks a question, so the
 * inbox and ticket page screenshots don't change.
 */
async function seedBoardMarkers(
  service: TicketService,
  tracker: InMemoryWorkTracker,
  runs: InMemoryRunStore,
  {
    panel,
    palette,
    model,
  }: { panel: string; palette: string; model: { id: string; rank: string } },
) {
  const startRun = async (ticketId: string, step: "refine" | "build", minutes: number) => {
    const run = await runs.create({ projectId: "ai", ticketId, step, route, tier: null });
    // A fixed branch: the real one ends in the run's random id, which would change the screenshots.
    const branch = step === "build" ? "agent/AI-7/seeded-run" : null;
    await runs.update(run.id, { status: "running", startedAt: minutesAgo(minutes), branch }, [
      "queued",
    ]);
  };
  const at = async (stage: Stage, fields: NewTicket) => {
    const t = await service.create("ai", fields, "andy");
    await service.move("ai", t.id, stage, "andy", { force: true });
    return t;
  };
  const pr = (ticketId: string, number: number, state: "open" | "merged" | "closed") =>
    tracker.linkPullRequest(
      "ai",
      ticketId,
      { number, url: `https://github.com/albernhagen/andy-intelligence/pull/${number}`, state },
      "system",
    );

  await startRun(panel, "refine", 1);

  const epics = await at("ready", {
    ...ready,
    type: "feature",
    title: "Epic grouping on the board",
    blockedBy: [palette],
  });
  // Blocked and first in the queue, so "Next" goes to the ticket below it.
  await service.update("ai", epics.id, { rank: rankBetween(null, model.rank) }, "andy");

  const cost = await at("in_progress", { ...ready, type: "feature", title: "Run cost on cards" });
  await startRun(cost.id, "build", 12);

  const scroll = await at("ready_for_review", {
    ...ready,
    type: "bug",
    title: "Inbox loses its scroll position",
  });
  await pr(scroll.id, 61, "closed");
  await pr(scroll.id, 62, "open");

  const auto = await at("done", {
    ...ready,
    type: "chore",
    title: "Refine starts on its own",
  });
  await pr(auto.id, 58, "merged");
  const core = await at("done", { ...ready, type: "feature", title: "Ticket core" });
  await pr(core.id, 40, "merged");

  await service.create("ai", { title: "Keyboard shortcuts" }, "andy");
}

/**
 * AI-86: Board: group by epic: an OPS epic with children in three lanes, one Done, for the
 * grouped-board screenshot. OPS, not AI, so the AI board and story panel screenshots don't
 * change; nothing here asks a question, so the inbox doesn't either.
 */
async function seedEpic(service: TicketService) {
  const epic = await service.create(
    "ops",
    { type: "epic", title: "Backups you can trust", body: "" },
    "andy",
  );
  const child = async (stage: Stage, fields: NewTicket) => {
    const t = await service.create("ops", { ...ready, ...fields, parentId: epic.id }, "andy");
    await service.move("ops", t.id, stage, "andy", { force: true });
  };
  await child("ready", { type: "chore", title: "Monthly restore drill" });
  await child("in_progress", { type: "feature", title: "Alert when a backup fails" });
  await child("done", { type: "chore", title: "Backups to a second region" });
}
