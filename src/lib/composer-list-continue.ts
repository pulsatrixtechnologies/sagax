// #5409: Shift+Enter (or any Enter that inserts a newline) on a list line
// continues the list: "N. " becomes "N+1. ", and "- " / "* " stay a bullet.
// An empty list line ("N. " or "- " alone) leaves the list.

const ORDERED = /^(\s*)(\d+)\.\s(.*)$/;
const BULLET = /^(\s*)([-*])\s(.*)$/;

export interface ListContinue {
  value: string;
  caret: number;
}

/** What to put after a newline at `caret` in `value`, or null when the
 * current line is not a list item. */
export function continueListOnEnter(value: string, caret: number): ListContinue | null {
  const start = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const line = value.slice(start, caret);
  const ordered = ORDERED.exec(line);
  if (ordered) {
    const [, indent, number, rest] = ordered;
    if (rest === "") {
      // empty item: drop the marker and leave the list
      const next = value.slice(0, start) + value.slice(caret);
      return { value: next, caret: start };
    }
    const marker = `${indent}${Number(number) + 1}. `;
    const next = `${value.slice(0, caret)}\n${marker}${value.slice(caret)}`;
    return { value: next, caret: caret + 1 + marker.length };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    const [, indent, mark, rest] = bullet;
    if (rest === "") {
      const next = value.slice(0, start) + value.slice(caret);
      return { value: next, caret: start };
    }
    const marker = `${indent}${mark} `;
    const next = `${value.slice(0, caret)}\n${marker}${value.slice(caret)}`;
    return { value: next, caret: caret + 1 + marker.length };
  }
  return null;
}
