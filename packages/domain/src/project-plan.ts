import {
  ProjectPlanDecision,
  ProjectPlanProposal,
  WorkTrackerError,
  type EventActor,
  type PlannedMilestone,
  type Project,
  type ProjectPlan,
  type Ticket,
  type WorkTracker,
} from "@andy/contracts";
import { plainAnswer } from "./brief";
import { DomainError } from "./errors";
import { requireCan } from "./permissions";
import type { TicketService } from "./tickets";

/**
 * Project planning (AI-108, AI-65: Project planning baked into the flow). A plan is the
 * plan-project procedure's result (`platform/procedures/plan-project.md`), stored on the project
 * as a proposal; no ticket exists until Andy approves it. Approval creates one epic per
 * milestone, in order, titled `M<N>: <title>` (ADR-0060); a rejection records his reason and
 * creates nothing. Until AI-134 wires the plan-project agent task, the result is submitted by
 * the owner through the API or MCP. Re-planning an approved project is not built.
 */

export interface WaitingPlan {
  projectId: string;
  key: string;
  name: string;
  plan: ProjectPlan;
}

export class ProjectPlanService {
  private readonly deciding = new Set<string>();

  constructor(
    private readonly tracker: WorkTracker,
    private readonly tickets: Pick<TicketService, "create">,
    private readonly now: () => Date,
    /** Told when a plan starts waiting for Andy (the Needs-you email); must not throw. */
    private readonly onProposed: (
      projectId: string,
      plan: ProjectPlan,
    ) => Promise<void> = async () => {},
  ) {}

  async get(projectId: string): Promise<ProjectPlan | null> {
    return (await this.project(projectId)).projectPlan;
  }

  /** Stores a proposal for Andy. One waits at a time; an approved plan isn't replaced. */
  async propose(projectId: string, input: unknown, actor: EventActor): Promise<ProjectPlan> {
    // The proposal stands in for the plan-project agent task's result (AI-134).
    requireCan(actor, "start_run", projectId);
    const proposal = ProjectPlanProposal.parse(input);
    const project = await this.project(projectId);
    const current = project.projectPlan?.status;
    if (current === "proposed" || current === "approving") {
      throw new DomainError(
        "not_acceptable",
        `project ${project.key} already has a plan waiting for Andy: approve or reject it first`,
      );
    }
    if (current === "approved") {
      throw new DomainError(
        "not_acceptable",
        `project ${project.key} already has an approved plan`,
      );
    }
    const plan: ProjectPlan = {
      status: "proposed",
      proposal,
      proposedBy: actor,
      proposedAt: this.now().toISOString(),
      decidedBy: null,
      decidedAt: null,
      reason: null,
      epicIds: [],
    };
    await this.tracker.updateProject(projectId, { projectPlan: plan });
    log("project plan proposed", { projectId, milestones: proposal.milestones.length });
    await this.onProposed(projectId, plan);
    return plan;
  }

  /**
   * Approves (one epic per milestone, in order) or rejects with a reason (nothing created).
   * Approval is resumable: the plan is `approving` while its epics are created and records each
   * epic as it lands, so if a create fails, approving again carries on from the next milestone
   * instead of starting over. A rejection is only possible before approval starts.
   */
  async decide(
    projectId: string,
    input: ProjectPlanDecision,
    actor: EventActor,
  ): Promise<{ plan: ProjectPlan; epics: Ticket[] }> {
    requireCan(actor, "decide_plan", projectId);
    const decision = ProjectPlanDecision.parse(input);
    // One decision per project at a time in this instance (a double click, two tabs).
    if (this.deciding.has(projectId)) {
      throw new DomainError("plan_not_decidable", `a decision on ${projectId}'s plan is running`);
    }
    this.deciding.add(projectId);
    try {
      return await this.decideOnce(projectId, decision, actor);
    } finally {
      this.deciding.delete(projectId);
    }
  }

  private async decideOnce(
    projectId: string,
    decision: ProjectPlanDecision,
    actor: EventActor,
  ): Promise<{ plan: ProjectPlan; epics: Ticket[] }> {
    const project = await this.project(projectId);
    const plan = project.projectPlan;
    const resumable = plan?.status === "approving" && decision.decision === "approved";
    if (!plan || (plan.status !== "proposed" && !resumable)) {
      throw new DomainError("plan_not_decidable", `project ${project.key} has no plan to decide`);
    }
    if (decision.decision === "rejected") {
      const rejected: ProjectPlan = {
        ...plan,
        status: "rejected",
        reason: decision.reason,
        decidedBy: actor,
        decidedAt: this.now().toISOString(),
      };
      await this.tracker.updateProject(projectId, { projectPlan: rejected });
      log("project plan rejected", { projectId });
      return { plan: rejected, epics: [] };
    }
    let current: ProjectPlan =
      plan.status === "approving"
        ? plan
        : { ...plan, status: "approving", decidedBy: actor, decidedAt: this.now().toISOString() };
    if (plan.status !== "approving") {
      await this.tracker.updateProject(projectId, { projectPlan: current });
    }
    const epics: Ticket[] = [];
    // An epic created by an earlier attempt that failed before recording it is found by its
    // title and body (fixed per milestone) and recorded instead of created again.
    const existing =
      current.epicIds.length < plan.proposal.milestones.length
        ? (await this.tracker.listTickets(projectId)).filter(
            (t) => t.type === "epic" && !t.archived,
          )
        : [];
    for (const [i, milestone] of plan.proposal.milestones.entries()) {
      if (i < current.epicIds.length) continue;
      const title = `M${i + 1}: ${plainAnswer(milestone.title)}`;
      const body = epicBody(milestone);
      const found = existing.find(
        (t) => t.title === title && t.body === body && !current.epicIds.includes(t.id),
      );
      const epic =
        found ?? (await this.tickets.create(projectId, { type: "epic", title, body }, actor));
      epics.push(epic);
      current = { ...current, epicIds: [...current.epicIds, epic.id] };
      await this.tracker.updateProject(projectId, { projectPlan: current });
    }
    const done: ProjectPlan = { ...current, status: "approved" };
    await this.tracker.updateProject(projectId, { projectPlan: done });
    log("project plan approved", { projectId, epics: done.epicIds.length });
    return { plan: done, epics };
  }

  /** Every project whose plan waits for Andy, for the Needs-you inbox. */
  async waiting(): Promise<WaitingPlan[]> {
    return (await this.tracker.listProjects())
      .filter((p) => p.projectPlan?.status === "proposed" || p.projectPlan?.status === "approving")
      .map((p) => ({ projectId: p.id, key: p.key, name: p.name, plan: p.projectPlan! }));
  }

  private async project(projectId: string): Promise<Project> {
    const project = await this.tracker.getProject(projectId);
    if (!project) throw new WorkTrackerError("not_found", `project ${projectId} not found`);
    return project;
  }
}

/** An epic's body: the milestone's goal, its checks and its rough slices, one line each. */
export function epicBody(m: PlannedMilestone): string {
  const list = (items: string[]) => items.map((i) => `- ${plainAnswer(i)}`).join("\n");
  return [
    plainAnswer(m.goal),
    `**Done when**\n\n${list(m.doneWhen)}`,
    `**Rough slices** (refinement cuts the real tickets)\n\n${list(m.slices)}`,
  ].join("\n\n");
}

function log(message: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ severity: "INFO", message, component: "project-plan", ...fields }));
}
