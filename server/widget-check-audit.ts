// The in-page half of the widget self-check (server/widget-check.ts): one
// function, sent as a string to the headless renderer and run in an isolated
// world of the widget's own sandboxed frame, so the widget's scripts cannot
// see or change it. It reads layout only and returns the defects it finds.
// Kept apart from the renderer so its rules read on their own.
//
// Rules (JC, 2026-10-19: the bot checks its own widget before showing it):
// - hscroll: the document is wider than the frame.
// - overflow: an element sticks out of the frame or of the box it sits in.
// - clipped: a box with overflow hidden cuts its own text (an ellipsis is fine).
// - overlap: two pieces of text or controls cover each other.
// - crushed: text squeezed to a word per line, or a word broken across lines.
// - hidden: a visible control or text with no size, off the frame, or under
//   another element so a click cannot reach it.
// - contrast: text below 3:1 against what is behind it (the kit's secondary
//   text sits near 4:1, so 4.5 would flag the kit itself).
// - target: a control smaller than 24 px with another one inside that square,
//   or smaller than 12 px whatever its neighbours (WCAG 2.5.8).
// - empty: nothing visible at all.

// The page's DOM, typed loosely: the server compiles without the DOM library
// (adding it there clashes with Node's fetch and timers). The tests run this
// function in a real Chrome.
type Element = any;
type HTMLElement = any;
type HTMLInputElement = any;
type DOMRect = any;
type Node = any;
declare const document: any;
declare const getComputedStyle: any;
declare const NodeFilter: any;
declare const DOMRect: any;
declare const CSS: any;

export interface AuditDefect {
  kind: "hscroll" | "overflow" | "clipped" | "overlap" | "crushed" | "hidden" | "contrast" | "target" | "empty";
  /** A short selector-like name of the element, with its text. */
  target: string;
  detail: string;
}

export interface AuditOptions {
  /** What sits behind the widget: the chat surface of the scheme. */
  background: string;
}

