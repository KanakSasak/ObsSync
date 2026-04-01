import { promises as fs } from "fs";
import * as path from "path";
import type { ConflictInfo } from "./types.js";
import type { IGitProvider } from "../git/git-provider.js";

export class ConflictHandler {
  constructor(
    private vaultPath: string,
    private gitProvider: IGitProvider,
  ) {}

  async resolveAll(conflictPaths: string[]): Promise<ConflictInfo[]> {
    const results: ConflictInfo[] = [];
    for (const filePath of conflictPaths) {
      const result = await this.resolveKeepBoth(filePath);
      results.push(result);
    }
    return results;
  }

  async resolveKeepBoth(filePath: string): Promise<ConflictInfo> {
    const fullPath = path.join(this.vaultPath, filePath);
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    const localCopyPath = `${base}.local${ext}`;
    const localFullPath = path.join(this.vaultPath, localCopyPath);

    try {
      // Read the conflicted file (contains conflict markers)
      const content = await fs.readFile(fullPath, "utf-8");

      // Extract the local (ours) version from conflict markers
      const localContent = this.extractLocalContent(content);

      // Save local version as .local copy
      await fs.writeFile(localFullPath, localContent, "utf-8");

      // Extract remote (theirs) version and write as the main file
      const remoteContent = this.extractRemoteContent(content);
      await fs.writeFile(fullPath, remoteContent, "utf-8");

      // Stage both files
      await this.gitProvider.add(this.vaultPath, filePath);
      await this.gitProvider.add(this.vaultPath, localCopyPath);

      return {
        path: filePath,
        resolution: "kept-both",
        localCopyPath,
      };
    } catch {
      return {
        path: filePath,
        resolution: "unresolved",
      };
    }
  }

  private extractLocalContent(conflictedContent: string): string {
    const lines = conflictedContent.split("\n");
    const result: string[] = [];
    let inLocal = false;
    let inRemote = false;

    for (const line of lines) {
      if (line.startsWith("<<<<<<<")) {
        inLocal = true;
        continue;
      }
      if (line.startsWith("=======")) {
        inLocal = false;
        inRemote = true;
        continue;
      }
      if (line.startsWith(">>>>>>>")) {
        inRemote = false;
        continue;
      }

      if (inLocal || (!inLocal && !inRemote)) {
        result.push(line);
      }
    }

    return result.join("\n");
  }

  private extractRemoteContent(conflictedContent: string): string {
    const lines = conflictedContent.split("\n");
    const result: string[] = [];
    let inLocal = false;
    let inRemote = false;

    for (const line of lines) {
      if (line.startsWith("<<<<<<<")) {
        inLocal = true;
        continue;
      }
      if (line.startsWith("=======")) {
        inLocal = false;
        inRemote = true;
        continue;
      }
      if (line.startsWith(">>>>>>>")) {
        inRemote = false;
        continue;
      }

      if (inRemote || (!inLocal && !inRemote)) {
        result.push(line);
      }
    }

    return result.join("\n");
  }
}
