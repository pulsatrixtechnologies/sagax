# Issue 3411: design

Team chat channels: Slack, Microsoft Teams, Discord and the others, where a
team talks to a bot. Design only. Building starts after the feature freeze
(it ends on 2026-11-24) and after the owner's word on this note. Until then
Slack and Teams stay removed from every surface that offered them (#3398,
`shared/team-chat-channels.ts`, `TEAM_CHAT_CHANNELS_OFFERED = false`).

## What the two reference projects do

Both were read before this note (their public documentation, 2026-11-14).

- One gateway process holds every platform connection. Each platform is an
  adapter: it receives a message, maps it to a session, hands it to the
  agent, and sends the reply back in the platform's own form.
- Transport is the platform's own push, chosen so that no public address is
  needed where the platform allows it: Slack defaults to Socket Mode (HTTP
  Request URLs as the other mode), Discord uses its gateway websocket (the
  Message Content intent is required), Teams needs a bot registration with
  an HTTPS messaging endpoint.
- Who may talk: a policy per direct message (pairing, list, open) and per
  group (allowed channels, mention required or not). One reference refuses
  everyone not listed; the other pairs by default.
- Sessions: one per chat, and per thread where the platform has threads.
  The conversation does not reset by itself.
- In a group, a message not addressed to the bot stays silent; the model can
  answer with a silence token, and unaddressed messages are kept as quiet
  context.
- Bot-to-bot loops are capped (a hop count).
- Approvals use the platform's own controls: Slack buttons and modals,
  Teams Adaptive Cards, Discord components.
- Setup: one command per channel, an app manifest for Slack, an app package
  for Teams, a status probe afterwards.

## Decision

A **team channel** links one bot to places in one team chat workspace. It
is connected by the person from the bot's page, in the Channels card that
already exists (#3398): one row per platform, its status line, and Connect
or Manage. A platform this server cannot offer is not drawn.

It is a third, separate thing next to two that stay as they are:

- **Reach me** (`server/reach-me/`): the bot reaching its own person, one to
  one, for a card that waits on them. Unchanged. Its Teams self chat and its
  Telegram bot stay.
- **Typed triggers** (`server/triggers/`): a Slack or Teams event waking a
  routine. Unchanged as a feature; the team channel reuses its signature
  checks and event parsing instead of writing them again.

Nothing in duplicate: one credential per platform per bot, used by every
feature of that bot on that platform (the Telegram token of Reach me is the
same token a Telegram team channel uses; one Slack app per bot serves the
channel and the Slack triggers of that bot).

## Pieces

### 1. Channel contract (`server/channels/`)

```ts
interface TeamChannelAdapter {
  platform: "slack" | "teams" | "discord" | "telegram" | "google-chat" | "mattermost" | "matrix";
  offered(env): boolean;              // false: the row is not drawn
  connect(botId, credentials): Promise<ConnectResult>;
  status(botId): TeamChannelStatus;   // cheap, no network
  start(botId, sink): Stop;           // socket, gateway or webhook route
  send(place, reply): Promise<SentRef>;
  update(ref, reply): Promise<void>;  // streaming edits
  askApproval(place, card, owner): Promise<void>;
}
```

The inbound side gives one normalized message: platform, workspace, place
(channel or direct chat), thread, author (platform id and display name),
whether the bot is addressed, text, files, and whether the author is a bot.

### 2. Credentials

The person's own app, as Reach me does for Telegram and WhatsApp:

- Slack: the bot page opens Slack's "create app from manifest" with a
  manifest Sagax generates (bot name, scopes, Socket Mode on, slash command
  `/<bot>`); the person installs it and pastes the bot token and the app
  token.
- Discord: the person pastes the bot token from the developer portal; the
  bot page gives the invite link with the exact permissions and reminds the
  one switch Discord needs (Message Content intent), checked by the status
  probe.
- Teams: the bot page generates the app package (manifest and icons, zip)
  for the person's bot registration (app id, secret or certificate) and the
  messaging endpoint of this server. Offered only when the server has a
  public HTTPS origin; otherwise the row is not drawn.
- Where a hosted Admin manages the Slack app for the workspace
  (`server/hosted-slack.ts`), that is the row's source instead, shown as
  managed. One row, never two.

Secrets are sealed in the existing Reach me secrets file
(`server/reach-me/secrets.ts`, renamed to channel secrets with a read of
the old file), never in a log, a prompt, an audit row or an answer.

### 3. Where the bot listens and who may talk

Set by the person on the row, nothing else asks:

- Places: the channels the bot was added to in the platform, all on by
  default; the person can turn one off on the row.
- In a channel the bot answers when it is mentioned, in its own threads, and
  in a direct message. "Answer without a mention" is a switch per place.
- Who may talk: everyone in the places that are on (default), or only the
  people the person lists.
- Isolation between people is kept: the bot acts with its owner's access,
  so an approval card of a turn started from a channel goes to the owner
  only (the bot's chat in Sagax as today, and the owner's own direct
  message on the platform with its native buttons). Someone else in the
  channel sees "waiting on <owner>", never the buttons. The full access
  level of the bot applies unchanged: a bot in Full access asks nothing.

### 4. Sessions and the chat

- One conversation context per place and thread (Slack thread, Teams reply
  chain, Discord thread or channel). It does not reset by itself.
- Every turn is visible in the bot's one chat in Sagax, as an "Asked by
  <name> in <place>" line above the reply, like an inbound text today
  (#4112). No thread view, no "Open thread".
- Unaddressed messages in a place that is on are kept as quiet context for
  the next addressed turn (a short history), not answered.

### 5. Replies

- Streaming: the first reply is posted at once and edited as it grows
  (Slack `chat.update`, Discord message edit, Teams update activity),
  throttled to the platform's rate.
- Markdown converted per platform (Slack mrkdwn, Teams Markdown subset,
  Discord Markdown); tables as code blocks where the platform has none.
- Files the bot writes are uploaded; files posted to the bot reach its
  turn as attachments.
- Routine passes never post to a channel unless the routine's own output is
  set to that place (the quiet routines rule).
- A message from another bot is ignored unless it mentions this bot; a
  chain between bots stops after three hops.

### 6. What goes away

When the first platform ships: `TEAM_CHAT_CHANNELS_OFFERED`, the Slack
sub-page (`SlackSection.tsx`, `useSlackManagement.ts`), "Add to Slack" on a
bot and on a group as separate doors (the Channels card is the one door),
and the phone's Slack entry in Connect apps, which opens the same row.

## Lots

1. Contract, store, sessions, the chat line, the Channels card row, and
   Slack (Socket Mode, then HTTP Request URLs reusing the trigger signature
   check).
2. Discord.
3. Microsoft Teams.
4. Phone and tablet: the same row on the bot page.
5. Telegram groups (the Reach me token), Google Chat, Mattermost, Matrix.

## Tests per lot

- Adapter: a recorded inbound payload becomes the normalized message;
  signature refused when wrong; reply and edit calls shaped as the platform
  wants (fake transport, no network).
- Mention gating, the place switch, the people list, the bot-loop cap.
- Approval of a channel turn reaches the owner only.
- The row is not drawn when the platform is not offered.
- UX gate: headless captures of the Channels card (connected, not
  connected, not offered) in French and English, light and dark, next to a
  Settings page.
