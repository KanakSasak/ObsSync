import { Modal, Notice, Plugin, Setting } from "obsidian";
import { ObsSyncSettingTab } from "./settings-tab.js";
import { getVaultBasePath } from "./fs-adapter.js";
import { SyncEngine } from "../core/sync-engine.js";
import { IsomorphicGitProvider } from "../git/isomorphic.js";
import { DEFAULT_PLUGIN_SETTINGS, MIN_SYNC_INTERVAL_MS, MAX_SYNC_INTERVAL_MS, type ObsSyncPluginSettings, type SyncResult } from "../core/types.js";

export default class ObsSyncPlugin extends Plugin {
  settings: ObsSyncPluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };
  private syncEngine: SyncEngine | null = null;
  private syncIntervalId: number | null = null;
  private isSyncing = false;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    // Status bar for sync progress
    this.statusBarEl = this.addStatusBarItem();
    this.setStatusBar("idle");

    // Settings tab
    this.addSettingTab(new ObsSyncSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: "obssync-init",
      name: "Initialize vault for sync",
      callback: () => this.initVault(),
    });

    this.addCommand({
      id: "obssync-sync",
      name: "Sync now",
      callback: () => this.confirmAndSync(),
    });

    this.addCommand({
      id: "obssync-push",
      name: "Push to GitHub",
      callback: () => this.confirmAndPush(),
    });

    this.addCommand({
      id: "obssync-pull",
      name: "Pull from GitHub",
      callback: () => this.doPull(),
    });

    this.addCommand({
      id: "obssync-status",
      name: "Show sync status",
      callback: () => this.showStatus(),
    });

    // Ribbon icon
    this.addRibbonIcon("refresh-cw", "ObsSync: Sync now", () => {
      this.confirmAndSync();
    });

    // Start auto-sync if enabled
    this.startSyncSchedule();

    console.log("ObsSync plugin loaded");
  }

  onunload() {
    this.stopSyncSchedule();
    console.log("ObsSync plugin unloaded");
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = { ...DEFAULT_PLUGIN_SETTINGS, ...data };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getSyncEngine(): SyncEngine {
    if (!this.syncEngine || !this.settings.remote) {
      const vaultPath = getVaultBasePath(this.app);
      const gitProvider = new IsomorphicGitProvider();
      this.syncEngine = new SyncEngine(
        this.settings,
        gitProvider,
        vaultPath,
        this.settings.token,
      );
    }
    return this.syncEngine;
  }

  private validateSettings(): boolean {
    if (!this.settings.remote) {
      new Notice("ObsSync: Please configure the remote URL in settings.");
      return false;
    }
    if (!this.settings.token) {
      new Notice("ObsSync: Please configure your GitHub token in settings.");
      return false;
    }
    return true;
  }

  async initVault() {
    if (!this.validateSettings()) return;

    try {
      this.setStatusBar("initializing");
      new Notice("ObsSync: Initializing...");
      const engine = this.getSyncEngine();
      await engine.initialize(this.settings.remote);
      this.setStatusBar("success", "✓ Vault initialized!");
      new Notice("ObsSync: Vault initialized for sync!");
    } catch (err) {
      this.setStatusBar("error", `✗ Init failed`);
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
      console.error("ObsSync init error:", err);
    }
  }

  async confirmAndSync() {
    const confirmed = await this.confirm(
      "Sync Vault to GitHub",
      "This will push your vault notes to your GitHub repository. Your notes may contain sensitive information.",
    );
    if (confirmed) await this.doSync();
  }

  async confirmAndPush() {
    const confirmed = await this.confirm(
      "Push to GitHub",
      "This will push your local changes to your GitHub repository. Your notes may contain sensitive information.",
    );
    if (confirmed) await this.doPush();
  }

  async doSync(silent = false) {
    if (!this.validateSettings()) return;
    if (this.isSyncing) {
      if (!silent) new Notice("ObsSync: Sync already in progress...");
      return;
    }

    this.isSyncing = true;
    try {
      this.setStatusBar("syncing", "⟳ Pulling from GitHub...");
      if (!silent) new Notice("ObsSync: Syncing...");
      const engine = this.getSyncEngine();

      // Use step-by-step sync for progress reporting
      this.setStatusBar("pulling", "↓ Pulling...");
      let pullResult: SyncResult;
      try {
        pullResult = await engine.pull();
      } catch {
        pullResult = { pushed: [], pulled: [], conflicts: [], message: "Pull skipped." };
      }

      this.setStatusBar("pushing", "↑ Pushing...");
      const pushResult = await engine.push();

      // Build combined result
      const result: SyncResult = {
        pushed: pushResult.pushed,
        pulled: pullResult.pulled,
        conflicts: pullResult.conflicts,
        commitHash: pushResult.commitHash,
        skipped: pullResult.pulled.length === 0 && (pushResult.skipped ?? false),
        message: `Sync complete. Pushed ${pushResult.pushed.length} file(s), pulled ${pullResult.pulled.length} file(s).`,
      };

      if (result.skipped) {
        result.message = "Nothing to sync. Already up to date.";
      }

      // In silent mode (auto-sync), only show notice if something actually happened
      if (silent && result.skipped) {
        this.setStatusBar("idle");
        console.log("ObsSync: Nothing to sync. Already up to date.");
        return;
      }

      const timestamp = new Date().toLocaleTimeString();
      this.setStatusBar("success", `✓ Synced at ${timestamp} — ${pushResult.pushed.length} pushed, ${pullResult.pulled.length} pulled`);
      this.showResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatusBar("error", `✗ Sync failed: ${msg.slice(0, 50)}`);
      new Notice(`ObsSync Error: ${msg}`);
      console.error("ObsSync sync error:", err);
    } finally {
      this.isSyncing = false;
    }
  }

  async doPush() {
    if (!this.validateSettings()) return;
    if (this.isSyncing) return;

    this.isSyncing = true;
    try {
      this.setStatusBar("pushing", "↑ Pushing to GitHub...");
      new Notice("ObsSync: Pushing...");
      const engine = this.getSyncEngine();
      const result = await engine.push();
      const timestamp = new Date().toLocaleTimeString();
      this.setStatusBar("success", `✓ Pushed at ${timestamp} — ${result.pushed.length} file(s)`);
      this.showResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatusBar("error", `✗ Push failed: ${msg.slice(0, 50)}`);
      new Notice(`ObsSync Error: ${msg}`);
      console.error("ObsSync push error:", err);
    } finally {
      this.isSyncing = false;
    }
  }

  async doPull() {
    if (!this.validateSettings()) return;
    if (this.isSyncing) return;

    this.isSyncing = true;
    try {
      this.setStatusBar("pulling", "↓ Pulling from GitHub...");
      new Notice("ObsSync: Pulling...");
      const engine = this.getSyncEngine();
      const result = await engine.pull();
      const timestamp = new Date().toLocaleTimeString();
      this.setStatusBar("success", `✓ Pulled at ${timestamp} — ${result.pulled.length} file(s)`);
      this.showResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatusBar("error", `✗ Pull failed: ${msg.slice(0, 50)}`);
      new Notice(`ObsSync Error: ${msg}`);
      console.error("ObsSync pull error:", err);
    } finally {
      this.isSyncing = false;
    }
  }

  async showStatus() {
    try {
      const engine = this.getSyncEngine();
      const changes = await engine.getStatus();
      if (changes.length === 0) {
        new Notice("ObsSync: No changes detected.");
      } else {
        const summary = changes
          .slice(0, 10)
          .map((c) => `${c.status}: ${c.path}`)
          .join("\n");
        const extra = changes.length > 10 ? `\n...and ${changes.length - 10} more` : "";
        new Notice(`ObsSync Status:\n${summary}${extra}`, 10000);
      }
    } catch (err) {
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private showResult(result: SyncResult) {
    new Notice(`ObsSync: ${result.message}`, 5000);
    if (result.conflicts.length > 0) {
      const conflictList = result.conflicts
        .map((c) => `${c.path} (${c.resolution})`)
        .join("\n");
      new Notice(`ObsSync Conflicts:\n${conflictList}`, 10000);
    }
  }

  private setStatusBar(
    state: "idle" | "syncing" | "pushing" | "pulling" | "initializing" | "success" | "error",
    detail?: string,
  ) {
    if (!this.statusBarEl) return;
    const icons: Record<string, string> = {
      idle: "✓",
      syncing: "⟳",
      pushing: "↑",
      pulling: "↓",
      initializing: "⚙",
      success: "✓",
      error: "✗",
    };
    const labels: Record<string, string> = {
      idle: "ObsSync: Ready",
      syncing: "ObsSync: Syncing...",
      pushing: "ObsSync: Pushing...",
      pulling: "ObsSync: Pulling...",
      initializing: "ObsSync: Initializing...",
      success: "ObsSync: Done",
      error: "ObsSync: Failed",
    };
    const text = detail ? `${icons[state]} ${detail}` : `${icons[state]} ${labels[state]}`;
    this.statusBarEl.setText(text);

    // Auto-reset to idle after success/error
    if (state === "success" || state === "error") {
      setTimeout(() => this.setStatusBar("idle"), 10000);
    }
  }

  startSyncSchedule() {
    this.stopSyncSchedule();
    if (this.settings.autoSyncEnabled && this.settings.autoSyncIntervalMs > 0) {
      // Clamp interval to valid range
      const interval = Math.max(
        MIN_SYNC_INTERVAL_MS,
        Math.min(MAX_SYNC_INTERVAL_MS, this.settings.autoSyncIntervalMs),
      );
      this.syncIntervalId = this.registerInterval(
        window.setInterval(() => {
          this.doSync(true); // silent mode — no notice spam when nothing changed
        }, interval),
      );
    }
  }

  stopSyncSchedule() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  restartSyncSchedule() {
    this.syncEngine = null; // Force re-creation with new settings
    this.startSyncSchedule();
  }

  private confirm(title: string, message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(this.app, title, message, resolve);
      modal.open();
    });
  }
}

class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: import("obsidian").App,
    private title: string,
    private message: string,
    private onResult: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    contentEl.createEl("p", {
      text: "Make sure your GitHub repository is set to private.",
      cls: "mod-warning",
    });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => {
      this.resolved = true;
      this.onResult(false);
      this.close();
    });

    const confirmBtn = buttonContainer.createEl("button", {
      text: "Yes, sync now",
      cls: "mod-cta",
    });
    confirmBtn.addEventListener("click", () => {
      this.resolved = true;
      this.onResult(true);
      this.close();
    });
  }

  onClose() {
    if (!this.resolved) {
      this.onResult(false);
    }
    this.contentEl.empty();
  }
}
