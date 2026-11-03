// The person's usage measure. Off until they turn it on. Events stay on
// this server, in their own file, and never include a name.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { usageEvent, type UsageEvent } from "../../shared/usage-meter.ts";
import { writeFileAtomic } from "../atomic.ts";

const FILE = "usage-meter.json";
const MAX_EVENTS = 200;
const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export type UsageMeterScope = { organization: false } | { organization: true; principalId: string };

interface Saved {
  enabled: boolean;
  events: Array<UsageEvent & { at: number }>;
}

const EMPTY: Saved = { enabled: false, events: [] };

export function usageMeterScope(organization: boolean, principalId: string | null | undefined): UsageMeterScope | null {
  if (!organization) return { organization: false };
  const id = principalId?.trim().toLowerCase() ?? "";
  return PRINCIPAL.test(id) ? { organization: true, principalId: id } : null;
}

function fileFor(dataDir: string, scope: UsageMeterScope): string {
  return scope.organization
    ? join(dataDir, "principals", scope.principalId, FILE)
    : join(dataDir, FILE);
}

function load(file: string): Saved {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Saved>;
    const events = Array.isArray(raw.events) ? raw.events.flatMap((row) => {
      const event = usageEvent(row?.name, row?.props);
      return event && Number.isFinite(row?.at) ? [{ ...event, at: row.at }] : [];
    }) : [];
    return { enabled: raw.enabled === true, events };
  } catch {
    return { ...EMPTY, events: [] };
  }
}

export class UsageMeter {
  private readonly dataDir: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = () => Date.now()) {
    this.dataDir = dataDir;
    this.now = now;
  }

  private path(scope: UsageMeterScope): string {
    return fileFor(this.dataDir, scope);
  }

  read(scope: UsageMeterScope): { enabled: boolean; count: number } {
    const saved = load(this.path(scope));
    return { enabled: saved.enabled, count: saved.events.length };
  }

  /** The person's own switch. Nothing is recorded until this is true. */
  setEnabled(scope: UsageMeterScope, enabled: boolean): { enabled: boolean; count: number } {
    const saved = load(this.path(scope));
    const next = { enabled, events: enabled ? saved.events : [] };
    this.write(scope, next);
    return { enabled: next.enabled, count: next.events.length };
  }

  /** Records one closed event. Returns false when the measure is off, and writes nothing. */
  record(scope: UsageMeterScope, name: unknown, props: unknown): boolean {
    const saved = load(this.path(scope));
    if (!saved.enabled) return false;
    const event = usageEvent(name, props);
    if (!event) return false;
    const events = [...saved.events, { ...event, at: this.now() }].slice(-MAX_EVENTS);
    this.write(scope, { enabled: true, events });
    return true;
  }

  private write(scope: UsageMeterScope, saved: Saved): void {
    const file = this.path(scope);
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(saved));
  }
}
