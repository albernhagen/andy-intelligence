import type { CodeHost, CodeHostConnection, CodeHostConnectionStore } from "@andy/contracts";
import { GitHubCodeHost } from "@andy/github";

/** How long a read connection is reused; Secret Manager is read at most this often. */
export const CONNECTION_CACHE_MS = 5 * 60_000;
/** "Not connected" is re-checked sooner, so another instance's new connection shows up fast. */
export const NOT_CONNECTED_CACHE_MS = 10_000;

export type CodeHostFactory = (connection: CodeHostConnection) => CodeHost;

export const gitHubCodeHost: CodeHostFactory = (c) =>
  new GitHubCodeHost({ appId: c.appId, slug: c.slug, privateKey: c.privateKey });

/**
 * The GitHub App connection (ADR-0043), read from the store and cached per instance, so a
 * webhook burst doesn't read Secret Manager per delivery. `invalidate()` after a save.
 */
export class GitHubConnection {
  private cached: { value: CodeHostConnection | null; at: number } | null = null;
  private host: { appId: string; host: CodeHost } | null = null;

  constructor(
    readonly store: CodeHostConnectionStore,
    private readonly makeHost: CodeHostFactory = gitHubCodeHost,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<CodeHostConnection | null> {
    const ttl = this.cached?.value ? CONNECTION_CACHE_MS : NOT_CONNECTED_CACHE_MS;
    if (!this.cached || this.now() - this.cached.at >= ttl) {
      this.cached = { value: await this.store.get(), at: this.now() };
    }
    return this.cached.value;
  }

  invalidate(): void {
    this.cached = null;
  }

  /** A CodeHost for the current App, or null when GitHub isn't connected. */
  async codeHost(): Promise<CodeHost | null> {
    const connection = await this.get();
    if (!connection) return null;
    if (this.host?.appId !== connection.appId) {
      this.host = { appId: connection.appId, host: this.makeHost(connection) };
    }
    return this.host.host;
  }
}

const EMPTY_LISTING = { items: [], complete: true };

/** CodeHost that follows the connection; before GitHub is connected it knows no repos. */
export class ConnectedCodeHost implements CodeHost {
  constructor(private readonly connection: GitHubConnection) {}

  async getRepo(fullName: string) {
    return (await this.connection.codeHost())?.getRepo(fullName) ?? null;
  }

  async listInstalledRepos() {
    return (await this.connection.codeHost())?.listInstalledRepos() ?? [];
  }

  async issueRepoToken(fullName: string) {
    return (await this.connection.codeHost())?.issueRepoToken(fullName) ?? null;
  }

  async dispatchWorkflow(fullName: string, workflow: string, inputs: Record<string, string>) {
    return (await this.connection.codeHost())?.dispatchWorkflow(fullName, workflow, inputs) ?? null;
  }

  async getWorkflowRun(fullName: string, runId: string) {
    return (await this.connection.codeHost())?.getWorkflowRun(fullName, runId) ?? null;
  }

  async cancelWorkflowRun(fullName: string, runId: string) {
    await (await this.connection.codeHost())?.cancelWorkflowRun(fullName, runId);
  }

  async getPullRequest(fullName: string, number: number) {
    return (await this.connection.codeHost())?.getPullRequest(fullName, number) ?? null;
  }

  async listChangedFiles(fullName: string, number: number) {
    return (await this.connection.codeHost())?.listChangedFiles(fullName, number) ?? EMPTY_LISTING;
  }

  async listHeadChecks(fullName: string, sha: string) {
    return (await this.connection.codeHost())?.listHeadChecks(fullName, sha) ?? EMPTY_LISTING;
  }

  async listRequiredChecks(fullName: string, branch: string) {
    return (await this.connection.codeHost())?.listRequiredChecks(fullName, branch) ?? [];
  }

  async listPullRequestCommits(fullName: string, number: number) {
    return (
      (await this.connection.codeHost())?.listPullRequestCommits(fullName, number) ?? EMPTY_LISTING
    );
  }

  async readFile(fullName: string, path: string, ref: string) {
    return (await this.connection.codeHost())?.readFile(fullName, path, ref) ?? null;
  }

  async mergePullRequest(fullName: string, number: number, expectedHeadSha: string) {
    const host = await this.connection.codeHost();
    if (!host) throw new Error("GitHub is not connected");
    await host.mergePullRequest(fullName, number, expectedHeadSha);
  }
}
