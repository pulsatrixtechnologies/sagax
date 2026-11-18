import { describe, expect, it } from "vitest";
import { createInstallQueue } from "./install-queue";

function harness() {
  const marked = new Set<string>();
  const errors: Record<string, string | null> = {};
  const panel: string[] = [];
  const queue = createInstallQueue({
    mark: (id, on) => { if (on) marked.add(id); else marked.delete(id); },
    cardError: (id, message) => { errors[id] = message; },
    panelError: (message) => { panel.push(message); },
    describe: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  return { queue, marked, errors, panel };
}
const gate = () => { let open!: () => void; const wait = new Promise<void>((resolve) => { open = resolve; }); return { wait, open }; };

describe("the install queue: several adds in a row", () => {
  it("marks every pressed card at once, runs them one after the other, and clears each as it finishes", async () => {
    const { queue, marked } = harness();
    const first = gate();
    const order: string[] = [];
    const a = queue.run(["a"], async () => { order.push("a start"); await first.wait; order.push("a end"); });
    const b = queue.run(["b"], async () => { order.push("b start"); });
    const c = queue.run(["c"], async () => { order.push("c start"); });
    // pressed three in a row: all three show their spinner right away, nothing waited for the first
    expect([...marked].sort()).toEqual(["a", "b", "c"]);
    await Promise.resolve();
    expect(order).toEqual(["a start"]);
    first.open();
    await Promise.all([a, b, c]);
    expect(order).toEqual(["a start", "a end", "b start", "c start"]);
    expect(marked.size).toBe(0);
  });

  it("an error stays on its own card and the next add still runs", async () => {
    const { queue, errors, panel } = harness();
    let ran = false;
    await queue.run(["bad"], async () => { throw new Error("The marketplace could not be reached."); });
    await queue.run(["good"], async () => { ran = true; });
    expect(errors.bad).toBe("The marketplace could not be reached.");
    expect(errors.good).toBeNull();
    expect(ran).toBe(true);
    expect(panel).toEqual([]);
  });

  it("a page with no card of the list gets the error at the top of the panel", async () => {
    const { queue, errors, panel } = harness();
    await queue.run(["x"], async () => { throw new Error("nope"); }, "panel");
    expect(panel).toEqual(["nope"]);
    expect(errors.x).toBeNull();
  });

  it("a new press clears the card's earlier error, and says whether it is the only one", async () => {
    const { queue, errors } = harness();
    await queue.run(["a"], async () => { throw new Error("first try"); });
    expect(errors.a).toBe("first try");
    const seen: boolean[] = [];
    const hold = gate();
    const one = queue.run(["a"], async (alone) => { seen.push(alone); await hold.wait; });
    expect(errors.a).toBeNull();
    const two = queue.run(["b"], async (alone) => { seen.push(alone); });
    hold.open();
    await Promise.all([one, two]);
    expect(seen).toEqual([false, true]);
  });
});
