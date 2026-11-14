// #4185: the key state a Perspicax product tool answers when the person's key
// for that product is missing, refused, expired, misfit or needs a sign-in.
// Read from the tool error's `details` (`product`, `key_state`), never from its
// sentence: the relay raises the product key card from it.

const KEY_STATES = new Set(["key_missing", "key_refused", "key_expired", "key_misfit", "sign_in_needed"]);

export interface ProductKeyState {
  product: string;
  keyState: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromError(value: unknown): ProductKeyState | null {
  if (!isObject(value)) return null;
  const error = isObject(value.details) ? value : isObject(value.error) ? value.error : null;
  const details = error && isObject(error.details) ? error.details : null;
  if (!details) return null;
  const product = typeof details.product === "string" ? details.product.trim() : "";
  const keyState = typeof details.key_state === "string" ? details.key_state : "";
  if (!product || product.length > 256 || !KEY_STATES.has(keyState)) return null;
  return { product, keyState };
}

/** The product and key state of a refused tools/call answer, or null. */
export function productKeyStateOf(body: unknown): ProductKeyState | null {
  if (!isObject(body) || !isObject(body.result) || body.result.isError !== true) return null;
  const result = body.result;
  const structured = fromError(result.structuredContent);
  if (structured) return structured;
  for (const block of Array.isArray(result.content) ? result.content : []) {
    if (!isObject(block) || block.type !== "text" || typeof block.text !== "string") continue;
    try {
      const found = fromError(JSON.parse(block.text));
      if (found) return found;
    } catch { /* not JSON: a sentence is never read */ }
  }
  return null;
}

/** The same tools/call answer with one more text block for the bot. */
export function withToolNote(body: unknown, text: string): unknown {
  if (!isObject(body) || !isObject(body.result)) return body;
  const content = Array.isArray(body.result.content) ? body.result.content : [];
  return { ...body, result: { ...body.result, content: [...content, { type: "text", text }] } };
}
