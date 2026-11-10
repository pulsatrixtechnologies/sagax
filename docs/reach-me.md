# Reach me ("Me joindre")

When a bot has a question or an approval that waits on you, it can reach you
outside the app. You choose how, and when, for each bot: Bot panel >
Overview > Reach me. Nobody else chooses for you and no administrator has to
turn it on. Your Primary Bot can change it for you from any conversation
(`sagax_settings`, keys `notifications.reachMe`,
`notifications.reachMeTelegram` and `notifications.reachMeWhatsApp`).

## Channels

| Channel | What it needs | How you answer |
|---|---|---|
| Phone notifications | The Sagax app paired on your iPhone or Android phone | In the app, or Allow/Deny on the banner (iPhone) |
| Text message | Your Perspicax Voice line, and your own number verified on it | Text back the code, then `oui`/`non` (or your answer) |
| Microsoft Teams | A bot of yours whose engine has a Teams connector (Microsoft 365 on claude.ai, Microsoft Teams on grok.com) | Write the code and your answer in your own Teams chat with yourself, within 40 minutes |
| Telegram | Your own Telegram bot, made with BotFather | Reply to it with the code and your answer |
| WhatsApp | Your own WhatsApp Business number (WhatsApp Cloud API, your Meta app) | Reply with the code and your answer |

Every message carries a short code for that card only, for example
`KM3X`. Answer `KM3X oui` to allow, `KM3X non` to deny, or `KM3X` followed
by your answer to a question. A reply without the right code, from another
number or another chat, answers nothing. A card that needs your security key
can only be denied from outside: open Sagax to allow it. A card of a
confidential conversation never shows its content outside the app.

## Hours

"Any time", or one or more ranges of days and times in your time zone
(22:00 to 07:00 runs past midnight). Outside them nothing leaves the app for
that bot; a card still open when your next range starts is sent then.

## Telegram

1. In Telegram, ask BotFather for a new bot and copy its token.
2. On the bot page, turn Telegram on, paste the token, Connect.
3. Open the link Sagax shows and press Start. That chat is now the only one
   your bot listens to.

The token is sealed on the server and never shown again. Disconnect forgets
it and the chat.

## WhatsApp

1. In your Meta app (WhatsApp > API Setup), copy an access token and your
   business number's Phone Number ID. For replies, copy the app secret too
   (App settings > Basic).
2. On the bot page, turn WhatsApp on, paste them, Connect. Sagax checks them
   with Meta and shows the business number.
3. Prove your own number: open the WhatsApp link and send `SAGAX <code>`,
   or type your number and get the code by your message template, then type
   it back. Only that number is written to or read from.
4. For replies, in your Meta app (WhatsApp > Configuration), paste the
   callback URL and the verify token (Copy buttons on the bot page) and
   subscribe to `messages`. This needs the server's public webhook address
   (`SAGAX_WEBHOOK_PUBLIC_URL`); without one, WhatsApp only notifies you and
   you answer in Sagax.

WhatsApp lets a business write plain text only within 24 hours of your last
message. Outside that window Sagax uses your approved message template: set
its name and language, and your WhatsApp Business Account ID (WhatsApp >
API Setup), on the bot page; it needs one body parameter, which carries the
card's text. Sagax reads that template at Meta (a free read that sends
nothing) each time you save it, and again when Meta refuses a message for
its template. Until Meta says it is approved, in that language, with that
one parameter, WhatsApp shows as not ready, with the reason and what to do
(Check again on the page). Every message is billed by Meta to your account:
Sagax never retries one. The token and app secret are sealed on the server
and never shown again. Disconnect forgets them and your number.

## Teams

Sagax has no Teams app of its own. Each message, and each check for your
answer, is a short run of one of your own bots ("Reach me (Teams)" in
Automations), with your own engine sign-in. That one send to your own chat
asks for no extra approval; anything else the run tries keeps its usual card.
Sagax looks for your answer 2, 6, 15 and 40 minutes after the message.

## Text messages

Texts go from your Perspicax Voice line to your own number, only when the
line lists that number as verified. Each text is billed by the telephony
provider: Sagax never retries one and never answers your reply by text.
The reply reaches Sagax through the Perspicax Voice inbound route
(`POST /api/org/telephony/inbound`), which hands it to `reachMeSmsReply`
(`server/reach-me/inbound.ts`) before the bot's phone triggers.

Developer notes: `docs/code/reach.md`, "Reach me: one setting per bot to reach the
person outside the app".
