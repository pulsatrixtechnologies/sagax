// The "Me" scope uses the same complete plugin installation and update
// machinery as a bot, while its switches and values stay in the person's
// encrypted capabilities.enc. Plugin source files contain no login token.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { BotPluginsOptions } from "../bots/bot-plugins.ts";
import { principalDir, type PersonCapabilities } from "../person-connections.ts";

export function personalPluginStorage(dataDir: string, capabilities: PersonCapabilities): NonNullable<BotPluginsOptions["storage"]> {
  return {
    root: (id) => join(principalDir(dataDir, id), "capability-plugins"),
    ids: () => {
      try {
        return readdirSync(join(dataDir, "principals"), { withFileTypes: true })
          .filter((entry) => {
            if (!entry.isDirectory()) return false;
            try { principalDir(dataDir, entry.name); return true; } catch { return false; }
          }).map((entry) => entry.name);
      } catch { return []; }
    },
    read: (id) => capabilities.pluginState(id),
    write: (id, state) => capabilities.setPluginState(id, state),
    values: (id) => capabilities.pluginValues(id),
    writeValues: (id, values) => capabilities.setPluginValues(id, values),
    credentialScope: (id) => `person:${id}`,
  };
}
