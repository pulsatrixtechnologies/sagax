// My Chrome, put together: the person's settings, the gate to their Chrome,
// what each bot session saw, and the Stop switch. One per server.
import { MyChromeGate, type MyChromeGateStatus } from "./gate.ts";
import { locateChrome } from "./locate.ts";
import { MyChromeMemory } from "./pilot.ts";
import { MY_CHROME_SHELL_NOTE } from "./shell.ts";
import { MY_CHROME_RECORDING_IDLE_MS, MyChromeRecording, type MyChromeRecordingStatus } from "./recorder.ts";
import { MyChromeSettingsStore, type MyChromeSettings } from "./settings.ts";
import { myChromeSiteAllows } from "./sites.ts";
import type { TeachReplay, TeachStep } from "../../../shared/teach-recording.ts";
import { reportBackgroundError } from "../../background-error.ts";

/** A recording handed back on Stop: the steps, and where the path is
 * replayed unless the person changes it: out of sight in the bot's own
 * browser (web work stays out of sight, AGENTS.md 2026-10-28); the person
 * picks My Chrome when the task needs their signed-in session. */
export interface MyChromeRecordingResult {
  steps: TeachStep[];
  recordedAt: string;
  replay: TeachReplay;
  ended: MyChromeRecordingStatus["ended"];
}

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
  /** The one recording of this computer's person (one Chrome, one person). */
  private recording: MyChromeRecording | null = null;

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
        onStopFromTab: () => { void this.stop().catch(reportBackgroundError); },
      });
      await gate.start();
      if (this.settings.get().stopped) await gate.stop();
      this.gate = gate;
      return gate;
    })();
    this.starting.then(() => { this.starting = null; }, () => { this.starting = null; });
    return this.starting;
  }

  /** Why the person cannot record in their Chrome now, or null. Sites are
   * not needed: the person records their own work, on any site. */
  recordingUnavailable(): string | null {
    const settings = this.settings.get();
    if (!this.offered) return "My Chrome is not offered on an organization server.";
    if (!settings.enabled) return "My Chrome is off. Turn it on in Settings > Experimental > My Chrome.";
    if (settings.stopped) return "My Chrome is stopped. Resume it in Settings first.";
    return null;
  }

  private liveRecording(now = Date.now()): MyChromeRecording | null {
    const recording = this.recording;
    if (recording && recording.ended === null && now - recording.touchedAt > MY_CHROME_RECORDING_IDLE_MS) {
      void recording.stop("idle").catch(reportBackgroundError);
    }
    // an idle recording is dropped whole: nothing is kept past the idle time
    if (recording && recording.ended === "idle") { this.recording = null; return null; }
    return recording;
  }

  /** Open a tab in the person's Chrome and record what they show there. A
   * recording still open is replaced (its steps are dropped). */
  async startRecording(url: unknown): Promise<MyChromeRecordingStatus> {
    const reason = this.recordingUnavailable();
    if (reason) throw new Error(reason);
    const start = typeof url === "string" ? url.trim() : "";
    if (start && !/^https?:\/\//i.test(start)) throw new Error("Start from an http or https address, or leave it empty.");
    await this.recording?.stop("person");
    this.recording = null;
    const gate = await this.ensureGate();
    const recording = new MyChromeRecording({ onChange: () => this.options.onChange?.() });
    await recording.start((onEvent) => gate.openRecorderTab(onEvent), start);
    this.recording = recording;
    return recording.status();
  }

  recordingStatus(): MyChromeRecordingStatus | null {
    return this.liveRecording()?.status() ?? null;
  }

  /** A narration note at this point of the recording. */
  recordingNote(text: unknown): MyChromeRecordingStatus | null {
    const recording = this.liveRecording();
    if (!recording) return null;
    recording.note(text);
    return recording.status();
  }

  /** Stop: the steps once, and the recording is gone. */
  async stopRecording(): Promise<MyChromeRecordingResult | null> {
    const recording = this.liveRecording();
    this.recording = null;
    if (!recording) return null;
    await recording.stop("person");
    return { steps: recording.result(), recordedAt: recording.startedAt, replay: "background", ended: recording.ended };
  }

  discardRecording(): void {
    const recording = this.recording;
    this.recording = null;
    void recording?.stop("person");
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
    this.discardRecording();
    const gate = this.gate;
    this.gate = null;
    await gate?.close();
  }
}
