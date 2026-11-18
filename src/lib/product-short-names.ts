// What tells the connectors of one bundle apart (2026-11-17, the owner on a vendor's page: fifteen rows that all
// read "Connectwise Manage Public End…"). The connectors of a bundle share a long vendor prefix; the part that
// differs (the module or area: "Service", "Finance", "Time") is what a row shows, the full name stays in its
// tooltip. The prefix is cut on whole words and only when every name of the bundle has it and a distinguishing
// part is left; a name that would be left empty keeps its full name.

const SEPARATORS = /^[\s:\-\u2013\u2014|/\u00b7>.,]+/;

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const capitalize = (text: string) => (text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text);

/** The words every name starts with, ignoring case and a trailing ":" on the last shared word. */
export function commonPrefixWords(names: readonly string[]): string[] {
  if (names.length < 2) return [];
  const lists = names.map(words);
  const first = lists[0]!;
  let count = 0;
  while (count < first.length && lists.every((list) => count < list.length && same(list[count]!, first[count]!))) count++;
  return first.slice(0, count);
}

/** The distinguishing part of each name, in the same order; the whole name when nothing distinguishes it. */
export function distinguishingNames(names: readonly string[]): string[] {
  const prefix = commonPrefixWords(names);
  if (prefix.length === 0) return [...names];
  const cut = names.map((name) => capitalize(words(name).slice(prefix.length).join(" ").replace(SEPARATORS, "").trim()));
  // a prefix that leaves any name empty is not a prefix of the family: keep the full names
  if (cut.some((rest) => rest === "")) return [...names];
  // two connectors that still read alike keep their full names
  return cut.every((rest, index) => cut.indexOf(rest) === index) ? cut : [...names];
}
