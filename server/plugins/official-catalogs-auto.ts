// Outside an organization, every official catalog (shared/skill-catalogs.ts)
// is added to the person's marketplace list on its own: at the first start
// and again when a later version brings a new one. It runs in the background
// (never holding the start), one catalog at a time; a catalog that fails is
// tried again later and its error shows on its own row only. A catalog the
// person removed is not added again (PluginMarketplaces.dismissedOfficial).
import { OFFICIAL_CATALOGS, type OfficialCatalog } from "../../shared/skill-catalogs.ts";

/** the wait before the first retry; it doubles up to the longest */
export const OFFICIAL_AUTO_RETRY_MS = 10 * 60_000;
export const OFFICIAL_AUTO_RETRY_MAX_MS = 6 * 60 * 60_000;

export interface OfficialCatalogsAutoOptions {
  /** false inside an organization: nothing is added */
  enabled: () => boolean;
  /** sources (lowercase) already in the list */
  sources: () => Set<string>;
  /** ids of the catalogs the person removed */
  dismissed: () => string[];
  add: (catalog: OfficialCatalog) => Promise<unknown>;
  catalogs?: readonly OfficialCatalog[];
  log?: (line: string) => void;
}

export interface OfficialCatalogsAuto {
  /** one pass now; joins a pass already running */
  run(): Promise<void>;
  /** the last error per catalog id still failing */
  errors(): Record<string, string>;
  stop(): void;
}

export function startOfficialCatalogsAuto(options: OfficialCatalogsAutoOptions): OfficialCatalogsAuto {
  const catalogs = options.catalogs ?? OFFICIAL_CATALOGS;
  const log = options.log ?? ((line: string) => console.warn(line));
  const failures = new Map<string, string>();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = OFFICIAL_AUTO_RETRY_MS;
  let running: Promise<void> | null = null;
  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);

  const pass = async (): Promise<void> => {
    if (!options.enabled()) { failures.clear(); return; }
    let missing: OfficialCatalog[] = [];
    try {
      const have = options.sources();
      const dismissed = new Set(options.dismissed());
      missing = catalogs.filter((catalog) => !have.has(catalog.source.toLowerCase()) && !dismissed.has(catalog.id));
    } catch (error) {
      log(`[plugins] official catalogs could not be listed: ${reason(error)}`);
      return;
    }
    for (const catalog of catalogs) if (!missing.includes(catalog)) failures.delete(catalog.id);
    for (const catalog of missing) {
      if (stopped) return;
      try {
        await options.add(catalog);
        failures.delete(catalog.id);
      } catch (error) {
        failures.set(catalog.id, reason(error));
        log(`[plugins] official catalog ${catalog.id} not added yet, will retry: ${reason(error)}`);
      }
    }
  };

  const schedule = (): void => {
    if (stopped || failures.size === 0) { delay = OFFICIAL_AUTO_RETRY_MS; return; }
    timer = setTimeout(() => { timer = null; void once(); }, delay);
    timer.unref?.();
    delay = Math.min(delay * 2, OFFICIAL_AUTO_RETRY_MAX_MS);
  };

  const once = (): Promise<void> => {
    running ??= pass()
      .catch((error) => { log(`[plugins] official catalogs pass stopped: ${reason(error)}`); })
      .finally(() => { running = null; schedule(); });
    return running;
  };

  // after the start, never during it
  const first = setTimeout(() => { void once(); }, 0);
  first.unref?.();

  return {
    run: () => (stopped ? Promise.resolve() : once()),
    errors: () => Object.fromEntries(failures),
    stop() {
      stopped = true;
      clearTimeout(first);
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
