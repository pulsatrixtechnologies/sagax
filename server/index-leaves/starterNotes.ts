// @ts-nocheck
/** starterNotes (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStarterNotes(getHost: () => Host): any {
function starterNotes(botId: string): Array<{ path: string; text: string }> {
  const host = getHost();

  const notes: Array<{ path: string; text: string }> = [];
  const index = host.withoutWiderAudience(host.readMemoryFile(botId).text, { kind: "public" }).text;
  if (index.trim()) notes.push({ path: "MEMORY.md", text: index });
  for (const topic of host.listMemoryTopics(botId).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = host.withoutWiderAudience(host.readMemoryTopic(botId, topic.name) ?? "", { kind: "public" }).text;
    if (text.trim()) notes.push({ path: `memory/${topic.name}`, text });
  }
  return notes;

}
  return starterNotes;
}
