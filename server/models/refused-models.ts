// #1696: models a provider refused for conversations (openai-chat.ts
// refusesModel / #1688). They leave that engine's catalog so neither the
// picker nor Auto offers them again. Persisted under DATA_DIR so a restart
// does not retry the same refusal.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";
import { writeFileAtomic } from "../atomic.ts";

interface Row {
  instanceId: string;
  model: string;
  at: number;
}

interface Saved {
  refused: Row[];
}

const MAX_ROWS = 2_000;

function load(file: string): Saved {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Saved>;
    const refused = Array.isArray(raw.refused) ? raw.refused.filter((row): row is Row =>
      typeof row?.instanceId === "string" && row.instanceId.trim() !== "" &&
      typeof row?.model === "string" && row.model.trim() !== "" &&
      Number.isFinite(row?.at)) : [];
    return { refused };
  } catch {
    return { refused: [] };
  }
}

export interface RefusedModelsStoreDeps {
  /** The JSON file (DATA_DIR/refused-models.json); null keeps it in memory. */
  file: string | null;
  now?: () => number;
}

/** Models refused for conversations on an engine instance. */
export class RefusedModelsStore {
  private readonly deps: RefusedModelsStoreDeps;
  private state: Saved;

  constructor(deps: RefusedModelsStoreDeps) {
    this.deps = deps;
    this.state = deps.file ? load(deps.file) : { refused: [] };
  }

  remember(instanceId: string, model: string): void {
    const id = instanceId.trim();
    const name = model.trim();
    if (!id || !name) return;
    if (this.state.refused.some((row) => row.instanceId === id && row.model === name)) return;
    this.state.refused = [...this.state.refused, { instanceId: id, model: name, at: (this.deps.now ?? Date.now)() }].slice(-MAX_ROWS);
    this.save();
  }

  refused(instanceId: string): ReadonlySet<string> {
    const id = instanceId.trim();
    const out = new Set<string>();
    for (const row of this.state.refused) if (row.instanceId === id) out.add(row.model);
    return out;
  }

  private save(): void {
    if (!this.deps.file) return;
    try {
      writeFileAtomic(this.deps.file, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error(`refused models: could not save: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

let active: RefusedModelsStore | null = null;

/** The process store: DATA_DIR/refused-models.json, or memory under Vitest. */
export function refusedModelsStore(): RefusedModelsStore {
  if (!active) {
    active = new RefusedModelsStore({
      file: process.env.VITEST ? null : join(DATA_DIR, "refused-models.json"),
    });
  }
  return active;
}

/** Tests: swap the process store (null restores the default on next read). */
export function setRefusedModelsStore(store: RefusedModelsStore | null): void {
  active = store;
}
