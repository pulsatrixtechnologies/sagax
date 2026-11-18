// Plugins and connectors: an add, an update or a removal runs in one queue,
// one after the other, and never holds the panel. Each card is marked at the
// press (queued ones too), so it shows its own spinner at once; the other
// cards stay usable, so several can be added in a row; a failure lands on the
// card it belongs to. One at a time keeps each answer (the list of
// marketplaces it returns) in order.

export interface InstallQueueHooks {
  /** a card starts (or stops) showing its spinner */
  mark: (id: string, on: boolean) => void;
  /** a card's own error line; null clears it */
  cardError: (id: string, message: string | null) => void;
  /** an error shown at the top of the panel, for a page with no card of this list */
  panelError: (message: string) => void;
  /** words for an error */
  describe: (cause: unknown) => string;
}

export interface InstallQueue {
  /** `alone`: nothing else was waiting when this one started */
  run: (ids: readonly string[], work: (alone: boolean) => Promise<void>, errorOn?: "card" | "panel") => Promise<void>;
}

export function createInstallQueue(hooks: InstallQueueHooks): InstallQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    run(ids, work, errorOn = "card") {
      for (const id of ids) { hooks.mark(id, true); hooks.cardError(id, null); }
      pending += 1;
      const done = chain.then(async () => {
        try {
          await work(pending === 1);
        } catch (cause) {
          const message = hooks.describe(cause);
          if (errorOn === "panel") hooks.panelError(message);
          else for (const id of ids) hooks.cardError(id, message);
        } finally {
          pending -= 1;
          for (const id of ids) hooks.mark(id, false);
        }
      });
      chain = done;
      return done;
    },
  };
}