/** Runs in the page. No closure: it is serialized with Function#toString. */
export function auditWidgetPage(options: AuditOptions): AuditDefect[] {
  const doc = document;
  const root = doc.documentElement;
  const frameWidth = root.clientWidth;
  const out: AuditDefect[] = [];
  const seen = new Set<string>();
  const MAX = 40;

  const short = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 40);
  const describe = (el: Element | null): string => {
    if (!el) return "document";
    let name = el.tagName.toLowerCase();
    if (el.id) name += `#${el.id}`;
    const classes = Array.from<any>(el.classList).slice(0, 3);
    if (classes.length) name += `.${classes.join(".")}`;
    const input = el as HTMLInputElement;
    if (el.tagName === "INPUT" && input.type) name += `[type=${input.type}]`;
    const ownValue = el.tagName === "INPUT" && input.type !== "checkbox" && input.type !== "radio" ? input.value : "";
    const text = short((el as HTMLElement).innerText || ownValue || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "");
    return text ? `${name} "${text}"` : name;
  };
  const push = (kind: AuditDefect["kind"], el: Element | null, detail: string) => {
    const target = describe(el);
    const key = `${kind}|${target}`;
    if (seen.has(key) || out.length >= MAX) return;
    seen.add(key);
    out.push({ kind, target, detail });
  };
  const px = (value: number) => `${Math.round(value)}px`;
  const shown = (el: Element) => {
    const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (check) return check.call(el, { opacityProperty: true, visibilityProperty: true });
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const contains = (a: Node, b: Node) => a === b || a.contains(b) || b.contains(a);
  /** A visually hidden helper (sr-only): 1px, clipped. Never a defect. */
  const srOnly = (el: Element) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (rect.width <= 1 && rect.height <= 1) || (style.clip !== "auto" && style.clip !== "") || style.clipPath.startsWith("inset(50%") || el.closest("[aria-hidden=true]") !== null;
  };
  /** An ancestor that scrolls or clips sideways: what is outside it is meant to be. */
  const clippedBy = (el: Element): Element | null => {
    for (let node = el.parentElement; node && node !== doc.body && node !== root; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "visible") return node;
    }
    return null;
  };
  const positioned = (el: Element) => {
    const position = getComputedStyle(el).position;
    return position === "absolute" || position === "fixed";
  };

  // --- the frame scrolls sideways
  const scrollWidth = Math.max(root.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
  if (scrollWidth > frameWidth + 1) push("hscroll", null, `the content is ${px(scrollWidth)} wide in a ${px(frameWidth)} frame, so it scrolls sideways`);

  const elements = Array.from<any>(doc.body ? doc.body.querySelectorAll("*") : []).slice(0, 2000).filter((el) => !["SCRIPT", "STYLE", "TEMPLATE", "META", "LINK", "BR", "WBR", "TITLE", "HEAD"].includes(el.tagName) && shown(el));
  const reportedOverflow = new Set<Element>();
  const insideReported = (el: Element) => {
    for (let node = el.parentElement; node; node = node.parentElement) if (reportedOverflow.has(node)) return true;
    return false;
  };

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    if (srOnly(el) || el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    // --- out of the frame
    if ((rect.right > frameWidth + 1 || rect.left < -1) && !clippedBy(el) && !insideReported(el)) {
      reportedOverflow.add(el);
      push("overflow", el, `it spans ${px(rect.left)} to ${px(rect.right)} in a ${px(frameWidth)} frame`);
      continue;
    }
    // --- out of the box it sits in (a box: border, background or clip)
    if (!positioned(el) && !insideReported(el)) {
      for (let box = el.parentElement; box && box !== doc.body && box !== root; box = box.parentElement) {
        const style = getComputedStyle(box);
        const boxed = style.overflowX !== "visible" || style.borderLeftWidth !== "0px" || style.borderRightWidth !== "0px"
          || (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent");
        if (!boxed) continue;
        if (style.overflowX !== "visible") break; // it scrolls or clips: meant
        const outer = box.getBoundingClientRect();
        if (rect.right > outer.right + 2 || rect.left < outer.left - 2) {
          reportedOverflow.add(el);
          push("overflow", el, `it sticks out of ${describe(box).split(" ")[0]} by ${px(Math.max(rect.right - outer.right, outer.left - rect.left))}`);
        }
        break;
      }
    }
    // --- a box that cuts its own text
    const style = getComputedStyle(el);
    if ((style.overflowX === "hidden" || style.overflowX === "clip" || style.overflowY === "hidden" || style.overflowY === "clip")
      && style.textOverflow !== "ellipsis" && style.webkitLineClamp === "none" && (el as HTMLElement).innerText?.trim()) {
      const html = el as HTMLElement;
      const wide = html.scrollWidth > html.clientWidth + 2 && style.overflowX !== "visible";
      const tall = html.scrollHeight > html.clientHeight + 2 && style.overflowY !== "visible" && style.overflowY !== "auto" && style.overflowY !== "scroll";
      if ((wide && style.overflowX !== "auto" && style.overflowX !== "scroll") || tall) {
        // name what sticks out the most, which is what needs the fix
        const outer = el.getBoundingClientRect();
        let culprit: Element | null = null;
        let most = 0;
        for (const inner of Array.from<any>(el.querySelectorAll("*")).slice(0, 400)) {
          const box = inner.getBoundingClientRect();
          const by = Math.max(box.right - outer.right, box.bottom - outer.bottom);
          if (by > most + 0.5) { most = by; culprit = inner; }
        }
        push("clipped", el, culprit
          ? `it cuts off ${describe(culprit)}, which sticks out by ${px(most)}`
          : `its content is cut: ${px(html.scrollWidth)} x ${px(html.scrollHeight)} in a ${px(html.clientWidth)} x ${px(html.clientHeight)} box`);
      }
    }
  }

  // --- text: crushed, out of sight, contrast; its line boxes for overlaps
  interface Box { node: Node; owner: Element; rect: DOMRect; control: boolean }
  const boxes: Box[] = [];
  const walker = doc.createTreeWalker(doc.body ?? root, NodeFilter.SHOW_TEXT);
  const parseColor = (value: string): [number, number, number, number] | null => {
    let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if (match) {
      const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
      return [+match[1]!, +match[2]!, +match[3]!, alpha];
    }
    match = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(value);
    if (match) {
      const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
      return [+match[1]! * 255, +match[2]! * 255, +match[3]! * 255, alpha];
    }
    return null;
  };
  const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] =>
    [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number];
  const pageGround = (() => {
    const probe = doc.createElement("i");
    probe.style.color = options.background;
    root.appendChild(probe);
    const color = parseColor(getComputedStyle(probe).color);
    probe.remove();
    return color ? [color[0], color[1], color[2]] as [number, number, number] : [255, 255, 255] as [number, number, number];
  })();
  /** The solid color behind an element, or null under an image or gradient. */
  const groundOf = (el: Element): [number, number, number] | null => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none") return null;
      const color = parseColor(style.backgroundColor);
      if (color && color[3] > 0) layers.push(color);
      if (color && color[3] >= 1) break;
    }
    let ground = pageGround;
    for (let i = layers.length - 1; i >= 0; i -= 1) ground = over(layers[i]!, ground);
    return ground;
  };
  const luminance = (rgb: [number, number, number]) => {
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!text.trim()) continue;
    const owner = node.parentElement;
    if (!owner || !shown(owner) || srOnly(owner) || ["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "TITLE"].includes(owner.tagName)) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rects = Array.from<any>(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    // --- out of sight
    const all = range.getBoundingClientRect();
    if (all.right < 0 || all.left > frameWidth || all.bottom < 0) {
      // inside a box that scrolls sideways: say it once, for the box
      const scroller = clippedBy(owner);
      const scrolls = scroller && ["auto", "scroll"].includes(getComputedStyle(scroller).overflowX);
      if (scrolls) push("hscroll", scroller, `this box scrolls sideways (${px(scroller.scrollWidth)} of content in ${px(scroller.clientWidth)}), so part of the widget is out of sight: wrap it or stack it instead`);
      else push("hidden", owner, "its text is drawn outside the frame");
      continue;
    }
    // --- crushed: count line boxes against words
    const lines = new Set(rects.map((r) => Math.round(r.top / 2))).size;
    const words = text.trim().split(/\s+/).length;
    const box = owner.closest("label,td,th,li,p,span,div,button,a") ?? owner;
    const boxWidth = Math.round(box.getBoundingClientRect().width);
    // scripts written without spaces (Chinese, Japanese, Thai...) wrap
    // anywhere: their word count says nothing, only a very narrow box does
    const spaceless = /[\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(text);
    const crushed = spaceless
      ? lines >= 3 && boxWidth < 40
      : (words >= 3 && lines >= words * 0.8) || (words === 1 && text.trim().length > 3 && boxWidth < 80) || (words >= 2 && boxWidth < 40);
    if (lines >= 2 && crushed) {
      push("crushed", owner, `${words} word${words > 1 ? "s" : ""} on ${lines} lines in a ${boxWidth}px wide box: its column is too narrow`);
    }
    // --- contrast (under a picture or gradient it cannot be read)
    const style = getComputedStyle(owner);
    const color = parseColor(style.color);
    const ground = groundOf(owner);
    if (color && ground && !owner.closest(":disabled,[aria-disabled=true]")) {
      const effective = over(color, ground);
      const value = ratio(effective, ground);
      if (value < 3) push("contrast", owner, `text contrast is ${value.toFixed(1)}:1 against its background; at least 3:1 (use var(--foreground) or var(--muted-foreground))`);
    }
    for (const rect of rects) boxes.push({ node, owner, rect, control: false });
  }

  // --- controls: size, reach
  const controls = elements.filter((el) => el.matches("button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=slider],[role=checkbox],[role=switch],[role=tab],[onclick]")
    && !srOnly(el) && !el.closest("[inert]"));
  const targetRect = (el: Element): DOMRect => {
    const rect = el.getBoundingClientRect();
    const input = el as HTMLInputElement;
    if (el.tagName === "INPUT" && (input.type === "checkbox" || input.type === "radio")) {
      const label = el.closest("label") ?? (el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (label) {
        const other = label.getBoundingClientRect();
        const left = Math.min(rect.left, other.left);
        const top = Math.min(rect.top, other.top);
        return new DOMRect(left, top, Math.max(rect.right, other.right) - left, Math.max(rect.bottom, other.bottom) - top);
      }
    }
    return rect;
  };
  const targets = controls.map((el) => ({ el, rect: targetRect(el) }));
  const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const { el, rect } of targets) {
    const own = el.getBoundingClientRect();
    if (own.width < 1 || own.height < 1) {
      push("hidden", el, "this control is visible but has no size, so it cannot be seen or pressed");
      continue;
    }
    if (own.right < 0 || own.left > frameWidth || own.bottom < 0) {
      const scroller = clippedBy(el);
      if (scroller && ["auto", "scroll"].includes(getComputedStyle(scroller).overflowX)) {
        push("hscroll", scroller, `this box scrolls sideways (${px(scroller.scrollWidth)} of content in ${px(scroller.clientWidth)}), so part of the widget is out of sight: wrap it or stack it instead`);
      } else push("hidden", el, "this control sits outside the frame");
      continue;
    }
    // inline links inside a sentence are exempt (WCAG 2.5.8 inline)
    const inline = el.tagName === "A" && Array.from<any>(el.parentElement?.childNodes ?? []).some((child) => child.nodeType === 3 && child.textContent!.trim());
    const range = el.tagName === "INPUT" && (el as HTMLInputElement).type === "range";
    const small = range ? rect.width < 24 : Math.min(rect.width, rect.height) < 24;
    if (!inline && small) {
      const tiny = range ? rect.width < 12 : Math.min(rect.width, rect.height) < 12;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const square = new DOMRect(cx - 12, cy - 12, 24, 24);
      const crowded = targets.some((other) => other.el !== el && !contains(other.el, el) && intersects(square, other.rect));
      if (tiny || crowded) push("target", el, `it is ${px(rect.width)} x ${px(rect.height)}${crowded ? " with another control within 24px" : ""}: make it at least 24px or give it room`);
    }
    // --- something else sits on top of it
    const x = own.left + Math.min(own.width / 2, Math.max(own.width - 2, 1));
    const y = own.top + own.height / 2;
    // scrolled out of a box that scrolls: not covered, just out of view
    const scroller = clippedBy(el);
    const scrolledAway = scroller && (() => {
      const view = scroller.getBoundingClientRect();
      return x < view.left || x > view.right || y < view.top || y > view.bottom;
    })();
    if (!scrolledAway && x >= 0 && y >= 0 && x < frameWidth && y < root.clientHeight) {
      const hit = doc.elementFromPoint(own.left + own.width / 2, y);
      const label = el.closest("label");
      if (hit && !contains(hit, el) && !(label && label.contains(hit)) && !(el.id && hit.closest(`label[for="${CSS.escape(el.id)}"]`))) {
        push("hidden", el, `it is covered by ${describe(hit)}, so a click lands there instead`);
      }
    }
    boxes.push({ node: el, owner: el, rect: own, control: true });
  }

  // --- overlaps between text lines and controls of different elements
  const limited = boxes.slice(0, 500);
  for (let i = 0; i < limited.length; i += 1) {
    const a = limited[i]!;
    for (let j = i + 1; j < limited.length; j += 1) {
      const b = limited[j]!;
      if (a.node === b.node || contains(a.node, b.node) || contains(a.owner, b.owner)) continue;
      const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (width <= 2 || height <= 2) continue;
      const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      if (width * height < smaller * 0.2) continue;
      const label = (box: Box) => box.control ? describe(box.owner) : `${describe(box.owner).split(" ")[0]} "${short(box.node.textContent ?? "")}"`;
      push("overlap", a.owner, `${label(a)} and ${label(b)} cover each other over ${px(width)} x ${px(height)}`);
    }
  }

  // --- nothing to see
  const body = doc.body;
  if (body && !body.innerText.trim() && !elements.some((el) => ["CANVAS", "SVG", "IMG", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "VIDEO"].includes(el.tagName.toUpperCase()) && el.getBoundingClientRect().width > 0)) {
    push("empty", null, "the widget draws nothing visible");
  }
  return out;
}
