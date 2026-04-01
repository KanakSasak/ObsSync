import simpleGit, { type SimpleGit } from "simple-git";
import * as path from "path";
import type { IGitProvider } from "./git-provider.js";
import type { Author, FileChange } from "../core/types.js";
import { ObsSyncError } from "../core/types.js";
import { buildAuthUrl } from "./git-provider.js";

export class SimpleGitProvider implements IGitProvider {
  private getGit(dir: string): SimpleGit {
    return simpleGit(dir);
  }

  async init(dir: string): Promise<void> {
    const git = this.getGit(dir);
    await git.init();
  }

  async clone(
    url: string,
    dir: string,
    branch: string,
    token?: string,
  ): Promise<void> {
    try {
      const git = simpleGit();
      await git.clone(buildAuthUrl(url, token), dir, [
        "--branch",
        branch,
        "--single-branch",
      ]);
    } catch (err) {
      throw new ObsSyncError(
        `Failed to clone: ${err instanceof Error ? err.message : String(err)}`,
        "REMOTE_ERROR",
        err instanceof Error ? err : undefined,
      );
    }
  }

  async add(dir: string, filepath: string): Promise<void> {
    const git = this.getGit(dir);
    await git.add(filepath);
  }

  async remove(dir: string, filepath: string): Promise<void> {
    const git = this.getGit(dir);
    await git.rm(filepath);
  }

  async commit(
    dir: string,
    message: string,
    author: Author,
  ): Promise<string> {
    const git = this.getGit(dir);
    const result = await git.commit(message, undefined, {
      "--author": `${author.name} <${author.email}>`,
    });
    return result.commit;
  }

  async push(
    dir: string,
    remote: string,
    branch: string,
    token?: string,
  ): Promise<void> {
    const git = this.getGit(dir);

    try {
      if (token) {
        // Temporarily set the remote URL with token for auth
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((r) => r.name === remote);
        if (origin) {
          const authUrl = buildAuthUrl(origin.refs.push || origin.refs.fetch, token);
          await git.remote(["set-url", remote, authUrl]);
          await git.push(remote, branch);
          // Restore original URL (without token)
          await git.remote(["set-url", remote, origin.refs.push || origin.refs.fetch]);
          return;
        }
      }
      await git.push(remote, branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Authentication") || msg.includes("401") || msg.includes("403")) {
        throw new ObsSyncError("Authentication failed. Check your GitHub token.", "AUTH_FAILED", err instanceof Error ? err : undefined);
      }
      throw new ObsSyncError(`Push failed: ${msg}`, "REMOTE_ERROR", err instanceof Error ? err : undefined);
    }
  }

  async pull(
    dir: string,
    remote: string,
    branch: string,
    token?: string,
  ): Promise<void> {
    const git = this.getGit(dir);

    try {
      if (token) {
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((r) => r.name === remote);
        if (origin) {
          const authUrl = buildAuthUrl(origin.refs.fetch || origin.refs.push, token);
          await git.remote(["set-url", remote, authUrl]);
          await git.pull(remote, branch, { "--no-rebase": null });
          await git.remote(["set-url", remote, origin.refs.fetch || origin.refs.push]);
          return;
        }
      }
      await git.pull(remote, branch, { "--no-rebase": null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Authentication") || msg.includes("401") || msg.includes("403")) {
        throw new ObsSyncError("Authentication failed. Check your GitHub token.", "AUTH_FAILED", err instanceof Error ? err : undefined);
      }
      throw new ObsSyncError(`Pull failed: ${msg}`, "REMOTE_ERROR", err instanceof Error ? err : undefined);
    }
  }

  async status(dir: string): Promise<FileChange[]> {
    const git = this.getGit(dir);
    const result = await git.status();
    const changes: FileChange[] = [];

    for (const file of result.not_added) {
      changes.push({ path: file, status: "added" });
    }
    for (const file of result.created) {
      changes.push({ path: file, status: "added" });
    }
    for (const file of result.modified) {
      changes.push({ path: file, status: "modified" });
    }
    for (const file of result.deleted) {
      changes.push({ path: file, status: "deleted" });
    }
    for (const file of result.renamed) {
      changes.push({ path: file.to, status: "added" });
    }

    return changes;
  }

  async isRepo(dir: string): Promise<boolean> {
    const git = this.getGit(dir);
    return git.checkIsRepo();
  }

  async setRemote(dir: string, name: string, url: string): Promise<void> {
    const git = this.getGit(dir);
    try {
      const remotes = await git.getRemotes();
      if (remotes.find((r) => r.name === name)) {
        await git.remote(["set-url", name, url]);
      } else {
        await git.addRemote(name, url);
      }
    } catch (err) {
      throw new ObsSyncError(
        `Failed to set remote: ${err instanceof Error ? err.message : String(err)}`,
        "REMOTE_ERROR",
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getCurrentBranch(dir: string): Promise<string> {
    const git = this.getGit(dir);
    const result = await git.branch();
    return result.current || "main";
  }

  async listConflicts(dir: string): Promise<string[]> {
    const git = this.getGit(dir);
    const result = await git.status();
    return result.conflicted;
  }

  async log(
    dir: string,
    count: number,
  ): Promise<Array<{ hash: string; message: string }>> {
    const git = this.getGit(dir);
    try {
      const result = await git.log({ maxCount: count });
      return result.all.map((c) => ({
        hash: c.hash,
        message: c.message,
      }));
    } catch {
      return [];
    }
  }
}
