import { promises as fs } from "fs";
import * as path from "path";

const DEFAULT_GITIGNORE_LINES = [
  ".obsidian/",
  ".obssync.json",
  ".trash/",
  "*.tmp",
];

export async function ensureGitignore(
  vaultPath: string,
  extraPatterns: string[] = [],
): Promise<void> {
  const gitignorePath = path.join(vaultPath, ".gitignore");
  let existing = new Set<string>();

  try {
    const content = await fs.readFile(gitignorePath, "utf-8");
    existing = new Set(
      content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    );
  } catch {
    // File doesn't exist, start fresh
  }

  const allPatterns = [...DEFAULT_GITIGNORE_LINES, ...extraPatterns];
  const toAdd = allPatterns.filter((p) => !existing.has(p));

  if (toAdd.length === 0) return;

  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
  } catch {
    content = "# ObsSync defaults\n";
  }

  content += toAdd.join("\n") + "\n";
  await fs.writeFile(gitignorePath, content, "utf-8");
}
