// @ts-nocheck
/** serializeRoomContext (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSerializeRoomContext(getHost: () => Host): any {
function serializeRoomContext(   threadId: string,   userName: string,   textOverrides?: ReadonlyArray<{ messageId: string; text: string }>,   readerBotId?: string, ) {
  const host = getHost();
  const { peerName } = host;

  const messages = host.store.messagesFor(threadId);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const overrides = new Map(textOverrides?.map((override) => [override.messageId, override.text]));
  return host.roomContextRows(messages)
    .map((m) => {
      if (m.kind === "digest" && m.digest) {
        return digestPromptLine(m.digest, m.from ? peerName(m.from.name) : "a bot");
      }
      if (m.roomRequest?.phase === "result") {
        // Keep the chat receipt small without erasing the report from later
        // turns. Resolve from the existing bounded store and recheck access.
        return host.teammateReportContext(m.roomRequest.id, readerBotId);
      }
      const overridden = overrides.get(m.id);
      const rendered = overridden !== undefined ? { ...m, text: overridden } : m;
      // a bot's name is quoted on the speaker line, so it gets one line; a
      // user line that came through the API says so, since the reader would
      // otherwise take it for the person typing
      const person = m.sender?.name ?? userName;
      const speaker = m.role === "user"
        ? m.via === "api" ? `${person} (sent through the local API, not typed)` : person
        : m.from ? peerName(m.from.name) : "Bot";
      // An outside app chose a webhook line's words: every reader is told,
      // the bot it is shown as included.
      if (m.webhookPost && m.role !== "user") return `${speaker}: ${webhookPostText(m.from?.name ?? "Bot", transcriptText(rendered, messagesById, userName))}`;
      const line = `${speaker}: ${escapeNotes(transcriptText(rendered, messagesById, userName))}`;
      // A room reply is the room talking. A post_to_room message is another
      // bot's text carried in from somewhere else, so it says so — the
      // reader's own posts excepted, which would only be telling it about
      // itself.
      if (!m.peerPost || !m.from || m.from.botId === readerBotId) return line;
      return `${peerProvenanceNote({ botName: m.from.name, delivery: "post_to_room", unattended: m.peerPost.unattended })}\n${line}`;
    })
    .join("\n");

}
  return serializeRoomContext;
}
