import { TurnResources, type TurnOwner } from "../turn-resources.ts";

/** A local desktop call competes with ordinary bot turns for the same screen.
 * Leases expire if Electron crashes; human takeover always wins renewal. */
const LEASE_EXPIRY_MS = 40_000;
const HOST = "computer:host";

type SharedComputerLease = { timer: NodeJS.Timeout; generation: number; lastActivity: number };

/** Why a lent screen call was refused, in words the calling bot can act on.
 * Only `person` means a person: everything else is a bot or a check. */
export type SharedComputerRefusalCode = "screen_bot" | "screen_person";

export type SharedComputerHolders = {
  /** A person took control of this computer's own screen in the app. Only a
   * takeover of this screen counts, never one of another computer. */
  personHolding: () => boolean;
  /** Who a turn claim belongs to, and whether that turn is still running.
   * A claim whose turn ended without letting go is stale. */
  describe: (owner: TurnOwner) => { name?: string; live: boolean };
};

function refusal(message: string, code: SharedComputerRefusalCode, holder?: string) {
  return Object.assign(new Error(message), { status: 409, code, ...(holder ? { holder } : {}) });
}

export function screenBotRefusalText(holder?: string): string {
  return `Another bot on this computer${holder ? `, ${holder},` : ""} is using its screen right now, so this call was not performed. It is not a person. Work on something that does not need the screen, then try again in a minute.`;
}

export const SCREEN_PERSON_REFUSAL = "A person took control of this computer's screen, so this call was not performed. Wait until they hand it back, then observe the screen again before acting.";

export class SharedComputerControl {
  private leases = new Map<string, SharedComputerLease>();
  private resources: TurnResources;
  private holders: SharedComputerHolders;
  constructor(resources: TurnResources, holders: SharedComputerHolders) { this.resources = resources; this.holders = holders; }

  acquire(id: string) {
    const owner = this.owner(id);
    if (this.holders.personHolding()) {
      this.release(id);
      throw refusal(SCREEN_PERSON_REFUSAL, "screen_person");
    }
    // The desktop runs one lent call at a time (electron/computer-sharing.mjs),
    // so an older lent lease still here lost its release: a crash, or a
    // release that timed out. It never blocks the newer call.
    for (const other of this.leases.keys()) if (other !== id) this.release(other);
    if (!this.resources.claim(HOST, owner)) {
      const blocker = this.resources.blocker(HOST, owner);
      // A turn that ended without letting go of the screen holds nothing.
      if (blocker && !blocker.threadId.startsWith("shared:") && !this.holders.describe(blocker).live) {
        this.resources.release(blocker);
      }
      if (!this.resources.claim(HOST, owner)) {
        const holder = this.resources.blocker(HOST, owner);
        const name = holder ? this.holders.describe(holder).name : undefined;
        this.release(id);
        throw refusal(screenBotRefusalText(name), "screen_bot", name);
      }
    }
    this.arm(id);
  }
  /** Extends a held lease for one long desktop action without re-running the
   * takeover checks: a heartbeat while the operation is pending must not be
   * able to lose its own screen. Renewing an expired or released id renews
   * nothing and says so: only acquire can bring it back. */
  renew(id: string): boolean {
    if (!this.leases.has(id) || !this.resources.owns(HOST, this.owner(id))) return false;
    this.arm(id);
    return true;
  }
  /** (Re)arm the expiry timer. The generation counter makes a stale timer a
   * no-op: only the callback of the newest arming may release the lease. */
  private arm(id: string) {
    const previous = this.leases.get(id);
    if (previous) clearTimeout(previous.timer);
    const generation = (previous?.generation ?? 0) + 1;
    this.leases.set(id, {
      timer: setTimeout(() => {
        if (this.leases.get(id)?.generation === generation) this.release(id);
      }, LEASE_EXPIRY_MS),
      generation,
      lastActivity: Date.now(),
    });
  }
  private owner(id: string): TurnOwner { return { threadId: `shared:${id}`, generation: id }; }
  release(id: string) {
    const lease = this.leases.get(id);
    if (lease) { clearTimeout(lease.timer); this.leases.delete(id); }
    this.resources.release(this.owner(id));
  }
  close() { for (const id of this.leases.keys()) this.release(id); }
}
