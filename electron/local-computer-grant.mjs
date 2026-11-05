// Hands this computer's driver connection to the server the app launched,
// and only to it: over each utility-process child's private parent port
// (server/computer/desktop-computer.ts). Only this main process can write to that
// port. It is sent when the child spawns and again on every driver change,
// so the server never reads the connection from a file or the environment.

export const LOCAL_COMPUTER_MESSAGE = "sagax:local-computer";

/**
 * @param {{
 *   current: () => unknown,
 *   isCurrent?: (proc: { postMessage(message: unknown): void }) => boolean,
 *   log?: (line: string) => void,
 * }} options
 */
export function createLocalComputerGrant({ current, isCurrent = () => true, log = () => {} }) {
  const children = new Set();

  function send(proc, connection) {
    try {
      proc.postMessage({ type: LOCAL_COMPUTER_MESSAGE, connection: connection ?? null });
      return true;
    } catch (error) {
      log(`local computer handoff failed: ${error?.message ?? error}`);
      return false;
    }
  }

  return Object.freeze({
    /** A server child this app just spawned. */
    attach(proc) {
      if (!proc) return false;
      children.add(proc);
      return send(proc, current());
    },
    /** That child exited: it is never sent anything again. */
    detach(proc) {
      children.delete(proc);
    },
    /** The driver changed (ready, stopped, unavailable). */
    changed(connection) {
      for (const proc of children) {
        if (isCurrent(proc)) send(proc, connection);
      }
    },
  });
}
