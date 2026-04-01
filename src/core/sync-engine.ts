import { promises as fs } from "fs";
import * as path from "path";
import type { IGitProvider } from "../git/git-provider.js";
import type { ObsSyncConfig, Author, FileChange, SyncResult, ConflictInfo } from "./types.js";
import { ObsSyncError } from "./types.js";
import { ConflictHandler } from "./conflict.js";
import { ensureGitignore } from "./gitignore.js";

const DEFAULT_AUTHOR: Author = {
  name: "ObsSync",
  email: "obssync@local",
};

export class SyncEngine {
  private conflictHandler: ConflictHandler;

  constructor(
    private config: ObsSyncConfig,
    private gitProvider: IGitProvider,
    private vaultPath: string,
    private token?: string,
  ) {
    this.conflictHandler = new ConflictHandler(vaultPath, gitProvider);
  }

  async initialize(remoteUrl: string): Promise<void> {
    const isRepo = await this.gitProvider.isRepo(this.vaultPath);

    if (!isRepo) {
      await this.gitProvider.init(this.vaultPath);
    }

    await this.gitProvider.setRemote(this.vaultPath, "origin", remoteUrl);
    await ensureGitignore(this.vaultPath, this.config.excludePatterns);
  }

  async push(message?: string): Promise<SyncResult> {
    await this.ensureInitialized();

    const changes = await this.getFilteredChanges();

    if (changes.length === 0) {
      return {
        pushed: [],
        pulled: [],
        conflicts: [],
        message: "No changes to push.",
      };
    }

    // Stage all changes
    for (const change of changes) {
      if (change.status === "deleted") {
        await this.gitProvider.remove(this.vaultPath, change.path);
      } else {
        await this.gitProvider.add(this.vaultPath, change.path);
      }
    }

    // Commit
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const commitMsg = message
      ? `${this.config.commitMessagePrefix} ${message}`
      : `${this.config.commitMessagePrefix} sync ${timestamp}`;

    const commitHash = await this.gitProvider.commit(
      this.vaultPath,
      commitMsg,
      DEFAULT_AUTHOR,
    );

    // Push
    await this.gitProvider.push(
      this.vaultPath,
      "origin",
      this.config.branch,
      this.token,
    );

    return {
      pushed: changes,
      pulled: [],
      conflicts: [],
      commitHash,
      message: `Pushed ${changes.length} file(s). Commit: ${commitHash.slice(0, 7)}`,
    };
  }

  async pull(): Promise<SyncResult> {
    await this.ensureInitialized();

    try {
      await this.gitProvider.pull(
        this.vaultPath,
        "origin",
        this.config.branch,
        this.token,
      );
    } catch (err) {
      if (err instanceof ObsSyncError) throw err;
      throw new ObsSyncError(
        `Pull failed: ${err instanceof Error ? err.message : String(err)}`,
        "REMOTE_ERROR",
        err instanceof Error ? err : undefined,
      );
    }

    // Check for conflicts
    const conflictPaths = await this.gitProvider.listConflicts(this.vaultPath);
    let conflicts: ConflictInfo[] = [];
    if (conflictPaths.length > 0) {
      conflicts = await this.conflictHandler.resolveAll(conflictPaths);
    }

    return {
      pushed: [],
      pulled: conflictPaths,
      conflicts,
      message:
        conflicts.length > 0
          ? `Pulled with ${conflicts.length} conflict(s) resolved (kept both versions).`
          : "Pull complete.",
    };
  }

  async fullSync(message?: string): Promise<SyncResult> {
    // Pull first, then push
    const pullResult = await this.pull();
    const pushResult = await this.push(message);

    return {
      pushed: pushResult.pushed,
      pulled: pullResult.pulled,
      conflicts: pullResult.conflicts,
      commitHash: pushResult.commitHash,
      message: `Sync complete. Pushed ${pushResult.pushed.length} file(s), pulled ${pullResult.pulled.length} file(s).`,
    };
  }

  async getStatus(): Promise<FileChange[]> {
    return this.getFilteredChanges();
  }

  private async getFilteredChanges(): Promise<FileChange[]> {
    const allChanges = await this.gitProvider.status(this.vaultPath);

    return allChanges.filter((change) => {
      // Filter out excluded patterns
      if (this.isExcluded(change.path)) return false;

      // Check file size for non-deleted files
      if (change.status !== "deleted") {
        // Size check is async but we do it separately for large files
        // For MVP, we'll log warnings in the CLI/plugin layer
      }

      return true;
    });
  }

  private isExcluded(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    for (const pattern of this.config.excludePatterns) {
      const normalizedPattern = pattern.replace(/\*\*/g, "").replace(/\*/g, "").replace(/\/$/, "");
      if (normalized.startsWith(normalizedPattern) || normalized === normalizedPattern) {
        return true;
      }
    }
    return false;
  }

  private async ensureInitialized(): Promise<void> {
    const isRepo = await this.gitProvider.isRepo(this.vaultPath);
    if (!isRepo) {
      throw new ObsSyncError(
        "Vault is not initialized. Run 'obssync init' first.",
        "NOT_INITIALIZED",
      );
    }
  }

  async checkOversizedFiles(): Promise<string[]> {
    const changes = await this.getFilteredChanges();
    const oversized: string[] = [];

    for (const change of changes) {
      if (change.status === "deleted") continue;
      try {
        const fullPath = path.join(this.vaultPath, change.path);
        const stats = await fs.stat(fullPath);
        if (stats.size > this.config.maxFileSizeBytes) {
          oversized.push(change.path);
        }
      } catch {
        // File might not exist, skip
      }
    }

    return oversized;
  }
}
