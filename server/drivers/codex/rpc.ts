/** Codex app-server JSON-RPC error helpers. */

export class CodexRpcError extends Error {
  code: unknown;
  data: unknown;

  constructor(error: { code?: unknown; message?: string; data?: unknown }) {
    super(error.message ?? JSON.stringify(error));
    this.code = error.code;
    this.data = error.data;
  }
}

/** codex-cli refuses to resume a session saved under another provider ("This
 * chat uses custom, but your current provider is ... Switch to custom to
 * continue."), with data { type: "modelProviderMismatch" }. Upstream #4802. */
export const codexProviderMismatch = (error: unknown): boolean =>
  error instanceof CodexRpcError && error.code === -32600 &&
  typeof error.data === "object" && error.data !== null && !Array.isArray(error.data) &&
  (error.data as { type?: unknown }).type === "modelProviderMismatch";

export function missingNativeCodexThread(error: unknown, cursor: string): boolean {
  // Codex's local thread/resume rejection, verified with an empty native home.
  // A generic 404, auth error, timeout or prose mentioning a missing thread is
  // not evidence that the native history was lost. Unknown versions fail closed.
  return error instanceof CodexRpcError && error.code === -32600 &&
    error.message === `no rollout found for thread id ${cursor}`;
}

/** Codex refuses to resume an archived session: "session <id> is archived. Run `codex unarchive <id>` to unarchive it first." */
export const archivedNativeCodexThread = (error: unknown, cursor: string): boolean =>
  error instanceof CodexRpcError && error.message.includes(cursor) && /\bis archived\b/.test(error.message);
