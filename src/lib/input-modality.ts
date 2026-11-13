// How focus last moved: a pointer (a click, a right click whose menu hands
// focus back) or the keyboard (Tab, an arrow key). Chromium counts a
// programmatic focus() after a click on a menu as :focus-visible, and any
// key pressed on a control focused by a click (Escape on an open menu) turns
// that focus :focus-visible too, so the keyboard ring would show after a
// mouse click.
//
// One rule for the whole app (#4156): an element that takes focus while the
// last input was a pointer carries `data-pointer-focus` until it loses focus
// or the keyboard moves (Tab, an arrow key). styles.css draws no focus ring
// under the mark: the global `:focus-visible` outline and every
// `focus-visible:` utility (the variant is redefined there) skip it, so a
// button that opens a menu or a popover shows its soft pressed fill only,
// and keyboard focus keeps its ring.
//
// Text-entry elements are never marked (text-like inputs, textarea, select,
// contenteditable): Chromium always treats their focus as :focus-visible, a
// person typing needs to see which field takes the keys, and an arrow key
// while typing would otherwise clear the mark and bring the ring back in the
// middle of editing.
let lastInput: "pointer" | "keyboard" = "keyboard";
let listening = false;

const MARK = "pointerFocus";

function isElement(target: EventTarget | null): target is HTMLElement {
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement;
}

// Input types that are a control, not a place to type: they follow the
// pointer rule like a button.
const NON_TEXT_INPUTS = new Set([
  "button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit",
]);

export function isTextEntry(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  const editable = element.getAttribute("contenteditable");
  if (editable !== null && editable !== "false") return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUTS.has((element as HTMLInputElement).type);
}

export function trackInputModality(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" && !event.key.startsWith("Arrow")) return;
    lastInput = "keyboard";
    const focused = document.activeElement;
    if (isElement(focused)) delete focused.dataset[MARK];
  }, true);
  document.addEventListener("focusin", (event) => {
    if (!isElement(event.target)) return;
    if (lastInput === "pointer" && !isTextEntry(event.target)) event.target.dataset[MARK] = "";
    else delete event.target.dataset[MARK];
  }, true);
  document.addEventListener("focusout", (event) => {
    if (isElement(event.target)) delete event.target.dataset[MARK];
  }, true);
}
