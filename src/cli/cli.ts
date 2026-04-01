import { Command } from "commander";
import chalk from "chalk";
import * as path from "path";
import { SyncEngine } from "../core/sync-engine.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { IsomorphicGitProvider } from "../git/isomorphic.js";
import { SimpleGitProvider } from "../git/simple.js";
import { VaultWatcher } from "./watcher.js";
import type { IGitProvider } from "../git/git-provider.js";
import type { SyncResult } from "../core/types.js";

const program = new Command();

function resolveVaultPath(vaultPath?: string): string {
  return path.resolve(vaultPath || process.cwd());
}

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

function getGitProvider(useSimpleGit: boolean): IGitProvider {
  return useSimpleGit ? new SimpleGitProvider() : new IsomorphicGitProvider();
}

function printResult(result: SyncResult): void {
  console.log(chalk.green(`✓ ${result.message}`));

  if (result.pushed.length > 0) {
    console.log(chalk.cyan(`  Pushed ${result.pushed.length} file(s):`));
    for (const change of result.pushed.slice(0, 20)) {
      const icon = change.status === "added" ? "+" : change.status === "deleted" ? "-" : "~";
      console.log(chalk.gray(`    ${icon} ${change.path}`));
    }
    if (result.pushed.length > 20) {
      console.log(chalk.gray(`    ...and ${result.pushed.length - 20} more`));
    }
  }

  if (result.conflicts.length > 0) {
    console.log(chalk.yellow(`  ⚠ ${result.conflicts.length} conflict(s):`));
    for (const conflict of result.conflicts) {
      console.log(chalk.yellow(`    ${conflict.path} → ${conflict.resolution}`));
      if (conflict.localCopyPath) {
        console.log(chalk.gray(`      Local copy: ${conflict.localCopyPath}`));
      }
    }
  }
}

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(chalk.red(`✗ Error: ${err.message}`));
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
  } else {
    console.error(chalk.red(`✗ Error: ${String(err)}`));
  }
  process.exit(1);
}

program
  .name("obssync")
  .description("Sync an Obsidian vault to a private GitHub repository")
  .version("0.1.0");

// init
program
  .command("init")
  .description("Initialize a vault for sync")
  .argument("[vault-path]", "Path to the vault directory")
  .requiredOption("-r, --remote <url>", "GitHub repository URL")
  .option("-t, --token <token>", "GitHub Personal Access Token")
  .option("-b, --branch <branch>", "Git branch", "main")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const token = options.token || getToken();
      const provider = getGitProvider(options.simpleGit);

      const config = await loadConfig(resolved);
      config.remote = options.remote;
      config.branch = options.branch;

      const engine = new SyncEngine(config, provider, resolved, token);
      await engine.initialize(options.remote);
      await saveConfig(resolved, config);

      console.log(chalk.green(`✓ Initialized vault at ${resolved}`));
      console.log(chalk.gray(`  Remote: ${options.remote}`));
      console.log(chalk.gray(`  Branch: ${options.branch}`));
    } catch (err) {
      handleError(err);
    }
  });

// push
program
  .command("push")
  .description("Push local changes to GitHub")
  .argument("[vault-path]", "Path to the vault directory")
  .option("-m, --message <message>", "Commit message")
  .option("-t, --token <token>", "GitHub Personal Access Token")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const token = options.token || getToken();
      const config = await loadConfig(resolved);
      const provider = getGitProvider(options.simpleGit);
      const engine = new SyncEngine(config, provider, resolved, token);
      const result = await engine.push(options.message);
      printResult(result);
    } catch (err) {
      handleError(err);
    }
  });

// pull
program
  .command("pull")
  .description("Pull changes from GitHub")
  .argument("[vault-path]", "Path to the vault directory")
  .option("-t, --token <token>", "GitHub Personal Access Token")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const token = options.token || getToken();
      const config = await loadConfig(resolved);
      const provider = getGitProvider(options.simpleGit);
      const engine = new SyncEngine(config, provider, resolved, token);
      const result = await engine.pull();
      printResult(result);
    } catch (err) {
      handleError(err);
    }
  });

// sync
program
  .command("sync")
  .description("Full sync (pull + push)")
  .argument("[vault-path]", "Path to the vault directory")
  .option("-m, --message <message>", "Commit message")
  .option("-t, --token <token>", "GitHub Personal Access Token")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const token = options.token || getToken();
      const config = await loadConfig(resolved);
      const provider = getGitProvider(options.simpleGit);
      const engine = new SyncEngine(config, provider, resolved, token);
      const result = await engine.fullSync(options.message);
      printResult(result);
    } catch (err) {
      handleError(err);
    }
  });

// status
program
  .command("status")
  .description("Show pending changes")
  .argument("[vault-path]", "Path to the vault directory")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const config = await loadConfig(resolved);
      const provider = getGitProvider(options.simpleGit);
      const engine = new SyncEngine(config, provider, resolved);
      const changes = await engine.getStatus();

      if (changes.length === 0) {
        console.log(chalk.green("✓ No changes detected."));
        return;
      }

      console.log(chalk.cyan(`${changes.length} changed file(s):`));
      for (const change of changes) {
        const color =
          change.status === "added"
            ? chalk.green
            : change.status === "deleted"
              ? chalk.red
              : chalk.yellow;
        const icon = change.status === "added" ? "+" : change.status === "deleted" ? "-" : "~";
        console.log(color(`  ${icon} ${change.path}`));
      }

      // Check oversized files
      const oversized = await engine.checkOversizedFiles();
      if (oversized.length > 0) {
        console.log(chalk.yellow(`\n⚠ ${oversized.length} file(s) exceed size limit:`));
        for (const file of oversized) {
          console.log(chalk.yellow(`  ! ${file}`));
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// watch
program
  .command("watch")
  .description("Watch vault and auto-sync on changes")
  .argument("[vault-path]", "Path to the vault directory")
  .option("-i, --interval <ms>", "Debounce interval in milliseconds", "300000")
  .option("-t, --token <token>", "GitHub Personal Access Token")
  .option("--simple-git", "Use system git instead of isomorphic-git")
  .action(async (vaultPath: string | undefined, options) => {
    try {
      const resolved = resolveVaultPath(vaultPath);
      const token = options.token || getToken();
      const config = await loadConfig(resolved);
      const provider = getGitProvider(options.simpleGit);
      const engine = new SyncEngine(config, provider, resolved, token);

      const watcher = new VaultWatcher(
        resolved,
        engine,
        parseInt(options.interval),
        config.excludePatterns,
        (msg) => console.log(chalk.cyan(`[ObsSync] ${msg}`)),
        (err) => console.error(chalk.red(`[ObsSync] Error: ${err.message}`)),
      );

      watcher.start();

      // Handle graceful shutdown
      const shutdown = () => {
        console.log(chalk.gray("\nShutting down..."));
        watcher.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      handleError(err);
    }
  });

program.parse();
