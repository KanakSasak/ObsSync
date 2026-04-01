import { Notice, Plugin } from "obsidian";
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

  async onload() {
    await this.loadSettings();

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
      callback: () => this.doSync(),
    });

    this.addCommand({
      id: "obssync-push",
      name: "Push to GitHub",
      callback: () => this.doPush(),
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
      this.doSync();
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
      new Notice("ObsSync: Initializing...");
      const engine = this.getSyncEngine();
      await engine.initialize(this.settings.remote);
      new Notice("ObsSync: Vault initialized for sync!");
    } catch (err) {
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
      console.error("ObsSync init error:", err);
    }
  }

  async doSync(silent = false) {
    if (!this.validateSettings()) return;
    if (this.isSyncing) {
      if (!silent) new Notice("ObsSync: Sync already in progress...");
      return;
    }

    this.isSyncing = true;
    try {
      if (!silent) new Notice("ObsSync: Syncing...");
      const engine = this.getSyncEngine();
      const result = await engine.fullSync();

      // In silent mode (auto-sync), only show notice if something actually happened
      if (silent && result.skipped) {
        console.log("ObsSync: Nothing to sync. Already up to date.");
        return;
      }

      this.showResult(result);
    } catch (err) {
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
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
      new Notice("ObsSync: Pushing...");
      const engine = this.getSyncEngine();
      const result = await engine.push();
      this.showResult(result);
    } catch (err) {
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
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
      new Notice("ObsSync: Pulling...");
      const engine = this.getSyncEngine();
      const result = await engine.pull();
      this.showResult(result);
    } catch (err) {
      new Notice(`ObsSync Error: ${err instanceof Error ? err.message : String(err)}`);
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
}
