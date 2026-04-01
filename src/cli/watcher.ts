import { watch, type FSWatcher } from "chokidar";
import { SyncEngine } from "../core/sync-engine.js";

export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private vaultPath: string,
    private syncEngine: SyncEngine,
    private intervalMs: number,
    private excludePatterns: string[],
    private onSync?: (message: string) => void,
    private onError?: (error: Error) => void,
  ) {}

  start(): void {
    if (this.running) return;

    const ignored = [
      /(^|[/\\])\../, // dotfiles
      "**/node_modules/**",
      "**/.git/**",
      ...this.excludePatterns.map((p) => `**/${p}/**`),
    ];

    this.watcher = watch(this.vaultPath, {
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    this.watcher.on("all", (_event, _path) => {
      this.scheduleSync();
    });

    this.watcher.on("error", (err: unknown) => {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    this.running = true;
    this.onSync?.(`Watching ${this.vaultPath} for changes (interval: ${this.intervalMs / 1000}s)`);
  }

  stop(): void {
    if (!this.running) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.watcher?.close();
    this.watcher = null;
    this.running = false;
    this.onSync?.("Watcher stopped.");
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const result = await this.syncEngine.fullSync();
        this.onSync?.(result.message);
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }, this.intervalMs);
  }
}
