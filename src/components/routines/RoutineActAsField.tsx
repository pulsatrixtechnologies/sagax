// A routine's "Au nom de" (2026-11-05, visible roles batch 4): the
// Perspicax role its runs act as, chosen among the roles the run-as person
// holds now (GET /api/bots/:id/roles/routine-coverage, a live listing), with
// a coverage preview under it: what the routine's standing mandate needs
// that this role can write ("Couvert"), what it cannot and the reads known
// to be refused ("Non couvert"). Green when complete, amber otherwise, with
// the minimal covering role one click away. "Tester la couverture" runs the
// routine's readiness check (the Flow shadow) and shows its result beside it.
// Shown only where Perspicax lists roles; a solo server shows nothing.
import { useEffect, useState } from "react";
import { Check, ClipboardCheck, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { permissionText } from "@/lib/role-permission";
import { api } from "@/state/store";
import { ME_ROLE, roleCoverage, type CwPermission, type HeldRole, type RoleCoverage } from "../../../shared/perspicax-roles";
import type { RoutineRoleCoverageAnswer } from "../../../shared/routine-role-coverage";
import { roleLabel } from "../RoleChip";
import { PILL, PRIMARY_PILL, PillSelect } from "../SettingsPrimitives";
import { PanelRow, PanelValue } from "./PanelRows";
import { RoutineReadinessList, type RoutineReadinessControl } from "./RoutineReadiness";

export interface RoleCoverageState {
  answer?: RoutineRoleCoverageAnswer;
  loading?: boolean;
  error?: string;
}

/** The run-as person's roles and the routine's mandate, read live. A new
 * routine sends its prompt (debounced); a saved one its id. */
export function useRoutineRoleCoverage(input: { botId: string | undefined; routineId?: string; prompt?: string; enabled?: boolean }): RoleCoverageState {
  const { botId, routineId, prompt = "", enabled = true } = input;
  const [state, setState] = useState<RoleCoverageState>({});
  const key = enabled && botId ? `${botId}|${routineId ?? ""}|${routineId ? "" : prompt.slice(0, 2_000)}` : "";
  useEffect(() => {
    if (!key || !botId) { setState({}); return; }
    let alive = true;
    setState((current) => ({ ...current, loading: true }));
    const timer = setTimeout(() => {
      const query = new URLSearchParams(routineId ? { routineId } : { prompt: prompt.slice(0, 2_000) });
      void api<RoutineRoleCoverageAnswer>(`/api/bots/${encodeURIComponent(botId)}/roles/routine-coverage?${query.toString()}`).then(
        (answer) => { if (alive) setState(answer && Array.isArray(answer.held) && Array.isArray(answer.mandate) ? { answer } : {}); },
        (cause: unknown) => { if (alive) setState({ error: cause instanceof Error ? cause.message : String(cause) }); },
      );
    }, routineId ? 0 : 500);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** A standing mandate item in words; an unknown item keeps its id. */
export function mandateItemLabel(item: string): string | null {
  return tFromServer(`routineRole.item.${item}`, undefined) ?? null;
}

function roleOf(slug: string, held: readonly HeldRole[]): { slug: string; name: string } {
  return { slug, name: held.find((role) => role.slug === slug)?.name ?? slug };
}

/** The role's name as the field shows it ("" is "Moi"). */
export function actAsLabel(slug: string, held: readonly HeldRole[] = []): string {
  return roleLabel(roleOf(slug, held));
}

function Item({ item }: { item: string }) {
  const label = mandateItemLabel(item);
  return label ? <span>{label}</span> : <code className="rounded bg-inset px-1 font-mono text-[11.5px]">{item}</code>;
}

function NotCoveredLine({ row }: { row: RoleCoverage["notCovered"][number] }) {
  return <li data-coverage-missing={row.item} className="flex flex-col">
    <Item item={row.item} />
    <span className="text-[11.5px] text-ink-tertiary">{row.why === "read_only" ? t("routineRole.why.readOnly") : t("routineRole.why.refused", { permission: row.permission ? permissionText(row.permission) : row.item })}</span>
  </li>;
}

function RefusedReadLine({ permission }: { permission: CwPermission }) {
  return <li data-coverage-refused-read={permission.path} className="flex flex-col">
    <span>{t("routineRole.refusedRead")}</span>
    <span className="text-[11.5px] text-ink-tertiary">{permissionText(permission)}</span>
  </li>;
}

/** Two columns, green when the role covers everything, amber otherwise,
 * with the minimal role one click away. */
export function RoleCoveragePreview({ answer, slug, onUse, readiness, viewing = false, testResult = true }: {
  answer: RoutineRoleCoverageAnswer;
  slug: string;
  onUse?: (slug: string) => void;
  readiness?: RoutineReadinessControl;
  viewing?: boolean;
  /** Draw the test's result here (the routine page draws it under its rows). */
  testResult?: boolean;
}) {
  const coverage = roleCoverage(slug, answer.held, answer.mandate, answer.refusals);
  const held = !slug || answer.held.some((role) => role.slug === slug);
  const ok = coverage.ok && held && !answer.flowError;
  const role = actAsLabel(slug, answer.held);
  const suggested = answer.suggested;
  const offer = !ok && onUse && !viewing && suggested !== slug && roleCoverage(suggested, answer.held, answer.mandate, answer.refusals).notCovered.length < coverage.notCovered.length + (held ? 0 : 1);
  const missing = coverage.notCovered.length + coverage.refusedReads.length;
  return <div data-role-coverage={ok ? "ok" : "partial"} className="flex min-w-0 flex-col gap-2">
    <div className={cn("rounded-xl border px-3 py-2.5 text-[12.5px]", ok ? "border-success/30 bg-success/10" : "border-warning/35 bg-warning/10")}>
      <p className={cn("flex items-start gap-1.5 font-medium", ok ? "text-success" : "text-warning")}>
        {ok ? <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0" /> : <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />}
        <span>{!held ? t("routineRole.notHeld", { role }) : ok ? t("routineRole.complete", { role }) : t("routineRole.incomplete", { role })}</span>
      </p>
      {answer.recipe && <p className="mt-0.5 text-[11.5px] text-ink-tertiary">{t("routineRole.recipe", { name: answer.recipe })}</p>}
      {answer.flowError && <p className="mt-0.5 text-[11.5px] text-warning">{t("routineRole.mandateUnknown", { error: answer.flowError })}</p>}
      <div className="mt-2 grid grid-cols-2 gap-3 text-ink">
        <section aria-label={t("routineRole.covered")} data-coverage-covered="">
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("routineRole.covered")} {coverage.covered.length > 0 && <span>({coverage.covered.length})</span>}</h4>
          {answer.mandate.length === 0
            ? <p className="text-ink-secondary">{t("routineRole.readOnlyMandate")}</p>
            : coverage.covered.length === 0
              ? <p className="text-ink-tertiary">{t("routineRole.none")}</p>
              : <ul className="space-y-1">{coverage.covered.map((item) => <li key={item} data-coverage-item={item}><Item item={item} /></li>)}</ul>}
        </section>
        <section aria-label={t("routineRole.notCovered")} data-coverage-not-covered="">
          <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("routineRole.notCovered")} {missing > 0 && <span>({missing})</span>}</h4>
          {missing === 0
            ? <p className="text-ink-tertiary">{t("routineRole.none")}</p>
            : <ul className="space-y-1.5">
              {coverage.notCovered.map((row) => <NotCoveredLine key={row.item} row={row} />)}
              {coverage.refusedReads.map((permission) => <RefusedReadLine key={permission.path} permission={permission} />)}
            </ul>}
        </section>
      </div>
      {(offer || readiness) && <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {offer && <button type="button" data-role-use={suggested} onClick={() => onUse?.(suggested)}
          className={PRIMARY_PILL}>
          {t("routineRole.use", { role: actAsLabel(suggested, answer.held) })}
        </button>}
        {readiness && <button type="button" data-role-test="" disabled={readiness.checking} onClick={() => void readiness.check()}
          className={cn(PILL, "gap-1.5")}>
          {readiness.checking ? <Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ClipboardCheck size={12} aria-hidden="true" />}
          {t(readiness.checking ? "routineRole.testing" : "routineRole.test")}
        </button>}
      </div>}
    </div>
    {testResult && readiness?.error && <p role="alert" className="text-[12px] text-danger">{readiness.error}</p>}
    {testResult && readiness?.answer && <div data-role-test-result="" className="rounded-xl border border-hairline/40 px-3 py-2.5"><RoutineReadinessList checks={readiness.answer.checks} checkedAt={readiness.answer.checkedAt} /></div>}
  </div>;
}

/** The "Au nom de" row: the held roles and "Moi", the preview under it.
 * `value` undefined: not chosen yet, the suggestion shows. */
export function RoutineActAsField({ coverage, value, onChange, viewing = false, readiness, savedOnly, testResult = true }: {
  coverage: RoleCoverageState;
  testResult?: boolean;
  value: string | undefined;
  onChange?: (slug: string) => void;
  viewing?: boolean;
  readiness?: RoutineReadinessControl;
  /** The saved role, shown when the listing is not available. */
  savedOnly?: string;
}) {
  const answer = coverage.answer;
  if (!answer) {
    if (savedOnly === undefined) return null;
    return <PanelRow data-routine-act-as="" label={t("routineRole.label")} hint={coverage.loading ? t("routineRole.loading") : coverage.error ? t("routineRole.error", { error: coverage.error }) : undefined} help={t("routineRole.help")}>
      <PanelValue>{actAsLabel(savedOnly)}</PanelValue>
    </PanelRow>;
  }
  // Only a routine that runs a Pulsatrix Flow recipe picks a role (JC 2026-11-05).
  if (!answer.recipe) return null;
  const slug = value ?? answer.suggested;
  const options = [
    { value: ME_ROLE, label: t("roles.me") },
    ...answer.held.filter((role) => role.reachable || role.slug === slug).map((role) => ({ value: role.slug, label: roleLabel(role) })),
  ];
  if (!options.some((option) => option.value === slug)) options.push({ value: slug, label: actAsLabel(slug, answer.held) });
  const shown = options.map((option) => value === undefined && option.value === answer.suggested ? { ...option, label: t("routineRole.suggested", { role: option.label }) } : option);
  return <PanelRow data-routine-act-as={slug || "me"} label={t("routineRole.label")} hint={t("routineRole.hint")} help={t("routineRole.help")}
    below={<RoleCoveragePreview answer={answer} slug={slug} onUse={onChange} readiness={readiness} viewing={viewing} testResult={testResult} />}>
    {viewing || !onChange
      ? <PanelValue>{shown.find((option) => option.value === slug)?.label ?? actAsLabel(slug, answer.held)}</PanelValue>
      : <PillSelect ariaLabel={t("routineRole.label")} value={slug} options={shown} onChange={onChange} />}
  </PanelRow>;
}

/** The editor's auto-pick on save: the minimal role when nothing was chosen
 * and the coverage is known; an explicit choice is never overwritten. */
export function actAsToSave(saved: string | undefined, chosen: string | undefined, answer: RoutineRoleCoverageAnswer | undefined): string | undefined {
  if (chosen !== undefined) return chosen;
  if (saved !== undefined) return undefined;
  return answer?.recipe ? answer.suggested : undefined;
}
