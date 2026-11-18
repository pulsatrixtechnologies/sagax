export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** Up to five names a bot could have meant: what the wanted name is a
 * prefix of comes first, then substring matches and names a few edits away,
 * nearest first. */
export function closeNames(wanted: string, names: readonly string[], max = 5): string[] {
  const target = wanted.toLowerCase();
  const budget = Math.max(2, Math.floor(target.length / 3));
  return names
    .map((name) => {
      const folded = name.toLowerCase();
      const distance = levenshtein(target, folded);
      const prefix = folded.startsWith(target) || target.startsWith(folded);
      const related = prefix || folded.includes(target);
      return { name, distance, prefix, related };
    })
    .filter((entry) => entry.related || entry.distance <= budget)
    .sort((x, y) => Number(y.prefix) - Number(x.prefix) || x.distance - y.distance || x.name.localeCompare(y.name))
    .slice(0, max)
    .map((entry) => entry.name);
}
