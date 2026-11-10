// Team board (#3409): the per person kanban of the coding teams, computed by
// the server on demand from the bots' code work and GitHub. Read only.

export type TeamBoardColumn = "todo" | "design" | "code" | "review" | "merged" | "blocked";
export interface TeamBoardCard {
  key: string;                 // "owner/repo#123", never shown
  repo: string; number: number; title: string; issueUrl: string;
  column: TeamBoardColumn;
  stage?: Exclude<TeamBoardColumn, "merged" | "blocked" | "todo">; // when blocked
  holder?: { botId: string; name: string; threadId?: string };
  since?: number;
  pull?: { number: number; url: string; draft?: true; review?: "approved" | "changes_requested" | "required"; checks?: "failing" | "pending" | "passing" };
  blocked?: { source: "approval" | "turn" | "review" | "checks" | "conflict"; reason: string };
}
export interface TeamBoardLane { sectionId: string; name: string; lead?: { botId: string; name: string }; repos: string[]; cards: TeamBoardCard[] }
export interface TeamBoard { lanes: TeamBoardLane[]; at: number; github: { state: "ok" | "stale" | "unavailable" | "not_connected"; at?: number; fix?: string } }
