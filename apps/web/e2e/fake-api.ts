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
  tier: "strong" as const,
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

  const story = (title: string, body = "") => ({ type: "story" as const, title, body });
  const shell = await service.create(
    "ai",
    {
      ...story(
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

  const panel = await service.create("ai", story("Story side panel"), "andy");
  await service.ask("ai", panel.id, { text: "Should Esc close the panel?" }, "agent");
  await service.create("ai", { type: "task", title: "Command palette", body: "" }, "andy");
  const model = await service.create(
    "ai",
    { ...story("Ticket model v2", "Shortcut-style types and fields."), ...ready },
    "andy",
  );
  await service.move("ai", model.id, "ready", "andy");

  const backups = await service.create(
    "ops",
    { type: "task", title: "Nightly backups", body: "" },
    "andy",
  );
  await service.ask("ops", backups.id, { text: "Keep backups for 7 or 30 days?" }, "agent");

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
