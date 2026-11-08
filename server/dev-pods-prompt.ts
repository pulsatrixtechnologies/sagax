// The coding view (the desktop's dev context pods, Settings > Developer > Experimental)
// is a switch on the person's device: the server never stores it. A send
// from a device where it is on carries `devPods: "on"`; the bot is then told
// the view exists and opens by itself, so it never answers that it cannot
// turn "coding mode" on. A send without the field says nothing about it.

/** Read the optional `devPods` field of a messages POST body. Anything but
 * "on" is off: an older client sends nothing and nothing is said. */
export function parseDevPods(value: unknown): boolean {
  return value === "on";
}

/** The newest send of each conversation decides, until the next one. */
export class DevPodsThreads {
  private readonly on = new Set<string>();
  private static readonly MAX = 5_000;

  note(threadId: string, on: boolean): void {
    if (!on) {
      this.on.delete(threadId);
      return;
    }
    this.on.delete(threadId);
    this.on.add(threadId);
    if (this.on.size > DevPodsThreads.MAX) {
      const oldest = this.on.values().next().value;
      if (oldest !== undefined) this.on.delete(oldest);
    }
  }

  isOn(threadId: string): boolean {
    return this.on.has(threadId);
  }
}

export const DEV_PODS_PROMPT =
  "Sagax's coding view is on for this person: while you do coding work in this conversation (running commands, editing code, git, pull requests), context panels open by themselves beside the chat (environment, context use, connectors, files you produced, your changes). If they ask you to turn on coding mode or the coding view, tell them it is on and opens by itself during coding work. No tool is needed for it.";

export function devPodsPrompt(on: boolean): string {
  return on ? DEV_PODS_PROMPT : "";
}
