// @ts-nocheck
/** roomRoutingInput (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoomRoutingInput(getHost: () => Host): any {
function roomRoutingInput(   roomName: string,   text: string,   members: readonly BotRecord[],   history: readonly Message[],   sender?: ResolvedSender, ) {
  const host = getHost();

  const userName = host.cfg.profile?.name?.trim() || "User";
  const clean = (value: string) => host.redactSecretsInText(host.extractTurnImages(value).text);
  const humans = new Set<string>([userName]);
  const recent = history.flatMap((m) => {
    if (m.kind !== "text" || !m.text) return [];
    if (m.role === "user") {
      const person = m.sender?.name ?? userName;
      humans.add(person);
      return [{ from: person, text: clean(m.text) }];
    }
    return [{ from: `${m.from?.name ?? "A bot"} (bot)`, text: clean(m.text) }];
  });
  const from = sender?.name ?? userName;
  humans.add(from);
  return {
    room: roomName,
    humans: [...humans],
    members: members.map((member) => ({ id: member.id, name: member.name, title: member.title, description: member.description })),
    recent,
    message: { from, text: clean(text) }
  };

}
  return roomRoutingInput;
}
