import { PluginSettingTab, Setting, type App } from "obsidian";
import type ObsSyncPlugin from "./main.js";
import { MIN_SYNC_INTERVAL_MS, MAX_SYNC_INTERVAL_MS } from "../core/types.js";

export class ObsSyncSettingTab extends PluginSettingTab {
  plugin: ObsSyncPlugin;

  constructor(app: App, plugin: ObsSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "ObsSync Settings" });

    // GitHub Token
    new Setting(containerEl)
      .setName("GitHub Token")
      .setDesc(
        "Personal Access Token with 'repo' scope. Get one from GitHub → Settings → Developer settings → Personal access tokens.",
      )
      .addText((text) => {
        text
          .setPlaceholder("ghp_xxxxxxxxxxxxxxxxxxxx")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.style.width = "300px";
      });

    // Remote URL
    new Setting(containerEl)
      .setName("Remote URL")
      .setDesc(
        "GitHub repository URL (e.g., https://github.com/username/vault-backup.git)",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://github.com/user/vault.git")
          .setValue(this.plugin.settings.remote)
          .onChange(async (value) => {
            this.plugin.settings.remote = value;
            await this.plugin.saveSettings();
          }),
      );

    // Branch
    new Setting(containerEl)
      .setName("Branch")
      .setDesc("Git branch to sync with")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value;
            await this.plugin.saveSettings();
          }),
      );

    // Auto-sync toggle
    new Setting(containerEl)
      .setName("Auto-sync")
      .setDesc("Automatically sync on a schedule")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncEnabled)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncEnabled = value;
            await this.plugin.saveSettings();
            // Restart sync schedule with new setting
            this.plugin.restartSyncSchedule();
          }),
      );

    // Sync interval
    new Setting(containerEl)
      .setName("Sync interval")
      .setDesc(
        `How often to auto-sync (min: ${MIN_SYNC_INTERVAL_MS / 1000}s, max: ${MAX_SYNC_INTERVAL_MS / 3600000}h). ` +
        "Duplicate pushes are skipped automatically when nothing has changed.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("60000", "1 minute")
          .addOption("300000", "5 minutes")
          .addOption("600000", "10 minutes")
          .addOption("1800000", "30 minutes")
          .addOption("3600000", "1 hour")
          .setValue(String(this.plugin.settings.autoSyncIntervalMs))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            const clamped = Math.max(MIN_SYNC_INTERVAL_MS, Math.min(MAX_SYNC_INTERVAL_MS, parsed));
            this.plugin.settings.autoSyncIntervalMs = clamped;
            await this.plugin.saveSettings();
            this.plugin.restartSyncSchedule();
          }),
      );

    // Commit message prefix
    new Setting(containerEl)
      .setName("Commit prefix")
      .setDesc("Prefix for auto-generated commit messages")
      .addText((text) =>
        text
          .setPlaceholder("vault:")
          .setValue(this.plugin.settings.commitMessagePrefix)
          .onChange(async (value) => {
            this.plugin.settings.commitMessagePrefix = value;
            await this.plugin.saveSettings();
          }),
      );

    // Exclude patterns
    new Setting(containerEl)
      .setName("Exclude patterns")
      .setDesc("Paths to exclude from sync (comma-separated)")
      .addTextArea((textArea) => {
        textArea
          .setPlaceholder(".obsidian, .trash, .obssync.json")
          .setValue(this.plugin.settings.excludePatterns.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.excludePatterns = value
              .split(",")
              .map((p) => p.trim())
              .filter((p) => p.length > 0);
            await this.plugin.saveSettings();
          });
        textArea.inputEl.rows = 3;
        textArea.inputEl.style.width = "100%";
      });
  }
}
