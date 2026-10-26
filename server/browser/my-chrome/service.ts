// My Chrome, put together: the person's settings, the gate to their Chrome,
// what each bot session saw, and the Stop switch. One per server.
import { MyChromeGate, type MyChromeGateStatus } from "./gate.ts";
import { locateChrome } from "./locate.ts";
import { MyChromeMemory } from "./pilot.ts";
import { MY_CHROME_SHELL_NOTE } from "./shell.ts";
import { MyChromeSettingsStore, type MyChromeSettings } from "./settings.ts";
import { myChromeSiteAllows } from "./sites.ts";

export interface MyChromeStatus {
  /** This server offers My Chrome at all (desktop; an organization server only by hand). */
  offered: boolean;
  enabled: boolean;
  stopped: boolean;
  sites: MyChromeSettings["sites"];
  chromeAddress: string;
  /** Why a bot cannot use it now, or null. */
  unavailable: string | null;
  gate: MyChromeGateStatus;
}

export interface MyChromeServiceOptions {
  dataDir: string;
  /** An organization server (Perspicax): off unless its file says otherwise. */
  organization: boolean;
  /** Anything a viewer of the status should see changed. */
  onChange?(): void;
  /** Stop pressed (Sagax or a tab): close every engine session on My Chrome. */
  onStopped?(): void | Promise<void>;
  /** Tests: where Chrome is, instead of locateChrome. */
  locate?(address: string): Promise<string>;
}

export class MyChromeService {
  readonly memory = new MyChromeMemory();
  private readonly settings: MyChromeSettingsStore;
  private readonly options: MyChromeServiceOptions;
  private gate: MyChromeGate | null = null;
  private starting: Promise<MyChromeGate> | null = null;

  constructor(options: MyChromeServiceOptions) {
    this.options = options;
    this.settings = new MyChromeSettingsStore(options.dataDir);
  }

  get offered(): boolean {
    return !this.options.organization || this.settings.get().allowOnOrganizationServer;
  }

  /** Why a bot may not drive the person's Chrome now, or null. */
  unavailable(): string | null {
    const settings = this.settings.get();
    if (!this.offered) return "My Chrome is not offered on an organization server.";
    if (!settings.enabled) return "My Chrome is off. The person can turn it on in Settings > Experimental > My Chrome.";
    if (settings.stopped) return "The person stopped My Chrome. Only they can resume it, in Settings or the Sagax banner.";
    if (!settings.sites.length) return "No site is allowed in My Chrome yet. Ask the person to allow the site in Settings.";
    return null;
  }

  allows(url: string): boolean {
    if (this.unavailable() !== null) return false;
    return myChromeSiteAllows(this.settings.get().sites.map((site) => site.origin), url);
  }

  status(): MyChromeStatus {
    const settings = this.settings.get();
    return {
      offered: this.offered,
      enabled: settings.enabled,
      stopped: settings.stopped,
      sites: settings.sites,
      chromeAddress: settings.chromeAddress,
      unavailable: this.unavailable(),
      gate: this.gate?.status() ?? { stopped: settings.stopped, connected: false, lastActionAt: 0, clients: [] },
    };
  }

  /** The gate address one engine session connects to. Throws when My Chrome is
   * unavailable, or when the bot has a shell on this computer. */
  async urlFor(session: string, options: { hasShell?: boolean } = {}): Promise<string> {
    if (options.hasShell) throw new Error(MY_CHROME_SHELL_NOTE);
    const reason = this.unavailable();
    if (reason) throw new Error(reason);
    const gate = await this.ensureGate();
    return gate.urlFor(session);
  }

  takeNotes(session: string): string[] {
    return this.gate?.takeNotes(session) ?? [];
  }

  private ensureGate(): Promise<MyChromeGate> {
    if (this.gate) return Promise.resolve(this.gate);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const gate = new MyChromeGate({
        resolveChrome: () => (this.options.locate ?? ((address) => locateChrome(address)))(this.settings.get().chromeAddress),
        allows: (url) => this.allows(url),
        onChange: () => this.options.onChange?.(),
        onStopFromTab: () => { void this.stop(); },
      });
      await gate.start();
      if (this.settings.get().stopped) await gate.stop();
      this.gate = gate;
      return gate;
    })();
    this.starting.then(() => { this.starting = null; }, () => { this.starting = null; });
    return this.starting;
  }

  /** The one-click Stop: every engine connection to the person's Chrome ends
   * now, and stays refused until they resume. */
  async stop(): Promise<MyChromeStatus> {
    if (!this.settings.get().stopped) this.settings.update((draft) => { draft.stopped = true; });
    const gate = this.gate;
    await Promise.allSettled([gate?.stop(), this.options.onStopped?.()]);
    this.options.onChange?.();
    return this.status();
  }

  resume(): MyChromeStatus {
    this.settings.update((draft) => { draft.stopped = false; });
    this.gate?.resume();
    this.options.onChange?.();
    return this.status();
  }

  async setEnabled(enabled: boolean): Promise<MyChromeStatus> {
    if (enabled && !this.offered) throw new Error("My Chrome is not offered on an organization server.");
    this.settings.update((draft) => { draft.enabled = enabled; });
    if (!enabled) {
      // Turning it off ends any driving at once, like Stop, without the stop state.
      await Promise.allSettled([this.gate?.stop(), this.options.onStopped?.()]);
      this.gate?.resume();
    }
    this.options.onChange?.();
    return this.status();
  }

  allowSite(site: unknown): MyChromeStatus {
    this.settings.allowSite(site);
    this.options.onChange?.();
    return this.status();
  }

  revokeSite(site: unknown): MyChromeStatus {
    this.settings.revokeSite(site);
    this.options.onChange?.();
    return this.status();
  }

  setChromeAddress(address: unknown): MyChromeStatus {
    this.settings.setChromeAddress(address);
    this.options.onChange?.();
    return this.status();
  }

  async close(): Promise<void> {
    const gate = this.gate;
    this.gate = null;
    await gate?.close();
  }
}
