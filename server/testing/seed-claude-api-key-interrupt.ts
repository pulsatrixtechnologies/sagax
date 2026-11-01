// Make the verification fixture's custom `claude` instance rebuild when
// Settings saves anthropic.key. Product injects ANTHROPIC_API_KEY only into
// claudeApi (or an instance with access:api + requireApiKey); the default
// fixture instance is neither, so a bare anthropic.key save used to change
// only claudeApi and left in-flight fixture turns running (stale e2e).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_ANTHROPIC_KEY_V1 = "fixture-anthropic-key-v1";
export const FIXTURE_ANTHROPIC_KEY_V2 = "fixture-anthropic-key-v2";

/** Rewrite DATA_DIR/config.json before boot so anthropic.key is part of the
 * fixture claude launch. Call from prepareDataDir. */
export function seedClaudeApiKeyForInterrupt(
  dataDir: string,
  initialKey = FIXTURE_ANTHROPIC_KEY_V1,
): void {
  const path = join(dataDir, "config.json");
  const cfg = JSON.parse(readFileSync(path, "utf8")) as {
    anthropic?: { key?: string };
    instances?: Record<string, {
      access?: string;
      config?: Record<string, unknown>;
    }>;
  };
  cfg.anthropic = { ...cfg.anthropic, key: initialKey };
  const claude = cfg.instances?.claude;
  if (claude) {
    claude.access = "api";
    claude.config = { ...claude.config, requireApiKey: true };
  }
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}
