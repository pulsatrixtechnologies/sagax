// Concrete paths that a route of the inventory answers: the exact path, a
// prefix followed by one segment, or, for a pattern, one path per form it
// takes: every branch of every alternation, every optional part both present
// and absent (a class stands for its first character, a quantifier for its
// minimum). Used to ask the auth gate (server/auth/route-scopes.ts) what each
// form of each route needs, so a branch nobody classed cannot hide behind a
// classed sibling (#4471). Null when the pattern uses a form this does not
// read, or has more forms than MAX_SAMPLES.
import type { RouteKind } from "./route-inventory.ts";

/** More forms than this and the route is left unread (and so unclassed):
 * split it into precise routes. No route of the server comes near. */
export const MAX_SAMPLES = 256;

export function routeSamples(kind: RouteKind, route: string): string[] | null {
  if (kind === "exact") return [route];
  if (kind === "prefix") return [route.endsWith("/") ? `${route}abc` : route];
  const samples = patternSamples(route);
  if (samples === null) return null;
  let re: RegExp;
  try { re = new RegExp(route); } catch { return null; }
  return samples.every((sample) => re.test(sample)) ? samples : null;
}

/** The first form of a route, for a table that shows one path per route. */
export function routeSample(kind: RouteKind, route: string): string | null {
  return routeSamples(kind, route)?.[0] ?? null;
}

function classChar(body: string): string {
  if (body.startsWith("^")) return "a";
  const first = body.startsWith("\\") ? body.slice(0, 2) : body[0] ?? "a";
  if (first === "\\w") return "a";
  if (first === "\\d") return "0";
  if (first === "\\s") return " ";
  if (first.startsWith("\\")) return first[1]!;
  return first;
}

class TooMany extends Error {}

function unique(list: string[]): string[] {
  const out = [...new Set(list)];
  if (out.length > MAX_SAMPLES) throw new TooMany();
  return out;
}

function product(left: string[], right: string[]): string[] {
  return unique(left.flatMap((a) => right.map((b) => a + b)));
}

function patternSamples(source: string): string[] | null {
  let i = 0;
  const parseAlt = (): string[] | null => {
    const forms: string[] = [];
    for (;;) {
      const seq = parseSeq();
      if (seq === null) return null;
      forms.push(...seq);
      if (source[i] !== "|") break;
      i++;
    }
    return unique(forms);
  };
  const parseSeq = (): string[] | null => {
    let out = [""];
    while (i < source.length && source[i] !== "|" && source[i] !== ")") {
      let atom: string[] | null;
      const c = source[i]!;
      if (c === "^" || c === "$") { i++; continue; }
      if (c === "(") {
        i++;
        if (source[i] === "?") {
          if (source[i + 1] !== ":") return null;
          i += 2;
        }
        atom = parseAlt();
        if (atom === null || source[i] !== ")") return null;
        i++;
      } else if (c === "[") {
        let j = i + 1;
        if (source[j] === "]") j++;
        for (; j < source.length; j++) {
          if (source[j] === "\\") { j++; continue; }
          if (source[j] === "]") break;
        }
        atom = [classChar(source.slice(i + 1, j))];
        i = j + 1;
      } else if (c === "\\") {
        const e = source[i + 1]!;
        atom = [e === "w" ? "a" : e === "d" ? "0" : e === "s" ? " " : e];
        i += 2;
      } else if (c === ".") {
        atom = ["a"];
        i++;
      } else {
        atom = [c];
        i++;
      }
      // quantifier: an optional part is judged both absent and present
      const q = source[i];
      if (q === "*" || q === "?") { i++; if (source[i] === "?") i++; atom = unique(["", ...atom]); }
      else if (q === "+") { i++; if (source[i] === "?") i++; }
      else if (q === "{") {
        const m = /^\{(\d+)(,\d*)?\}/.exec(source.slice(i));
        if (!m) return null;
        i += m[0].length;
        const count = Number(m[1]);
        const min = atom;
        atom = count === 0 ? unique(["", ...min]) : min.map((form) => form.repeat(count));
      }
      out = product(out, atom);
    }
    return out;
  };
  try {
    const result = parseAlt();
    return i === source.length ? result : null;
  } catch (error) {
    if (error instanceof TooMany) return null;
    throw error;
  }
}
