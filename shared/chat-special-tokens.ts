// Chat-template control tokens a model wrote as text. A local server whose
// template or tokenizer config does not match the model (oMLX, llama.cpp
// without --jinja, a GGUF with a stock template) can stream the model's own
// end marker as content: Katarina's reply read "<|eos|>" (2026-11-06). These
// tokens are never words a person reads, so they leave the start and the end
// of a reply. One quoted in the middle of a sentence stays as written.

/** `<|eos|>`, `<|im_end|>`, `<|eot_id|>`, `<|END_OF_TURN_TOKEN|>`... */
const PIPE_TOKEN = String.raw`<\|[A-Za-z0-9_]{1,40}\|>`;
/** Tokens without pipes (Llama 2, Gemma, T5 families). */
const BARE_TOKENS = ["</s>", "<s>", "<eos>", "<bos>", "<pad>", "<end_of_turn>", "<start_of_turn>"];
const TOKEN = `(?:${PIPE_TOKEN}|${BARE_TOKENS.map((token) => token.replace(/[|/]/g, "\\$&")).join("|")})`;
/** `<|im_start|>assistant` and `<start_of_turn>model` name the speaker after the marker. */
const ROLE = String.raw`(?:(?<=<\|im_start\|>|<start_of_turn>)(?:assistant|model|system|user)\b)?`;

const LEADING = new RegExp(String.raw`^\s*(?:${TOKEN}${ROLE}\s*)+`);
const TRAILING = new RegExp(String.raw`(?:\s*${TOKEN})+\s*$`);
const TOKEN_AT_END = new RegExp(`${TOKEN}$`);
const ROLE_PENDING = new RegExp(String.raw`^\s*(?:${TOKEN}\s*)*(?:<\|im_start\|>|<start_of_turn>)[a-z]*$`);
const PIPE_PREFIX = /^<(?:\|[A-Za-z0-9_]{0,40}\|?)?$/;

function isTokenPrefix(tail: string): boolean {
  return PIPE_PREFIX.test(tail) || BARE_TOKENS.some((token) => token.length > tail.length && token.startsWith(tail));
}

function stripLeading(text: string): string {
  return text.replace(LEADING, "");
}

/** A whole reply without the control tokens at its start and end; a reply
 * that is nothing but tokens comes back empty. */
export function stripChatSpecialTokens(text: string): string {
  if (!text.includes("<")) return text;
  const lead = stripLeading(text);
  const out = lead.replace(TRAILING, "");
  return out === text ? text : out.trim() ? out.trimEnd() : "";
}

/** Where the text's tail of control tokens (and the whitespace between them),
 * or of a token still being written, begins; the text's length if none. */
function heldTail(text: string): number {
  let start = text.length;
  const lt = text.lastIndexOf("<");
  if (lt !== -1 && isTokenPrefix(text.slice(lt))) start = lt;
  for (;;) {
    let end = start;
    while (end > 0 && /\s/.test(text[end - 1]!)) end--;
    const match = TOKEN_AT_END.exec(text.slice(0, end));
    if (!match) return start;
    start = end - match[0].length;
  }
}

/**
 * The same cleaning on a stream: a token split across deltas never shows, and
 * one at the end is dropped. A token (and the spaces around it) is held until
 * the next words arrive; then it was part of the sentence and is let through.
 */
export class ChatSpecialTokenStream {
  private held = "";
  private started = false;

  feed(delta: string): string {
    const text = this.held + delta;
    if (!this.started && ROLE_PENDING.test(text)) {
      this.held = text;
      return "";
    }
    const cut = heldTail(text);
    this.held = text.slice(cut);
    return this.release(text.slice(0, cut));
  }

  /** What is left once the stream ends: never a trailing token. */
  finish(): string {
    const rest = this.held;
    this.held = "";
    return this.release(rest.replace(TRAILING, ""));
  }

  private release(text: string): string {
    const out = this.started ? text : stripLeading(text);
    if (out.trim()) this.started = true;
    return this.started ? out : "";
  }
}
