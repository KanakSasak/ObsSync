import type { Author, FileChange } from "../core/types.js";

export interface IGitProvider {
  /** Initialize a new git repository */
  init(dir: string): Promise<void>;

  /** Clone a remote repository */
  clone(url: string, dir: string, branch: string, token?: string): Promise<void>;

  /** Stage a file for commit */
  add(dir: string, filepath: string): Promise<void>;

  /** Remove a file from the index */
  remove(dir: string, filepath: string): Promise<void>;

  /** Create a commit with staged changes */
  commit(dir: string, message: string, author: Author): Promise<string>;

  /** Push commits to remote */
  push(dir: string, remote: string, branch: string, token?: string): Promise<void>;

  /** Pull changes from remote */
  pull(dir: string, remote: string, branch: string, token?: string): Promise<void>;

  /** Get the status of all files in the working directory */
  status(dir: string): Promise<FileChange[]>;

  /** Check if a directory is a git repository */
  isRepo(dir: string): Promise<boolean>;

  /** Set or update a remote URL */
  setRemote(dir: string, name: string, url: string): Promise<void>;

  /** Get the current branch name */
  getCurrentBranch(dir: string): Promise<string>;

  /** List files with merge conflicts */
  listConflicts(dir: string): Promise<string[]>;

  /** Fetch from remote without merging */
  fetch(dir: string, remote: string, branch: string, token?: string): Promise<void>;

  /** Check if remote has any commits */
  remoteHasData(dir: string, remote: string, token?: string): Promise<boolean>;

  /** Get the HEAD commit hash */
  getHeadHash(dir: string): Promise<string | null>;

  /** Log messages for debugging */
  log(dir: string, count: number): Promise<Array<{ hash: string; message: string }>>;
}

/** Build a remote URL with token authentication */
export function buildAuthUrl(remote: string, token?: string): string {
  if (!token) return remote;

  try {
    const url = new URL(remote);
    url.username = token;
    url.password = "x-oauth-basic";
    return url.toString();
  } catch {
    // If URL parsing fails, try simple string replacement for git URLs
    if (remote.startsWith("https://")) {
      return remote.replace("https://", `https://${token}:x-oauth-basic@`);
    }
    return remote;
  }
}
