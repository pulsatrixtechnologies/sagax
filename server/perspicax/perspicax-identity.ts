// One identity lease per MCP connection. The parent access token stays private
// in PerspicaxMcp; this only retains the profile and its expiry, never the token.
import en from "../../src/locales/en.json" with { type: "json" };
import fr from "../../src/locales/fr.json" with { type: "json" };

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

export interface PerspicaxIdentityProfile {
  slug: string;
  name: string;
  explicit_only: boolean;
}
export type IdentityFailure = "switch_not_consented" | "params_invalid" | "unavailable";
export interface IdentityInventory { supported: boolean; profiles: PerspicaxIdentityProfile[] }

export function identityWarning(reason: IdentityFailure, language: string): string {
  const key = reason === "unavailable" ? "perspicax.identity.failed" : `perspicax.identity.${reason}` as const;
  return (language === "fr" ? fr : en)[key];
}

export function identityValue(body: unknown): Json {
  const result = object(body) && object(body.result) ? body.result : {};
  if (object(result.structuredContent)) return result.structuredContent;
  const block = Array.isArray(result.content) ? result.content.find((item) => object(item) && item.type === "text") : undefined;
  try { const parsed: unknown = JSON.parse(object(block) ? String(block.text) : "{}"); return object(parsed) ? parsed : {}; } catch { return {}; }
}

export function identityLapsed(body: unknown): boolean {
  const result = object(body) && object(body.result) ? body.result : {};
  const meta = object(result._meta) ? result._meta : object(body) && object(body._meta) ? body._meta : {};
  return (object(meta.act_as) && meta.act_as.code === "act_as_expired") || !!identityValue(body).lapsed;
}

export function identityProfiles(body: unknown): PerspicaxIdentityProfile[] {
  const profiles = identityValue(body).profiles;
  return Array.isArray(profiles) ? profiles.filter((p): p is Json => object(p) && typeof p.slug === "string" && typeof p.name === "string" && !!p.name.trim())
    .map((p) => ({ slug: String(p.slug), name: String(p.name), explicit_only: p.explicit_only === true })) : [];
}

export function identityFailureReason(body: unknown): IdentityFailure {
  const encoded = JSON.stringify(body);
  return encoded.includes("switch_not_consented") ? "switch_not_consented" : encoded.includes("params_invalid") ? "params_invalid" : "unavailable";
}

export class PerspicaxIdentity {
  private readonly rpc: (method: string, params?: Json) => Promise<unknown>;
  private readonly warn: (reason: IdentityFailure) => void;
  private readonly now: () => number;
  private wanted: string;
  private supported?: boolean;
  private expiresAt = 0;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failed = false;
  private notified?: IdentityFailure;
  private tools: Json[] = [];
  private closing?: Promise<void>;

  constructor(input: { slug: string; rpc: PerspicaxIdentity["rpc"]; warn: PerspicaxIdentity["warn"]; now: () => number }) {
    this.wanted = input.slug;
    this.rpc = input.rpc;
    this.warn = input.warn;
    this.now = input.now;
  }

  invalidate(): void { this.expiresAt = 0; this.cancelTimer(); }
  profile(): string { return this.wanted; }
  active(): boolean {
    return !this.stopped && !this.failed && this.supported !== false
      && this.wanted.length > 0 && this.expiresAt > this.now();
  }

  async ensure(force = false): Promise<void> {
    if (this.stopped || !this.wanted || this.supported === false) return;
    if (!force && this.expiresAt > this.now() + 30_000) return;
    if (!force && this.failed) return;
    this.pending ??= this.switchOnce().finally(() => { this.pending = undefined; });
    await this.pending;
  }

