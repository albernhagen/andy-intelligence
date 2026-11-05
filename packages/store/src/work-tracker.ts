import {
  FieldPath,
  type DocumentReference,
  type Firestore,
  type Query,
} from "@google-cloud/firestore";
import {
  ProjectPatch,
  PullRequestLink,
  WorkTrackerError,
  applyTicketChange,
  buildProject,
  buildQuestion,
  buildTicket,
  event,
  notFound,
  type AnsweredVia,
  type EventActor,
  type NewProject,
  type NewQuestion,
  type NewTicket,
  type Project,
  type Question,
  type QuestionFilter,
  type Ticket,
  type TicketChange,
  type TicketEvent,
  type TicketFilter,
  type WorkTracker,
} from "@andy/contracts";
import { collections, typedCollection } from "./index";

/** gRPC ALREADY_EXISTS, returned by `create()` on an existing document. */
const ALREADY_EXISTS = 6;

/**
 * WorkTracker on Firestore (ADR-0017). Each write and its history events commit in one
 * transaction. Queries use equality filters only, so no composite indexes are needed;
 * sorting happens in memory (single user, small collections).
 */
export class FirestoreWorkTracker implements WorkTracker {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private projects() {
    return typedCollection(this.db, collections.projects.path(), collections.projects.schema);
  }
  private tickets(projectId: string) {
    return typedCollection(
      this.db,
      collections.tickets.path(projectId),
      collections.tickets.schema,
    );
  }
  private events(projectId: string, ticketId: string) {
    return typedCollection(
      this.db,
      collections.ticketEvents.path(projectId, ticketId),
      collections.ticketEvents.schema,
    );
  }
  private questions() {
    return typedCollection(this.db, collections.questions.path(), collections.questions.schema);
  }
  /** Per-project ticket number counter; kept out of the Project schema. */
  private counter(projectId: string): DocumentReference {
    return this.db.collection("counters").doc(`tickets-${projectId}`);
  }

