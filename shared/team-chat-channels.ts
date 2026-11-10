// Slack and Microsoft Teams as a channel between a team and a bot (#3398,
// the owner 2026-11-10): removed for now, they do not work end to end. While
// this is false the server offers no Slack link (GET /api/bots/:id/
// slack-management answers { available: false }), so every surface that
// offers one (the bot profile's Channels card, the bot panel's Slack page,
// "Add to Slack" on a bot or a group, the phone's Connect apps) hides it:
// an option that cannot work is hidden. The code stays; the complete
// integration of Slack, Teams and the others is #3411.
//
// Not this switch: "Reach me" by Teams, the bot reaching its own person in
// their Teams self chat through their engine's connector
// (server/reach-me/teams.ts), which works end to end and stays.
export const TEAM_CHAT_CHANNELS_OFFERED = false;
