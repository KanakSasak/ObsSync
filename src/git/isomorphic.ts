import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import * as fs from "fs";
import * as path from "path";
import type { IGitProvider } from "./git-provider.js";
import type { Author, FileChange } from "../core/types.js";
import { ObsSyncError } from "../core/types.js";
import { buildAuthUrl } from "./git-provider.js";

export class IsomorphicGitProvider implements IGitProvider {
  async init(dir: string): Promise<void> {
    await git.init({ fs, dir, defaultBranch: "main" });
  }

  async clone(
    url: string,
    dir: string,
    branch: string,
    token?: string,
  ): Promise<void> {
    try {
      await git.clone({
        fs,
        http,
        dir,
        url: buildAuthUrl(url, token),
        ref: branch,
        singleBranch: true,
        depth: 1,
        onAuth: token ? () => ({ username: token, password: "x-oauth-basic" }) : undefined,
      });
    } catch (err) {
      throw new ObsSyncError(
        `Failed to clone ${url}: ${err instanceof Error ? err.message : String(err)}`,
        "REMOTE_ERROR",
        err instanceof Error ? err : undefined,
      );
    }
  }

  async add(dir: string, filepath: string): Promise<void> {
    await git.add({ fs, dir, filepath });
  }

  async remove(dir: string, filepath: string): Promise<void> {
    await git.remove({ fs, dir, filepath });
  }

  async commit(
    dir: string,
    message: string,
    author: Author,
  ): Promise<string> {
    const sha = await git.commit({
      fs,
      dir,
      message,
      author: { name: author.name, email: author.email },
    });
    return sha;
  }

  async push(
    dir: string,
    remote: string,
    branch: string,
    token?: string,
  ): Promise<void> {
    try {
      await git.push({
        fs,
        http,
        dir,
        remote,
        ref: branch,
        onAuth: token ? () => ({ username: token, password: "x-oauth-basic" }) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("403") || msg.includes("Authentication")) {
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
    try {
      await git.pull({
        fs,
        http,
        dir,
        ref: branch,
        singleBranch: true,
        author: { name: "ObsSync", email: "obssync@local" },
        onAuth: token ? () => ({ username: token, password: "x-oauth-basic" }) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("403") || msg.includes("Authentication")) {
        throw new ObsSyncError("Authentication failed. Check your GitHub token.", "AUTH_FAILED", err instanceof Error ? err : undefined);
      }
      throw new ObsSyncError(`Pull failed: ${msg}`, "REMOTE_ERROR", err instanceof Error ? err : undefined);
    }
  }

  async status(dir: string): Promise<FileChange[]> {
    const matrix = await git.statusMatrix({ fs, dir });
    const changes: FileChange[] = [];

    for (const [filepath, head, workdir, stage] of matrix) {
      // Skip .git directory entries
      if (filepath.startsWith(".git/") || filepath === ".git") continue;

      // statusMatrix returns [filepath, HEAD, WORKDIR, STAGE]
      // HEAD: 0=absent, 1=present
      // WORKDIR: 0=absent, 1=identical to HEAD, 2=different from HEAD
      // STAGE: 0=absent, 1=identical to HEAD, 2=added/modified, 3=deleted
      if (head === 0 && workdir === 2) {
        changes.push({ path: filepath, status: "added" });
      } else if (head === 1 && workdir === 2) {
        changes.push({ path: filepath, status: "modified" });
      } else if (head === 1 && workdir === 0) {
        changes.push({ path: filepath, status: "deleted" });
      }
      // head === 1 && workdir === 1 => unmodified, skip
    }

    return changes;
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      const gitDir = path.join(dir, ".git");
      await fs.promises.access(gitDir);
      return true;
    } catch {
      return false;
    }
  }

  async setRemote(dir: string, name: string, url: string): Promise<void> {
    try {
      const remotes = await git.listRemotes({ fs, dir });
      const existing = remotes.find((r) => r.remote === name);
      if (existing) {
        await git.deleteRemote({ fs, dir, remote: name });
      }
      await git.addRemote({ fs, dir, remote: name, url });
    } catch (err) {
      throw new ObsSyncError(
        `Failed to set remote: ${err instanceof Error ? err.message : String(err)}`,
        "REMOTE_ERROR",
        err instanceof Error ? err : undefined,
      );
    }
  }

  async getCurrentBranch(dir: string): Promise<string> {
    const branch = await git.currentBranch({ fs, dir });
    return branch || "main";
  }

  async listConflicts(dir: string): Promise<string[]> {
    // isomorphic-git doesn't have native conflict detection
    // We check for conflict markers in files after a pull
    const matrix = await git.statusMatrix({ fs, dir });
    const conflicts: string[] = [];

    for (const [filepath, head, workdir, stage] of matrix) {
      if (filepath.startsWith(".git/")) continue;
      // A file with head=1, workdir=2, stage=2 after a merge could be conflicted
      // Check for conflict markers
      if (workdir === 2) {
        try {
          const content = await fs.promises.readFile(path.join(dir, filepath), "utf-8");
          if (content.includes("<<<<<<<") && content.includes(">>>>>>>")) {
            conflicts.push(filepath);
          }
        } catch {
          // Binary file or unreadable, skip
        }
      }
    }

    return conflicts;
  }

  async getHeadHash(dir: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir, ref: "HEAD" });
    } catch {
      return null;
    }
  }

  async log(
    dir: string,
    count: number,
  ): Promise<Array<{ hash: string; message: string }>> {
    try {
      const commits = await git.log({ fs, dir, depth: count });
      return commits.map((c) => ({
        hash: c.oid,
        message: c.commit.message,
      }));
    } catch {
      return [];
    }
  }
}
