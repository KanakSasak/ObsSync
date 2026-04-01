import type { App } from "obsidian";

/**
 * Bridges Obsidian's Vault API to provide the vault's base path.
 * On desktop, this returns the filesystem path.
 * On mobile, Obsidian abstracts the filesystem — isomorphic-git
 * works with its own fs module, so we use the adapter's basePath.
 */
export function getVaultBasePath(app: App): string {
  // Obsidian's vault adapter provides the base filesystem path
  const adapter = app.vault.adapter as { getBasePath?: () => string; basePath?: string };

  if (typeof adapter.getBasePath === "function") {
    return adapter.getBasePath();
  }

  if (adapter.basePath) {
    return adapter.basePath;
  }

  // Fallback: shouldn't happen in practice
  throw new Error("Unable to determine vault base path");
}
