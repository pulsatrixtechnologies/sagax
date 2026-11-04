export type Place =
  | { kind: "all" | "teams" | "pinned" | "recent" | "review" | "archived" | "trash" | "collections" }
  | { kind: "tier"; tier: string }
  | { kind: "folder"; tier: string; folder: string };

export interface TrashRow {
  id: string;
  title: string;
  scope: string;
  topic?: string;
  tags?: string[];
  may_manage?: boolean;
  deleted_at?: string;
  author_name?: string | null;
}
