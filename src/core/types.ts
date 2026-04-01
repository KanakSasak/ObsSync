export interface ObsSyncConfig {
  remote: string;
  branch: string;
  autoSyncEnabled: boolean;
  autoSyncIntervalMs: number;
  excludePatterns: string[];
  maxFileSizeBytes: number;
  commitMessagePrefix: string;
}

export interface ObsSyncPluginSettings extends ObsSyncConfig {
  token: string;
}

export const DEFAULT_CONFIG: ObsSyncConfig = {
  remote: "",
  branch: "main",
  autoSyncEnabled: false,
  autoSyncIntervalMs: 300000,
  excludePatterns: [".obsidian", ".obssync.json", ".trash"],
  maxFileSizeBytes: 52428800, // 50MB
  commitMessagePrefix: "vault:",
};

export const MIN_SYNC_INTERVAL_MS = 30000; // 30 seconds
export const MAX_SYNC_INTERVAL_MS = 86400000; // 24 hours

export const DEFAULT_PLUGIN_SETTINGS: ObsSyncPluginSettings = {
  ...DEFAULT_CONFIG,
  token: "",
};

export interface Author {
  name: string;
  email: string;
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "unmodified";
}

export interface SyncResult {
  pushed: FileChange[];
  pulled: string[];
  conflicts: ConflictInfo[];
  commitHash?: string;
  message: string;
  /** True when sync was skipped because nothing changed */
  skipped?: boolean;
}

export interface ConflictInfo {
  path: string;
  resolution: "kept-both" | "kept-local" | "kept-remote" | "unresolved";
  localCopyPath?: string;
}

export type ErrorCode =
  | "NOT_INITIALIZED"
  | "AUTH_FAILED"
  | "CONFLICT"
  | "FILE_TOO_LARGE"
  | "REMOTE_ERROR"
  | "INVALID_CONFIG";

export class ObsSyncError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public cause?: Error,
  ) {
    super(message);
    this.name = "ObsSyncError";
  }
}
