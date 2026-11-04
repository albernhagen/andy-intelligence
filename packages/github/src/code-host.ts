import {
  Repo,
  RepoName,
  RepoToken,
  WorkflowDispatch,
  WorkflowRun,
  type CheckConclusion,
  type CodeHost,
} from "@andy/contracts";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

export interface GitHubAppCredentials {
  appId: string;
  /** App slug, for the git author name `<slug>[bot]`. */
  slug: string;
  /** PEM private key of the GitHub App (Secret Manager in prod; ADR-0043). */
  privateKey: string;
}

/** A workflow file name in `.github/workflows/`, e.g. `agent-run.yml`. */
const WORKFLOW_FILE = /^[A-Za-z0-9._-]{1,100}\.ya?ml$/;

const CONCLUSIONS: readonly string[] = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
];
const toConclusion = (c: string): CheckConclusion =>
  (CONCLUSIONS.includes(c) ? c : "other") as CheckConclusion;

/** Caps on listing (ADR-0028): installations scanned and repos returned. */
const MAX_INSTALLATIONS = 10;
const MAX_REPOS = 100;

type GitHubRepo = { full_name: string; default_branch: string; private: boolean; html_url: string };

const toRepo = (r: GitHubRepo) =>
  Repo.parse({
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    url: r.html_url,
  });

/**
 * CodeHost on a GitHub App. App-level calls use the App's JWT; repo reads use a short-lived
 * installation token (cached by @octokit/auth-app until shortly before it expires).
 */
export class GitHubCodeHost implements CodeHost {
  private readonly octokit: Octokit;
  private readonly request: { fetch?: typeof fetch; timeout: number };

  constructor(
    private readonly credentials: GitHubAppCredentials,
    /** Test seam: a fetch stand-in. */
    fetchImpl?: typeof fetch,
  ) {
    this.request = { ...(fetchImpl ? { fetch: fetchImpl } : {}), timeout: 10_000 };
    this.octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: credentials.appId, privateKey: credentials.privateKey },
      request: this.request,
    });
  }

  async getRepo(fullName: string): Promise<Repo | null> {
    const installationId = await this.installationFor(fullName);
    if (installationId === null) return null;
    const [owner, repo] = fullName.split("/") as [string, string];
    const res = await this.notFoundAsNull(async () =>
      (await this.asInstallation(installationId)).request("GET /repos/{owner}/{repo}", {
        owner,
        repo,
      }),
    );
    return res ? toRepo(res.data) : null;
  }

  async listInstalledRepos(): Promise<Repo[]> {
    const installations = await this.octokit.request("GET /app/installations", {
      per_page: MAX_INSTALLATIONS,
    });
    const repos: Repo[] = [];
    for (const installation of installations.data) {
      const res = await (
        await this.asInstallation(installation.id)
      ).request("GET /installation/repositories", { per_page: MAX_REPOS });
      repos.push(...res.data.repositories.map(toRepo));
    }
    return repos.sort((a, b) => a.fullName.localeCompare(b.fullName)).slice(0, MAX_REPOS);
  }

  async issueRepoToken(fullName: string): Promise<RepoToken | null> {
    const installationId = await this.installationFor(fullName);
    if (installationId === null) return null;
    const res = await this.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        repositories: [fullName.split("/")[1]!],
        permissions: { contents: "write", pull_requests: "write" },
      },
    );
    return RepoToken.parse({
      token: res.data.token,
      expiresAt: res.data.expires_at,
      actor: `${this.credentials.slug}[bot]`,
    });
  }

  async dispatchWorkflow(
    fullName: string,
    workflow: string,
    inputs: Record<string, string>,
  ): Promise<WorkflowDispatch | null> {
    if (!WORKFLOW_FILE.test(workflow)) throw new Error(`not a workflow file name: ${workflow}`);
    const installationId = await this.installationFor(fullName);
    if (installationId === null) return null;
    const repo = await this.getRepo(fullName);
    if (!repo) return null;
    const [owner, name] = repo.fullName.split("/") as [string, string];
    // GitHub answers 200 with the new run's ID and URLs (needs the App's Actions write).
    const res = await (
      await this.asInstallation(installationId)
    ).request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
      owner,
      repo: name,
      workflow_id: workflow,
      ref: repo.defaultBranch,
      inputs,
    });
    const data = res.data as { workflow_run_id?: number; html_url?: string } | undefined;
    if (!data?.workflow_run_id || !data.html_url) {
      throw new Error("GitHub did not return the dispatched run's ID");
    }
    return WorkflowDispatch.parse({ id: String(data.workflow_run_id), url: data.html_url });
  }

  async getWorkflowRun(fullName: string, runId: string): Promise<WorkflowRun | null> {
    if (!/^[0-9]{1,20}$/.test(runId)) return null;
    const installationId = await this.installationFor(fullName);
    if (installationId === null) return null;
    const [owner, repo] = fullName.split("/") as [string, string];
    const res = await this.notFoundAsNull(async () =>
      (await this.asInstallation(installationId)).request(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
        { owner, repo, run_id: Number(runId) },
      ),
    );
    if (!res) return null;
    const r = res.data;
    return WorkflowRun.parse({
      id: String(r.id),
      name: (r.name ?? "").slice(0, 256),
      trigger: r.event,
      status: r.status === "completed" || r.status === "in_progress" ? r.status : "queued",
      conclusion: r.conclusion ? toConclusion(r.conclusion) : null,
      headBranch: r.head_branch ?? null,
      headSha: r.head_sha,
      url: r.html_url,
    });
  }

  async cancelWorkflowRun(fullName: string, runId: string): Promise<void> {
    const run = await this.getWorkflowRun(fullName, runId);
    if (!run || run.status === "completed") return;
    const installationId = (await this.installationFor(fullName))!;
    const [owner, repo] = fullName.split("/") as [string, string];
    try {
      await (
        await this.asInstallation(installationId)
      ).request("POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel", {
        owner,
        repo,
        run_id: Number(runId),
      });
    } catch (err) {
      // 409: the run finished in the meantime.
      if ((err as { status?: number }).status !== 409) throw err;
    }
  }

  private async installationFor(fullName: string): Promise<number | null> {
    if (!RepoName.safeParse(fullName).success) return null;
    const [owner, repo] = fullName.split("/") as [string, string];
    const res = await this.notFoundAsNull(() =>
      this.octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo }),
    );
    return res ? res.data.id : null;
  }

  private async asInstallation(installationId: number): Promise<Octokit> {
    const { token } = (await this.octokit.auth({ type: "installation", installationId })) as {
      token: string;
    };
    return new Octokit({ auth: token, request: this.request });
  }

  private async notFoundAsNull<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  }
}
