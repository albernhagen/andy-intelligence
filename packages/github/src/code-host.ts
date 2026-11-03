import { Repo, RepoName, type CodeHost } from "@andy/contracts";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

export interface GitHubAppCredentials {
  appId: string;
  /** PEM private key of the GitHub App (Secret Manager in prod; ADR-0041). */
  privateKey: string;
}

/**
 * CodeHost on a GitHub App. App-level calls use the App's JWT; repo reads use a short-lived
 * installation token (cached by @octokit/auth-app until shortly before it expires).
 */
export class GitHubCodeHost implements CodeHost {
  private readonly octokit: Octokit;
  private readonly request: { fetch?: typeof fetch; timeout: number };

  constructor(
    credentials: GitHubAppCredentials,
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
    if (!RepoName.safeParse(fullName).success) return null;
    const [owner, repo] = fullName.split("/") as [string, string];
    const installation = await this.notFoundAsNull(() =>
      this.octokit.request("GET /repos/{owner}/{repo}/installation", { owner, repo }),
    );
    if (!installation) return null;
    const { token } = (await this.octokit.auth({
      type: "installation",
      installationId: installation.data.id,
    })) as { token: string };
    const asInstallation = new Octokit({ auth: token, request: this.request });
    const res = await this.notFoundAsNull(() =>
      asInstallation.request("GET /repos/{owner}/{repo}", { owner, repo }),
    );
    if (!res) return null;
    return Repo.parse({
      fullName: res.data.full_name,
      defaultBranch: res.data.default_branch,
      private: res.data.private,
      url: res.data.html_url,
    });
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
