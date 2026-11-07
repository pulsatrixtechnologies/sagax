// A bot's name and title as two lines. A name carried over with its title
// glued on ("Heron · Chief of Staff", the way Grok Bot stores it) shows as
// the name, with the title under it; JC: never "Name · Title" on one line.
// `merged` is true when the title came out of the name, so a save of either
// line writes both fields back apart.
const GLUED = /^(.+?)\s+[·•|]\s+(.+)$/u;

export function splitBotNameTitle(name: string, title?: string): { name: string; title: string; merged: boolean } {
  const ownTitle = title?.trim() ?? "";
  const ownName = name.trim();
  const glued = GLUED.exec(ownName);
  if (!glued) return { name, title: ownTitle, merged: false };
  const [, head, tail] = glued;
  // a title already set wins over the glued one
  return { name: head.trim(), title: ownTitle || tail.trim(), merged: true };
}
