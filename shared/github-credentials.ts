// One list of GitHub (and other git host) credentials, Capabilities >
// Sources > GitHub (2026-10-28). A person's own labeled tokens and the
// organization's shared ones live together; each marketplace picks one of
// them, or "Automatic". A client sees a label and a redacted hint, never the
// token (server/github/github-credentials.ts).
import { orgGithubTokenHint } from "./org-github-tokens.ts";

export { orgGithubTokenHint as githubCredentialHint };

/** Per person. The organization keeps MAX_ORG_GITHUB_TOKENS (20). */
export const MAX_PERSON_GITHUB_CREDENTIALS = 50;

export interface GithubCredentialPublic {
  id: string;
  label: string;
  /** Last 4 characters, or "saved". Never the token. */
  hint: string;
  /** "org": shared by an organization admin with everyone; "mine": the viewer's own. */
  owner: "org" | "mine";
  /** Read only where a marketplace picks it (a former per-marketplace token),
   * never tried by Automatic. */
  onlyWhereChosen?: boolean;
  /** How many marketplaces pick it (all scopes). */
  chosenBy: number;
}

/** What a marketplace row says about its credential. */
export interface MarketplaceCredentialView {
  /** The credential the marketplace picks; absent: Automatic. */
  chosen?: { id: string; label: string; owner: "org" | "mine" | "other" };
  /** The credential that last read it (a clone or a fetch that worked). */
  used?: { via: "person" | "credential" | "none"; label?: string; login?: string; at: number };
}

export type GithubCredentialChange =
  | { op: "add"; label: string; token: string; scope?: "mine" | "org" }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "replace"; id: string; token: string };
