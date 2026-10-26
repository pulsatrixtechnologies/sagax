// Stacked bars per period: successes at the bottom, failures on top, an
// empty period as a hairline; a native `title` per bar ("12 oct. : 5
// réussies, 1 échec"). No chart library. Same contract as the Perspicax
// console's `MiniBars` (its spec, section 8.0).
import { t } from "@/lib/i18n";

export interface MiniBarsProps {
  series: { label: string; ok: number; fail: number }[];
  max?: number;
  /** Pixels; 28 by default. */
  height?: number;
}

export function MiniBars({ series, max, height = 28 }: MiniBarsProps) {
  const top = Math.max(1, max ?? Math.max(0, ...series.map((row) => row.ok + row.fail)));
  return (
    <div role="img" aria-label={t("code.bars.aria")} className="flex items-end gap-[3px]" style={{ height }}>
      {series.map((row, index) => {
        const total = row.ok + row.fail;
        const title = t("code.bars.title", { label: row.label, ok: row.ok, fail: row.fail });
        if (total === 0) return <span key={index} title={title} className="h-px flex-1 rounded-full bg-hairline" />;
        return (
          <span key={index} title={title} className="flex flex-1 flex-col-reverse overflow-hidden rounded-[2px]" style={{ height: Math.max(3, (total / top) * height) }}>
            <span className="bg-success" style={{ flexGrow: row.ok }} />
            <span className="bg-danger" style={{ flexGrow: row.fail }} />
          </span>
        );
      })}
    </div>
  );
}
