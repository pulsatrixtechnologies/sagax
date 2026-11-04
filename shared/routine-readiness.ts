/** Stable wire codes: clients translate facts, while run errors remain English. */
export type RoutineReadinessKind = "engine" | "skills" | "mcp" | "perspicax" | "computer";
export type RoutineReadinessCode = "engine_credits" | "engine_limit" | "engine_signed_out" | "engine_artifacts" | "skill_missing" | "flow_profile" | "mcp_missing" | "perspicax_profile" | "computer_offline" | "ready" | "probe_error";
export interface RoutineReadinessCheck {
  kind: RoutineReadinessKind;
  ok: boolean;
  line: string;
  code: RoutineReadinessCode;
  params?: Record<string, string>;
  detail?: string;
}
export interface RoutineReadinessResult { ok: boolean; checks: RoutineReadinessCheck[] }
export interface RoutineReadinessAnswer extends RoutineReadinessResult { checkedAt: number }
export interface RoutineRequirements { skills?: string[]; mcpServers?: string[]; computer?: boolean }
