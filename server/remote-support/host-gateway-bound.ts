// The limits of the gateway calls and of the OS read on the bot-computer path
// (`host_computer`, #3518). One call of that tool must end under the bot's
// tool timeout (`MCP_TOOL_TIMEOUT_MS`, server/drivers/pi-mcp-extension.ts), so
// every wait on its path has a limit of its own. The gateway calls (host list,
// open, the close inside a session close) do not use the 10 minutes of
// `PERSPICAX_RELAY_TIMEOUT_MS`, which stays as it is for every other caller:
// a gateway answers in well under a second, so a call past this is a gateway
// that is not answering, and the path gives up on it.

/** The longest one gateway call of that path (a host list, a session close,
 * a close of a session the host never took) is waited for. A seat's own
 * set-up (MCP mount, token exchange) is inside it.
 *
 * These values come from the budget, not from measured latency: nothing in
 * the repo records real gateway latencies. What is left of the 600 s tool
 * limit after the tunnel part and the OS reads (see `hostCallWorstCaseMs`,
 * host-computer-router.ts) is shared between the gateway calls of the
 * longest path, the open getting the largest part since it does the most. */
export const HOST_GATEWAY_CALL_MS = 4_000;

/** The longest a host open is waited for: its list, the seat's set-up and the
 * post. The largest cap the budget allows with the 20 s margin kept. */
export const HOST_GATEWAY_OPEN_MS = 19_000;

/** The longest `exec` waits for the first read of a computer whose OS is not
 * known yet (uname, then PowerShell, then the inventory: up to three ssh
 * calls, each with its own turn in the tunnel's queue). Past it the call
 * answers "not known yet, try again in a moment" and nothing was sent; the
 * read goes on in the background and the next call finds it done. */
export const HOST_OS_READ_WAIT_MAX_MS = 15_000;

/** `work`, or `onTimeout` once `limitMs` has passed. The work is not
 * cancelled (its answer is dropped); its own timeout still ends it. */
export async function withinLimit<T>(work: Promise<T>, limitMs: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), limitMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
