// QA 0.8.67 G8 ("Call to undefined function split"): routines wrote JMESPath
// with string functions the standard set lacks (split, lower, upper, replace,
// trim). jmespath 0.16 has no way to register a function, so a query that
// calls one of them is evaluated here: over the library's own parsed tree,
// with the standard evaluation rules (ported from jmespath.js 0.16.0,
// Apache-2.0), every standard function delegated to the library, and the
// extra ones added. A query that calls none of them runs in the library as before.
import jmespathLibrary from "jmespath";

// compile and strictDeepEqual are exported by 0.16 but missing from its types
const jmespath = jmespathLibrary as typeof jmespathLibrary & {
  compile(query: string): unknown;
  strictDeepEqual(first: unknown, second: unknown): boolean;
};

type Node = { type: string; name?: string; value?: unknown; children?: Node[] } & Record<string, unknown>;
type Fn = (args: unknown[]) => unknown;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && Object.prototype.toString.call(value) === "[object Object]";

function isFalse(value: unknown): boolean {
  if (value === "" || value === false || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

function stringArg(fn: string, value: unknown, position: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(`TypeError: ${fn}() expected argument ${position} to be type string`);
  return value;
}

function arity(fn: string, args: unknown[], count: number): void {
  if (args.length !== count) throw new Error(`ArgumentError: ${fn}() takes ${count} argument${count === 1 ? "" : "s"} but received ${args.length}`);
}

/** The functions added to the standard set. A null subject (a missing field)
 * gives null, as a missing field does elsewhere in JMESPath. */
export const JMESPATH_EXTRA_FUNCTIONS: Readonly<Record<string, Fn>> = {
  split: (args) => {
    arity("split", args, 2);
    const subject = stringArg("split", args[0], 1);
    const separator = stringArg("split", args[1], 2);
    return subject === null || separator === null ? null : subject.split(separator);
  },
  lower: (args) => {
    arity("lower", args, 1);
    return stringArg("lower", args[0], 1)?.toLowerCase() ?? null;
  },
  upper: (args) => {
    arity("upper", args, 1);
    return stringArg("upper", args[0], 1)?.toUpperCase() ?? null;
  },
  trim: (args) => {
    arity("trim", args, 1);
    return stringArg("trim", args[0], 1)?.trim() ?? null;
  },
  replace: (args) => {
    arity("replace", args, 3);
    const subject = stringArg("replace", args[0], 1);
    const from = stringArg("replace", args[1], 2);
    const to = stringArg("replace", args[2], 3);
    if (subject === null || from === null || to === null) return null;
    return from === "" ? subject : subject.split(from).join(to);
  },
};

export const JMESPATH_EXTRA_NAMES = Object.keys(JMESPATH_EXTRA_FUNCTIONS);

/** Functions whose arguments are expression references, run here because an
 * expression cannot be handed to the library apart from its query. */
const EXPREF_FUNCTIONS = new Set(["map", "sort_by", "max_by", "min_by"]);

function callsExtra(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as Node;
  if (n.type === "Function" && typeof n.name === "string" && Object.hasOwn(JMESPATH_EXTRA_FUNCTIONS, n.name)) return true;
  if (Array.isArray(n.children) && n.children.some(callsExtra)) return true;
  // MultiSelectHash pairs keep their expression in `value`
  return n.type === "KeyValuePair" && callsExtra(n.value);
}

class Interpreter {
  visit(node: Node, value: unknown): unknown {
    const children = node.children ?? [];
    switch (node.type) {
      case "Field":
        if (isObject(value)) {
          const field = value[node.name as string];
          return field === undefined ? null : field;
        }
        return null;
      case "Subexpression": {
        let result = this.visit(children[0]!, value);
        for (let i = 1; i < children.length; i++) {
          result = this.visit(children[i]!, result);
          if (result === null) return null;
        }
        return result;
      }
      case "IndexExpression":
        return this.visit(children[1]!, this.visit(children[0]!, value));
      case "Index": {
        if (!Array.isArray(value)) return null;
        let index = node.value as number;
        if (index < 0) index = value.length + index;
        const result = value[index];
        return result === undefined ? null : result;
      }
      case "Slice": {
        if (!Array.isArray(value)) return null;
        const [start, stop, step] = sliceParams(value.length, children as unknown as Array<number | null>);
        const result: unknown[] = [];
        if (step > 0) for (let i = start; i < stop; i += step) result.push(value[i]);
        else for (let i = start; i > stop; i += step) result.push(value[i]);
        return result;
      }
      case "Projection": {
        const base = this.visit(children[0]!, value);
        if (!Array.isArray(base)) return null;
        const collected: unknown[] = [];
        for (const item of base) {
          const current = this.visit(children[1]!, item);
          if (current !== null) collected.push(current);
        }
        return collected;
      }
      case "ValueProjection": {
        const base = this.visit(children[0]!, value);
        if (!isObject(base)) return null;
        const collected: unknown[] = [];
        for (const item of Object.values(base)) {
          const current = this.visit(children[1]!, item);
          if (current !== null) collected.push(current);
        }
        return collected;
      }
      case "FilterProjection": {
        const base = this.visit(children[0]!, value);
        if (!Array.isArray(base)) return null;
        const collected: unknown[] = [];
        for (const item of base) {
          if (isFalse(this.visit(children[2]!, item))) continue;
          const current = this.visit(children[1]!, item);
          if (current !== null) collected.push(current);
        }
        return collected;
      }
      case "Comparator": {
        const first = this.visit(children[0]!, value) as never;
        const second = this.visit(children[1]!, value) as never;
        switch (node.name) {
          case "EQ": return jmespath.strictDeepEqual(first, second);
          case "NE": return !jmespath.strictDeepEqual(first, second);
          case "GT": return first > second;
          case "GTE": return first >= second;
          case "LT": return first < second;
          case "LTE": return first <= second;
          default: throw new Error(`Unknown comparator: ${node.name}`);
        }
      }
      case "Flatten": {
        const original = this.visit(children[0]!, value);
        if (!Array.isArray(original)) return null;
        const merged: unknown[] = [];
        for (const item of original) {
          if (Array.isArray(item)) merged.push(...item);
          else merged.push(item);
        }
        return merged;
      }
      case "Identity":
      case "Current":
        return value;
      case "MultiSelectList":
        if (value === null) return null;
        return children.map((child) => this.visit(child, value));
      case "MultiSelectHash": {
        if (value === null) return null;
        const collected: Record<string, unknown> = {};
        for (const child of children) collected[child.name as string] = this.visit(child.value as Node, value);
        return collected;
      }
      case "OrExpression": {
        const matched = this.visit(children[0]!, value);
        return isFalse(matched) ? this.visit(children[1]!, value) : matched;
      }
      case "AndExpression": {
        const first = this.visit(children[0]!, value);
        return isFalse(first) ? first : this.visit(children[1]!, value);
      }
      case "NotExpression":
        return isFalse(this.visit(children[0]!, value));
      case "Literal":
        return node.value;
      case "Pipe":
        return this.visit(children[1]!, this.visit(children[0]!, value));
      case "Function":
        return this.call(node.name as string, children, value);
      case "ExpressionReference":
        return { expref: children[0]! };
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  private call(name: string, children: Node[], value: unknown): unknown {
    const args = children.map((child) => this.visit(child, value));
    const extra = Object.hasOwn(JMESPATH_EXTRA_FUNCTIONS, name) ? JMESPATH_EXTRA_FUNCTIONS[name] : undefined;
    if (extra) return extra(args);
    if (EXPREF_FUNCTIONS.has(name)) return this.exprefCall(name, args);
    // A standard function: the library runs it on the resolved arguments,
    // with its own type checks and errors.
    const call = `${name}(${args.map((_, i) => `[${i}]`).join(", ")})`;
    return jmespath.search(args as never, call);
  }

  private exprefCall(name: string, args: unknown[]): unknown {
    if (args.length !== 2) throw new Error(`ArgumentError: ${name}() takes 2 arguments but received ${args.length}`);
    // map(&expr, array); sort_by, max_by and min_by(array, &expr)
    const [refAt, listAt] = name === "map" ? [0, 1] : [1, 0];
    const ref = args[refAt];
    if (!isObject(ref) || !("expref" in ref)) throw new TypeError(`TypeError: ${name}() expected argument ${refAt + 1} to be type expref`);
    const node = ref.expref as Node;
    const list = args[listAt];
    if (!Array.isArray(list)) throw new TypeError(`TypeError: ${name}() expected argument ${listAt + 1} to be type array`);
    if (name === "map") return list.map((item) => this.visit(node, item));
    const keyed = list.map((item, index) => ({ item, index, key: this.visit(node, item) }));
    const kind = typeof keyed[0]?.key;
    for (const entry of keyed) {
      if ((typeof entry.key !== "number" && typeof entry.key !== "string") || typeof entry.key !== kind) {
        throw new TypeError(`TypeError: ${name}() expected the expression to give one type, number or string`);
      }
    }
    if (name === "sort_by") {
      return keyed
        .sort((a, b) => ((a.key as never) < (b.key as never) ? -1 : (a.key as never) > (b.key as never) ? 1 : a.index - b.index))
        .map((entry) => entry.item);
    }
    if (!keyed.length) return null;
    let best = keyed[0]!;
    for (const entry of keyed) {
      if (name === "max_by" ? (entry.key as never) > (best.key as never) : (entry.key as never) < (best.key as never)) best = entry;
    }
    return best.item;
  }
}

function sliceParams(length: number, params: Array<number | null>): [number, number, number] {
  let [start, stop, step] = params;
  if (step === null || step === undefined) step = 1;
  else if (step === 0) throw new Error("Invalid slice, step cannot be 0");
  const negative = step < 0;
  const cap = (actual: number) => {
    if (actual < 0) {
      actual += length;
      if (actual < 0) actual = negative ? -1 : 0;
    } else if (actual >= length) {
      actual = negative ? length - 1 : length;
    }
    return actual;
  };
  start = start === null || start === undefined ? (negative ? length - 1 : 0) : cap(start);
  stop = stop === null || stop === undefined ? (negative ? -1 : length) : cap(stop);
  return [start, stop, step];
}

/** jmespath.search with split, lower, upper, trim and replace added. */
export function searchExtended(data: unknown, query: string): unknown {
  const tree = jmespath.compile(query) as unknown as Node;
  if (!callsExtra(tree)) return jmespath.search(data as never, query);
  return new Interpreter().visit(tree, data);
}

/** The name of an extra function an "undefined function" error names, if any
 * (Perspicax's own JMESPath: "Call to undefined function split"). */
export function undefinedExtraFunction(message: string): string | null {
  const match = /undefined function:?\s*`?([a-z_]+)/i.exec(message) ?? /Unknown function:\s*([a-z_]+)\(/i.exec(message);
  const name = match?.[1]?.toLowerCase();
  return name && Object.hasOwn(JMESPATH_EXTRA_FUNCTIONS, name) ? name : null;
}
