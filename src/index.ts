// Core
export { SyncEngine } from "./core/sync-engine.js";
export { ConflictHandler } from "./core/conflict.js";
export { loadConfig, saveConfig, getDefaultConfig } from "./core/config.js";
export { ensureGitignore } from "./core/gitignore.js";

// Types
export type {
  ObsSyncConfig,
  ObsSyncPluginSettings,
  Author,
  FileChange,
  SyncResult,
  ConflictInfo,
  ErrorCode,
} from "./core/types.js";
export { ObsSyncError, DEFAULT_CONFIG, DEFAULT_PLUGIN_SETTINGS } from "./core/types.js";

// Git providers
export type { IGitProvider } from "./git/git-provider.js";
export { buildAuthUrl } from "./git/git-provider.js";
export { IsomorphicGitProvider } from "./git/isomorphic.js";
export { SimpleGitProvider } from "./git/simple.js";
