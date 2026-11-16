// Masking of the run's known secrets (spec CA-6) in everything the runner
// emits: events, terminal output, verify tails, warnings. The values are the
// environment's secrets (setup_only ones too: a setup script may have printed
// them) and the run token. A value shorter than MIN_MASKED_LENGTH is not
// masked (it would blank ordinary words); the runner warns about it once.

import { maskValues } from "../../shared/redact.ts";

export const MASK = "[secret masqué]";
export const MIN_MASKED_LENGTH = 6;

export class Masker {
  private values: string[] = [];

  /** Add values to mask. Returns those too short to be masked. */
  add(...values: string[]): string[] {
    const tooShort: string[] = [];
    const set = new Set(this.values);
    for (const value of values) {
      for (const form of forms(value)) {
        if (form.length < MIN_MASKED_LENGTH) {
          if (form === value && value.length > 0) tooShort.push(value);
          continue;
        }
        set.add(form);
      }
    }
    // Longest first, so a value that contains another is masked whole.
    this.values = [...set].sort((a, b) => b.length - a.length);
    return tooShort;
  }

  get longest(): number {
    return this.values[0]?.length ?? 0;
  }

  mask(text: string): string {
    if (!text || this.values.length === 0) return text;
    return maskValues(text, this.values, MASK);
  }

  /** Mask every string inside a JSON-like value. */
  maskDeep<T>(value: T): T {
    if (typeof value === "string") return this.mask(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.maskDeep(item)) as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = this.maskDeep(item);
      return out as T;
    }
    return value;
  }

  /** How many trailing characters of `text` could be the start of a secret
   * cut by a chunk boundary: they are held back until more text arrives. */
  heldTail(text: string): number {
    let held = 0;
    for (const value of this.values) {
      const max = Math.min(value.length - 1, text.length);
      for (let k = max; k > held; k--) {
        if (text.endsWith(value.slice(0, k))) { held = k; break; }
      }
    }
    return held;
  }

  /** A stream of output masked chunk by chunk: a secret split across two
   * reads is still masked whole. */
  stream(): MaskedStream {
    return new MaskedStream(this);
  }
}

export class MaskedStream {
  private pending = "";
  private readonly masker: Masker;

  constructor(masker: Masker) {
    this.masker = masker;
  }

  /** Masked text safe to emit now. */
  push(chunk: string): string {
    this.pending += chunk;
    const held = this.masker.heldTail(this.pending);
    const ready = this.pending.slice(0, this.pending.length - held);
    this.pending = this.pending.slice(this.pending.length - held);
    return this.masker.mask(ready);
  }

  /** Whatever was held back, masked, at the end of the stream. */
  end(): string {
    const rest = this.masker.mask(this.pending);
    this.pending = "";
    return rest;
  }
}

/** The value as it is, and each of its lines for a multi-line value (a PEM
 * key printed line by line is still masked). */
function forms(value: string): string[] {
  const out = [value];
  if (value.includes("\n")) {
    for (const line of value.split(/\r?\n/)) if (line.trim()) out.push(line.trim());
  }
  return out;
}
