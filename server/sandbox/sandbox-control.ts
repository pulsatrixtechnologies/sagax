// Who drives a person's server environment desktop right now (organization
// mode). The person takes control from the Computer tab (a live view with
// `?control=1`); while such a view stays open, their bots' computer use there
// is refused, never queued, exactly like the solo hold (computer-control.ts):
// a queued click would land on whatever the person has moved to. Closing the
// view (Release control, closing the tab, a lost connection) hands it back.
// Per boot and in memory on purpose: a hold is a live fact.

export const SANDBOX_CONTROL_REFUSAL =
  "The person has taken control of the desktop of their server environment, so your clicks and keystrokes there are refused until they release it. Wait for them, or tell them what you still need to do on the screen. Commands and files still work.";

export class SandboxControlHolds {
  private readonly holds = new Map<string, number>();

  /** One open control view. Returns its release (idempotent). */
  hold(principalId: string): () => void {
    const key = principalId.trim().toLowerCase();
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.holds.get(key) ?? 1) - 1;
      if (left > 0) this.holds.set(key, left);
      else this.holds.delete(key);
    };
  }

  held(principalId: string): boolean {
    return (this.holds.get(principalId.trim().toLowerCase()) ?? 0) > 0;
  }
}
