import { promises as fs } from "fs";
import * as path from "path";
import { ObsSyncConfig, DEFAULT_CONFIG, ObsSyncError } from "./types.js";

const CONFIG_FILENAME = ".obssync.json";

export function getConfigPath(vaultPath: string): string {
  return path.join(vaultPath, CONFIG_FILENAME);
}

export function getDefaultConfig(): ObsSyncConfig {
  return { ...DEFAULT_CONFIG };
}

export async function loadConfig(vaultPath: string): Promise<ObsSyncConfig> {
  const configPath = getConfigPath(vaultPath);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return getDefaultConfig();
    }
    throw new ObsSyncError(
      `Failed to load config from ${configPath}`,
      "INVALID_CONFIG",
      err instanceof Error ? err : undefined,
    );
  }
}

export async function saveConfig(
  vaultPath: string,
  config: ObsSyncConfig,
): Promise<void> {
  const configPath = getConfigPath(vaultPath);
  const { ...configToSave } = config;
  await fs.writeFile(configPath, JSON.stringify(configToSave, null, 2) + "\n", "utf-8");
}
