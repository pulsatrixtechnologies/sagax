// The usage pill (owner 2026-11-26, M-20261126-099, M-20261126-108, #5406):
// a small shape of three measures (the week and the short session, every
// account that can serve the bot together, then the conversation's context)
// and a named percentage always in sight ("wk 44%", "5h 20%": the fuller
// account limit), with "back <day> <hour>" only when every account is
// blocked. One component for every place that shows it: it takes the values
// of `usagePill` (src/lib/usage-pill.ts) and holds no store, no fetch and no
// click of its own. Shapes: three bars, three circles, a battery, three dots,
// text only. A measure is quiet while there is room, warning from 75% and
// danger when full; the inks are the skin's.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { measureTone, windowFigure, type MeasureTone, type UsagePillValues } from "@/lib/usage-pill";
import type { UsagePillShape } from "@/lib/usage-pill-preferences";

const INK: Record<MeasureTone, string> = { quiet: "", warning: "text-warning", danger: "text-danger" };
/** A measure's fill: its own ink, whatever the pill around it wears. */
const FILL: Record<MeasureTone, string> = { quiet: "text-ink-secondary", warning: "text-warning", danger: "text-danger" };
const TRACK = 0.25;
const share = (percent: number | null) => Math.max(0, Math.min(100, percent ?? 0)) / 100;

/** The measures a shape draws, outside in: the week, the session, the context. */
function measuresOf(values: UsagePillValues, showContext: boolean): Array<number | null> {
  return showContext ? [values.week, values.fiveHour, values.context] : [values.week, values.fiveHour];
}

function Bars({ measures }: { measures: Array<number | null> }) {
  const top = (20 - (measures.length * 3.6 + (measures.length - 1) * 2.4)) / 2;
  return (
    <svg width={34} height={20} viewBox="0 0 34 20" fill="none" aria-hidden="true" className="shrink-0">
      {measures.map((percent, index) => {
        const y = top + index * 6;
        return (
          <g key={index}>
            <rect x={0} y={y} width={34} height={3.6} rx={1.2} fill="currentColor" fillOpacity={TRACK} />
            {share(percent) > 0 && <rect x={0} y={y} width={34 * share(percent)} height={3.6} rx={1.2} fill="currentColor" className={FILL[measureTone(percent)]} />}
          </g>
        );
      })}
    </svg>
  );
}

const RADII = [10, 6.6, 3.2];

function Circles({ measures }: { measures: Array<number | null> }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      {measures.map((percent, index) => {
        const radius = RADII[index]!;
        const around = 2 * Math.PI * radius;
        return (
          <g key={index}>
            <circle cx={12} cy={12} r={radius} stroke="currentColor" strokeOpacity={TRACK} strokeWidth={2.2} />
            {share(percent) > 0 && (
              <circle cx={12} cy={12} r={radius} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className={FILL[measureTone(percent)]}
                strokeDasharray={`${share(percent) * around} ${around}`} transform="rotate(-90 12 12)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** What is left, every account together, as a phone's battery: one measure
 * (the fuller account limit); the context is not in it. */
function Battery({ values }: { values: UsagePillValues }) {
  const left = 100 - Math.min(100, Math.max(values.week ?? 0, values.fiveHour ?? 0));
  const cells = Math.ceil(left / 25);
  return (
    <svg width={36} height={20} viewBox="0 0 36 20" fill="none" aria-hidden="true" className={cn("shrink-0", left === 0 && "text-danger")}>
      <rect x={1} y={4} width={30} height={12} rx={3} stroke="currentColor" strokeWidth={1.3} />
      <rect x={32} y={8} width={2} height={4} rx={1} fill="currentColor" />
      {[0, 1, 2, 3].map((index) => index < cells && (
        <rect key={index} x={3.4 + index * 6.6} y={6.4} width={5.4} height={7.2} rx={1} fill="currentColor" className={left <= 25 ? "text-warning" : undefined} />
      ))}
    </svg>
  );
}

function Dots({ measures }: { measures: Array<number | null> }) {
  const width = 10 + (measures.length - 1) * 11;
  return (
    <svg width={width} height={20} viewBox={`0 0 ${width} 20`} fill="none" aria-hidden="true" className="shrink-0">
      {measures.map((percent, index) => {
        const tone = measureTone(percent);
        return <circle key={index} cx={5 + index * 11} cy={10} r={4} fill="currentColor" fillOpacity={tone === "quiet" ? TRACK : 1} className={tone === "quiet" ? undefined : FILL[tone]} />;
      })}
    </svg>
  );
}

/** The measures written out: "ctx 34%", "5h 12%", "wk 22%", each in its own ink. */
function words(values: UsagePillValues, showContext: boolean): Array<{ key: string; text: string; tone: MeasureTone }> {
  const hours = values.named?.hours ?? 5;
  return [
    ...(showContext && values.context !== null ? [{ key: "context", text: t("usagePill.context", { percent: values.context }), tone: measureTone(values.context) }] : []),
    ...(values.fiveHour !== null ? [{ key: "session", text: windowFigure("five-hour", values.fiveHour, hours), tone: measureTone(values.fiveHour) }] : []),
    ...(values.week !== null ? [{ key: "week", text: windowFigure("weekly", values.week), tone: measureTone(values.week) }] : []),
  ];
}

/** Every measure in words, for a screen reader and a tooltip. */
export function usagePillLabel(values: UsagePillValues, showContext = true): string {
  return [...words(values, showContext).map((word) => word.text), ...(values.back ? [values.back] : [])].join(" · ");
}

/** The shape alone, at the bar's size (20px high). */
export function UsagePillGlyph({ shape, values, showContext = true }: { shape: UsagePillShape; values: UsagePillValues; showContext?: boolean }) {
  const measures = measuresOf(values, showContext);
  if (shape === "bars") return <Bars measures={measures} />;
  if (shape === "battery") return <Battery values={values} />;
  if (shape === "dots") return <Dots measures={measures} />;
  if (shape === "circles") return <Circles measures={measures} />;
  return null;
}

/** The pill's inside: the shape, then the named percentage. `textClassName`
 * lets its owner fold the words away where there is no room. */
export function UsagePill({ values, shape, showContext = true, className, textClassName }: {
  values: UsagePillValues;
  shape: UsagePillShape;
  showContext?: boolean;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span data-usage-pill="" data-shape={shape} data-tone={values.tone} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums", values.blocked && "text-danger", className)}>
      <UsagePillGlyph shape={shape} values={values} showContext={showContext} />
      {shape === "text" ? (
        // the words are the whole pill here: they never fold away
        <span data-usage-pill-text="" className="inline-flex items-center gap-2">
          {words(values, showContext).map((word) => <span key={word.key} data-measure={word.key} className={FILL[word.tone]}>{word.text}</span>)}
          {values.back && <span className="text-danger">{values.back}</span>}
        </span>
      ) : values.text && (
        <span data-usage-pill-text="" className={cn(INK[values.tone], textClassName)}>{values.text}</span>
      )}
    </span>
  );
}
