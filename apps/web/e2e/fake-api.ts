import { InMemoryRunStore, InMemoryWorkTracker } from "@andy/contracts";
import { TicketService } from "@andy/domain";
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
        "Picking a project should feel like picking a tenant.",
      ),
      ...ready,
    },
    "andy",
  );
  await service.move("ai", shell.id, "ready", "andy");
  await service.move("ai", shell.id, "in_progress", "andy");

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
  await service.create("ai", { type: "chore", title: "Command palette", body: "" }, "andy");
  const model = await service.create(
    "ai",
    { ...feature("Ticket model v2", "Shortcut-style types and fields."), ...ready },
    "andy",
  );
  await service.move("ai", model.id, "ready", "andy");

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
    runs: new InMemoryRunStore(() => NOW),
  });
}
