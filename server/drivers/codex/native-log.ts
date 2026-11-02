/** Native diagnostic log sanitizers for the Codex app-server tee. */
import { plainRecord } from "./plain.ts";
import { CODEX_SHELL_SET } from "./shell-policy.ts";

/** Keep native instructions and private host paths out of diagnostics while
 * preserving enough of the input shape to debug delivery. The unmodified request is
 * still written to the provider immediately after this log copy is made. */
export function codexNativeLogMessage(message: unknown): unknown {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  const record = message as Record<string, unknown>;
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return message;
  if (record.method === "thread/start" || record.method === "thread/resume") {
    // The shell policy's `set` values (command variables) never reach the log.
    const config = plainRecord((params as Record<string, unknown>).config);
    const set = plainRecord(config?.[CODEX_SHELL_SET]);
    return { ...record, params: { ...params, developerInstructions: "[developer instructions omitted]",
      ...(config && set ? { config: { ...config, [CODEX_SHELL_SET]: Object.fromEntries(Object.keys(set).map((name) => [name, "[value omitted]"])) } } : {}) } };
  }
  if (record.method === "thread/inject_items") {
    return { ...record, params: { ...params, items: "[developer instruction update omitted]" } };
  }
  if (record.method !== "turn/start") return message;
  const input = (params as Record<string, unknown>).input;
  if (!Array.isArray(input)) return message;
  return {
    ...record,
    params: {
      ...params,
      input: input.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const entry = item as Record<string, unknown>;
        return entry.type === "localImage"
          ? { ...entry, path: "[private attachment path omitted]" }
          : item;
      }),
    },
  };
}

/** Sanitize provider responses before the native diagnostic tee. Sensitive
 * request ids outlive the request promise, so a response arriving after its
 * timeout is still omitted rather than becoming a secret-bearing orphan. */
export function codexNativeIncomingLogMessage(
  message: any,
  sensitiveResponseIds: ReadonlySet<number>,
): unknown {
  if (message?.id !== undefined && sensitiveResponseIds.has(message.id)) {
    return {
      jsonrpc: message.jsonrpc,
      id: message.id,
      ...(message.error !== undefined
        ? { error: "[config/read error omitted]" }
        : { result: "[effective config omitted]" }),
    };
  }
  if (message?.method === "item/completed" && message.params?.item?.type === "imageGeneration") {
    return {
      ...message,
      params: {
        ...message.params,
        item: {
          ...message.params.item,
          result: `[generated image omitted · ${String(message.params.item.result ?? "").length} base64 chars]`,
          savedPath: undefined,
        },
      },
    };
  }
  return message;
}
