import {
  ChangedFile,
  FileProposal,
  HeadCheck,
  PullRequest,
  PullRequestCommit,
  ProposedPullRequest,
  Repo,
  RepoName,
  RepoToken,
  WorkflowDispatch,
  RequiredCheck,
  WorkflowRun,
  type CheckConclusion,
  type CodeHost,
  type Listing,
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
/** Caps on the gate's reads (ADR-0028); a longer listing comes back `complete: false`. */
const PER_PAGE = 100;
const MAX_FILE_PAGES = 3;

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
    // Needs the App's Actions write. Only with `return_run_details` does GitHub answer 200 with
    // the new run's ID and URLs; without it, 204 and no body (GitHub changelog 2026-02-19).
    const res = await (
      await this.asInstallation(installationId)
    ).request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
      owner,
      repo: name,
      workflow_id: workflow,
      ref: repo.defaultBranch,
      inputs,
      return_run_details: true,
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

  async getPullRequest(fullName: string, number: number): Promise<PullRequest | null> {
    const client = await this.repoClient(fullName);
    if (!client) return null;
    const res = await this.notFoundAsNull(() =>
      client.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        ...client.repo,
        pull_number: number,
      }),
    );
    if (!res) return null;
    const pr = res.data;
    return PullRequest.parse({
      number: pr.number,
      state: pr.merged ? "merged" : pr.state === "open" ? "open" : "closed",
      draft: pr.draft ?? false,
      title: pr.title.slice(0, 256),
      bodyFirstLine: (pr.body ?? "").split(/\r?\n/, 1)[0]?.trim().slice(0, 256) ?? "",
      fromFork: pr.head.repo?.full_name !== pr.base.repo.full_name,
      intoDefaultBranch: pr.base.ref === pr.base.repo.default_branch,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
      url: pr.html_url,
    });
  }

  async listChangedFiles(fullName: string, number: number): Promise<Listing<ChangedFile>> {
    const client = await this.repoClient(fullName);
    if (!client) return { items: [], complete: true };
    const items: ChangedFile[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const res = await client.octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
        { ...client.repo, pull_number: number, per_page: PER_PAGE, page },
      );
      items.push(
        ...res.data.map((f) =>
          ChangedFile.parse({ path: f.filename, previousPath: f.previous_filename ?? null }),
        ),
      );
      if (res.data.length < PER_PAGE) return { items, complete: true };
    }
    return { items, complete: false };
  }

  async listHeadChecks(fullName: string, sha: string): Promise<Listing<HeadCheck>> {
    const client = await this.repoClient(fullName);
    if (!client) return { items: [], complete: true };
    const res = await client.octokit.request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
      ...client.repo,
      ref: sha,
      filter: "latest",
      per_page: PER_PAGE,
    });
    return {
      complete: res.data.total_count <= res.data.check_runs.length,
      items: res.data.check_runs.map((c) =>
        HeadCheck.parse({
          name: c.name.slice(0, 256),
          status: c.status === "completed" || c.status === "in_progress" ? c.status : "queued",
          conclusion: c.conclusion ? toConclusion(c.conclusion) : null,
          sourceId: c.app ? String(c.app.id) : null,
        }),
      ),
    };
  }

  async listRequiredChecks(fullName: string, branch: string): Promise<RequiredCheck[]> {
    const client = await this.repoClient(fullName);
    if (!client) return [];
    const res = await client.octokit.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", {
      ...client.repo,
      branch,
      per_page: PER_PAGE,
    });
    return res.data.flatMap((rule) =>
      rule.type === "required_status_checks"
        ? rule.parameters!.required_status_checks.map((c) =>
            RequiredCheck.parse({
              name: c.context,
              sourceId: c.integration_id === undefined ? null : String(c.integration_id),
            }),
          )
        : [],
    );
  }

  async listPullRequestCommits(
    fullName: string,
    number: number,
  ): Promise<Listing<PullRequestCommit>> {
    const client = await this.repoClient(fullName);
    if (!client) return { items: [], complete: true };
    const res = await client.octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits",
      { ...client.repo, pull_number: number, per_page: PER_PAGE },
    );
    return {
      complete: res.data.length < PER_PAGE,
      items: res.data.map((c) =>
        PullRequestCommit.parse({
          sha: c.sha,
          // Commits by the publish job's git identity have no linked account: the name says it.
          author: c.author?.login ?? c.commit.author?.name ?? null,
        }),
      ),
    };
  }

  async readFile(fullName: string, path: string, ref: string): Promise<string | null> {
    const client = await this.repoClient(fullName);
    if (!client) return null;
    const res = await this.notFoundAsNull(() =>
      client.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        ...client.repo,
        path,
        ref,
      }),
    );
    if (!res || Array.isArray(res.data) || res.data.type !== "file") return null;
    // GitHub leaves `content` empty above 1 MB: throw, so the caller doesn't read that as "empty".
    if (res.data.size > 0 && !res.data.content) throw new Error(`${path} is too large to read`);
    return Buffer.from(res.data.content, "base64").toString("utf8");
  }

  async mergePullRequest(fullName: string, number: number, expectedHeadSha: string): Promise<void> {
    const client = await this.repoClient(fullName);
    if (!client) throw new Error(`the App isn't installed on ${fullName}`);
    await client.octokit.request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge", {
      ...client.repo,
      pull_number: number,
      sha: expectedHeadSha,
      merge_method: "squash",
    });
  }

  async headContains(fullName: string, head: string, base: string): Promise<boolean | null> {
    const client = await this.repoClient(fullName);
    if (!client) return null;
    // Compare base...head: "ahead" or "identical" means head already has every commit of base.
    // per_page 1 keeps the response small; `status` doesn't depend on the commit list.
    const res = await this.notFoundAsNull(() =>
      client.octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        ...client.repo,
        basehead: `${base}...${head}`,
        per_page: 1,
      }),
    );
    if (!res) return null;
    return res.data.status === "ahead" || res.data.status === "identical";
  }

  async proposeFile(fullName: string, proposal: FileProposal): Promise<ProposedPullRequest | null> {
    const client = await this.repoClient(fullName);
    if (!client) return null;
    const p = FileProposal.parse(proposal);
    const { data: repo } = await client.octokit.request("GET /repos/{owner}/{repo}", client.repo);
    const base = repo.default_branch;
    const { data: ref } = await client.octokit.request(
      "GET /repos/{owner}/{repo}/git/ref/heads/{branch}",
      { ...client.repo, branch: base },
    );
    // Fails (422) when the branch exists: a proposal never writes onto someone else's branch.
    await client.octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      ...client.repo,
      ref: `refs/heads/${p.branch}`,
      sha: ref.object.sha,
    });
    // The file's blob sha when it exists already: GitHub needs it to replace the file.
    const existing = await this.notFoundAsNull(() =>
      client.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        ...client.repo,
        path: p.path,
        ref: p.branch,
      }),
    );
    const sha =
      existing && !Array.isArray(existing.data) && existing.data.type === "file"
        ? existing.data.sha
        : undefined;
    try {
      await client.octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        ...client.repo,
        path: p.path,
        message: p.message,
        content: Buffer.from(p.content, "utf8").toString("base64"),
        branch: p.branch,
        ...(sha ? { sha } : {}),
      });
      const { data: pr } = await client.octokit.request("POST /repos/{owner}/{repo}/pulls", {
        ...client.repo,
        title: p.title,
        body: p.body,
        head: p.branch,
        base,
      });
      return ProposedPullRequest.parse({ number: pr.number, url: pr.html_url, branch: p.branch });
    } catch (err) {
      // No orphan branch: the one this call created goes again (best effort), then it fails.
      await client.octokit
        .request("DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}", {
          ...client.repo,
          branch: p.branch,
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /** An installation client and owner/repo; null when the App isn't installed. */
  private async repoClient(fullName: string) {
    const installationId = await this.installationFor(fullName);
    if (installationId === null) return null;
    const [owner, repo] = fullName.split("/") as [string, string];
    return { octokit: await this.asInstallation(installationId), repo: { owner, repo } };
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