  async createProject(input: NewProject): Promise<Project> {
    const project = buildProject(input);
    try {
      await this.projects().doc(project.id).create(project);
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) {
        throw new WorkTrackerError("conflict", `project key already used: ${project.key}`);
      }
      throw err;
    }
    return project;
  }

  async getProject(projectId: string): Promise<Project | null> {
    return (await this.projects().doc(projectId).get()).data() ?? null;
  }

  async listProjects(): Promise<Project[]> {
    return (await this.projects().get()).docs.map((d) => d.data());
  }

  async updateProject(projectId: string, patch: ProjectPatch): Promise<Project> {
    const changes = ProjectPatch.parse(patch);
    return this.db.runTransaction(async (tx) => {
      const ref = this.projects().doc(projectId);
      const project = (await tx.get(ref)).data();
      if (!project) throw notFound("project", projectId);
      const updated = { ...project, ...changes };
      tx.set(ref, updated);
      return updated;
    });
  }

  async createTicket(projectId: string, input: NewTicket, actor: EventActor): Promise<Ticket> {
    return this.db.runTransaction(async (tx) => {
      const project = (await tx.get(this.projects().doc(projectId))).data();
      if (!project) throw notFound("project", projectId);
      const last = ((await tx.get(this.counter(projectId))).get("last") as number | undefined) ?? 0;
      const { ticket, events } = buildTicket(project, last + 1, input, actor, this.now());
      tx.set(this.counter(projectId), { last: last + 1 });
      tx.create(this.tickets(projectId).doc(ticket.id), ticket);
      for (const e of events) tx.create(this.events(projectId, ticket.id).doc(e.id), e);
      return ticket;
    });
  }

  async getTicket(projectId: string, ticketId: string): Promise<Ticket | null> {
    return (await this.tickets(projectId).doc(ticketId).get()).data() ?? null;
  }

  async listTickets(projectId: string, filter: TicketFilter = {}): Promise<Ticket[]> {
    let query: Query<Ticket> = this.tickets(projectId);
    if (filter.stage !== undefined) query = query.where("stage", "==", filter.stage);
    if (filter.needsYou !== undefined) query = query.where("needsYou", "==", filter.needsYou);
    // Older documents have no `archived` field (read as false), and an equality query on false
    // would skip them, so `archived: false` filters in memory.
    if (filter.archived === true) query = query.where("archived", "==", true);
    const tickets = (await query.get()).docs
      .map((d) => d.data())
      .filter((t) => filter.archived !== false || !t.archived);
    return tickets.sort((a, b) => a.rank.localeCompare(b.rank));
  }

  async updateTicket(
    projectId: string,
    ticketId: string,
    change: TicketChange,
    actor: EventActor,
  ): Promise<Ticket> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.tickets(projectId).doc(ticketId);
      const current = (await tx.get(ref)).data();
      if (!current) throw notFound("ticket", ticketId);
      const { ticket, events } = applyTicketChange(current, change, actor, this.now());
      if (events.length === 0) return current;
      tx.set(ref, ticket);
      for (const e of events) tx.create(this.events(projectId, ticketId).doc(e.id), e);
      return ticket;
    });
  }

  async addComment(
    projectId: string,
    ticketId: string,
    body: string,
    actor: EventActor,
  ): Promise<TicketEvent> {
    return this.db.runTransaction(async (tx) => {
      const ticket = (await tx.get(this.tickets(projectId).doc(ticketId))).data();
      if (!ticket) throw notFound("ticket", ticketId);
      const comment = event(ticket, "comment", actor, this.now(), body);
      tx.create(this.events(projectId, ticketId).doc(comment.id), comment);
      return comment;
    });
  }

  async linkPullRequest(
    projectId: string,
    ticketId: string,
    link: PullRequestLink,
    actor: EventActor,
  ): Promise<TicketEvent> {
    const data = PullRequestLink.parse(link);
    return this.db.runTransaction(async (tx) => {
      const ticket = (await tx.get(this.tickets(projectId).doc(ticketId))).data();
      if (!ticket) throw notFound("ticket", ticketId);
      const linked = event(ticket, "pr_linked", actor, this.now(), null, data);
      tx.create(this.events(projectId, ticketId).doc(linked.id), linked);
      return linked;
    });
  }

  async listEvents(projectId: string, ticketId: string): Promise<TicketEvent[]> {
    if (!(await this.getTicket(projectId, ticketId))) throw notFound("ticket", ticketId);
    // Event ids sort in write order (see eventId).
    const snap = await this.events(projectId, ticketId).orderBy(FieldPath.documentId()).get();
    return snap.docs.map((d) => d.data());
  }

  async askQuestion(
    projectId: string,
    ticketId: string,
    input: NewQuestion,
    actor: EventActor,
  ): Promise<Question> {
    return this.db.runTransaction(async (tx) => {
      const ticket = (await tx.get(this.tickets(projectId).doc(ticketId))).data();
      if (!ticket) throw notFound("ticket", ticketId);
      const at = this.now();
      const question = buildQuestion(ticket, input, at);
      const asked = event(ticket, "question_asked", actor, at, question.text, {
        questionId: question.id,
      });
      tx.create(this.questions().doc(question.id), question);
      tx.create(this.events(projectId, ticketId).doc(asked.id), asked);
      return question;
    });
  }

  async askQuestions(
    projectId: string,
    ticketId: string,
    inputs: NewQuestion[],
    actor: EventActor,
    runId?: string,
  ): Promise<Question[]> {
    return this.db.runTransaction(async (tx) => {
      const ticket = (await tx.get(this.tickets(projectId).doc(ticketId))).data();
      if (!ticket) throw notFound("ticket", ticketId);
      const at = this.now();
      const questions = inputs.map((input, index) =>
        buildQuestion(ticket, input, at, runId ? { runId, index } : null),
      );
      if (questions.length === 0) return [];
      const refs = questions.map((q) => this.questions().doc(q.id));
      if (runId) {
        // Ids derive from the run, so a replay finds them; reads come before any write.
        const existing = (await tx.getAll(...refs)).flatMap((d) => d.data() ?? []);
        if (existing.length > 0) return existing;
      }
      questions.forEach((question, i) => {
        const asked = event(ticket, "question_asked", actor, at, question.text, {
          questionId: question.id,
        });
        tx.create(refs[i]!, question);
        tx.create(this.events(projectId, ticketId).doc(asked.id), asked);
      });
      return questions;
    });
  }

  async answerQuestion(
    questionId: string,
    answer: string,
    via: AnsweredVia,
    actor: EventActor,
  ): Promise<Question> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.questions().doc(questionId);
      const question = (await tx.get(ref)).data();
      if (!question) throw notFound("question", questionId);
      if (question.status !== "open") {
        throw new WorkTrackerError("conflict", `question is ${question.status}: ${questionId}`);
      }
      const ticketRef = this.tickets(question.projectId).doc(question.ticketId);
      const ticket = (await tx.get(ticketRef)).data();
      if (!ticket) throw notFound("ticket", question.ticketId);
      const at = this.now();
      const answered: Question = {
        ...question,
        status: "answered",
        answer,
        answeredVia: via,
        answeredAt: at.toISOString(),
      };
      const e = event(ticket, "question_answered", actor, at, answer, { questionId, via });
      tx.set(ref, answered);
      tx.create(this.events(ticket.projectId, ticket.id).doc(e.id), e);
      return answered;
    });
  }

  async withdrawQuestion(questionId: string, actor: EventActor): Promise<Question> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.questions().doc(questionId);
      const question = (await tx.get(ref)).data();
      if (!question) throw notFound("question", questionId);
      if (question.status !== "open") {
        throw new WorkTrackerError("conflict", `question is ${question.status}: ${questionId}`);
      }
      const ticketRef = this.tickets(question.projectId).doc(question.ticketId);
      const ticket = (await tx.get(ticketRef)).data();
      if (!ticket) throw notFound("ticket", question.ticketId);
      const withdrawn: Question = { ...question, status: "withdrawn" };
      const e = event(ticket, "question_withdrawn", actor, this.now(), null, { questionId });
      tx.set(ref, withdrawn);
      tx.create(this.events(ticket.projectId, ticket.id).doc(e.id), e);
      return withdrawn;
    });
  }

  async getQuestion(questionId: string): Promise<Question | null> {
    return (await this.questions().doc(questionId).get()).data() ?? null;
  }

  async listQuestions(filter: QuestionFilter = {}): Promise<Question[]> {
    let query: Query<Question> = this.questions();
    if (filter.projectId !== undefined) query = query.where("projectId", "==", filter.projectId);
    if (filter.ticketId !== undefined) query = query.where("ticketId", "==", filter.ticketId);
    if (filter.status !== undefined) query = query.where("status", "==", filter.status);
    const questions = (await query.get()).docs.map((d) => d.data());
    return questions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