  /** A bot may explicitly choose another block identity through the exposed
   * MCP tool. Its successful choice becomes the lease to renew and clear. */
  async observe(body: unknown): Promise<void> {
    const value = identityValue(body);
    if (object(body) && (body.error || (object(body.result) && body.result.isError))) {
      this.supported = true;
      try {
        const catalog = await this.rpc("tools/list");
        if (object(catalog) && object(catalog.result) && Array.isArray(catalog.result.tools)) this.tools = catalog.result.tools.filter(object);
      } catch { /* the last reviewed reads remain available */ }
      this.failure(identityFailureReason(body));
      return;
    }
    if (value.lapsed) { this.invalidate(); return; }
    if (!Object.hasOwn(value, "acting_as")) return;
    const acting = object(value.acting_as) ? value.acting_as : null;
    const token = acting && object(acting.token) ? acting.token : null;
    this.cancelTimer();
    this.supported = true;
    this.failed = false;
    this.wanted = acting && typeof acting.slug === "string" ? acting.slug : "";
    this.expiresAt = token && typeof token.expires_at === "string" ? Date.parse(token.expires_at) : 0;
    if (this.wanted && (!Number.isFinite(this.expiresAt) || this.expiresAt <= this.now())) { this.failure("unavailable"); return; }
    try {
      const catalog = await this.rpc("tools/list");
      if (object(catalog) && object(catalog.result) && Array.isArray(catalog.result.tools)) this.tools = catalog.result.tools.filter(object);
      this.schedule();
    } catch { this.failure("unavailable"); }
  }

  private schedule(): void {
    if (this.stopped || !this.wanted) return;
    this.cancelTimer();
    this.timer = setTimeout(() => { void this.ensure(true); }, Math.max(1_000, this.expiresAt - this.now() - 60_000));
    this.timer.unref?.();
  }

  private async switchOnce(parentRetried = false): Promise<void> {
    try {
      if (this.supported === undefined) {
        const listed = await this.rpc("tools/list");
        if (!object(listed) || !object(listed.result) || !Array.isArray(listed.result.tools)) throw new Error("unavailable");
        this.tools = listed.result.tools.filter(object);
        this.supported = this.tools.some((tool) => tool.name === "identity_switch");
        if (!this.supported) return; // An older Perspicax keeps its exact behaviour.
      }
      const answer = await this.rpc("tools/call", { name: "identity_switch", arguments: { profile: this.wanted } });
      const value = identityValue(answer);
      const acting = object(value.acting_as) ? value.acting_as : {};
      const token = object(acting.token) ? acting.token : {};
      const expiry = typeof token.expires_at === "string" ? Date.parse(token.expires_at) : NaN;
      if (acting.slug !== this.wanted || !Number.isFinite(expiry) || expiry <= this.now()) {
        // Perspicax's ToolError envelope uses error.detail.reason for consent.
        this.failure(identityFailureReason(answer));
        return;
      }
      this.failed = false;
      this.expiresAt = expiry;
      // Re-read on this very connection. Never reuse a catalogue from another
      // turn/person or merge tools that belonged to the previous identity.
      const catalog = await this.rpc("tools/list");
      if (!object(catalog) || !object(catalog.result) || !Array.isArray(catalog.result.tools)) throw new Error("unavailable");
      this.tools = catalog.result.tools.filter(object);
      if (this.expiresAt === 0) {
        // The catalogue request itself may have refreshed the parent token.
        // Its old lease is now lapsed too. Recover once before releasing work.
        if (!parentRetried) return this.switchOnce(true);
        throw new Error("unavailable");
      }
      this.schedule();
    } catch { this.failure("unavailable"); }
  }

  private failure(reason: IdentityFailure): void {
    this.failed = true;
    this.invalidate();
    if (!this.stopped && this.notified !== reason) {
      this.notified = reason;
      try { this.warn(reason); } catch { /* a notice never stops lease cleanup */ }
    }
  }

  private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  clear(): Promise<void> {
    this.closing ??= this.clearOnce();
    return this.closing;
  }

  /** Stop renewing this local lease without sending a remote clear. Used
   * after `profile_use` has already replaced the act-as identity remotely. */
  async detach(): Promise<void> {
    this.stopped = true;
    this.cancelTimer();
    await this.pending;
  }

  private async clearOnce(): Promise<void> {
    this.stopped = true;
    this.cancelTimer();
    await this.pending;
    if (this.supported) {
      try { await this.rpc("tools/call", { name: "identity_switch", arguments: { clear: true } }); } catch { /* session/token close is the backstop */ }
    }
  }
}
