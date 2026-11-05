/** Stable wire codes: clients translate facts, while run errors remain English. */
export type RoutineReadinessKind = "engine" | "skills" | "mcp" | "perspicax" | "computer" | "flow";
export type RoutineReadinessCode = "engine_credits" | "engine_limit" | "engine_signed_out" | "engine_artifacts" | "skill_missing" | "flow_plan" | "mcp_missing" | "perspicax_profile" | "computer_offline" | "ready" | "probe_error";
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

/** #1996: the requirements with the "needs its computer" switch set to
 * `computer`, skills and MCP servers kept as they are; null when nothing is
 * left (a PATCH then clears them). */
export function withRequiredComputer(current: RoutineRequirements | null | undefined, computer: boolean): RoutineRequirements | null {
  const next: RoutineRequirements = {
    ...(current?.skills?.length ? { skills: [...current.skills] } : {}),
    ...(current?.mcpServers?.length ? { mcpServers: [...current.mcpServers] } : {}),
    ...(computer ? { computer: true } : {}),
  };
  return Object.keys(next).length ? next : null;
}
