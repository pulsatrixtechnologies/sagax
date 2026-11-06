// The GitHub sign-in card a bot posts in its chat (#2109, 2026-11-05, JC:
// "every GitHub connection uses a generated GitHub link plus a pairing code;
// the token is the last resort"). connect_github starts GitHub's device flow
// for the person speaking and the server posts this card in the same chat:
// the code with Copy code, the github.com link with Open link. Once the
// person approves on github.com the server patches the same card to
// "GitHub connected as @login". It lives in the bot's chat only: no Open
// thread, no side panel. `text` on the row is the fallback for clients that
// do not know the field.

export type GithubConnectCardState = "pending" | "connected" | "failed" | "cancelled";

export interface GithubConnectCard {
  state: GithubConnectCardState;
  /** the code the person types at github.com (pending) */
  userCode?: string;
  /** github.com's page where the code is typed (pending) */
  verificationUri?: string;
  /** when the code stops working, epoch ms (pending) */
  expiresAt?: number;
  /** the GitHub account connected (connected) */
  login?: string;
  /** why it stopped (failed) */
  error?: string;
}

/** The plain line a client without the card shows instead. */
export function githubConnectCardText(card: GithubConnectCard): string {
  switch (card.state) {
    case "pending":
      return `Connect GitHub: open ${card.verificationUri ?? "https://github.com/login/device"} and enter the code ${card.userCode ?? ""}.`.replace(/ \.$/, ".");
    case "connected":
      return `GitHub connected as @${card.login ?? ""}.`;
    case "failed":
      return `GitHub sign-in stopped: ${card.error ?? "start again"}`;
    default:
      return "GitHub sign-in replaced by a newer code.";
  }
}
