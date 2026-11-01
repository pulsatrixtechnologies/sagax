/** Byte strings that look alike and are not the same contract. Each caller
 * keeps its own wording. `formatBytes` is the locale ladder ("1,5 Ko").
 * src/lib/memory.ts stays on memoryText and stops at kilobytes. */

/** Archive trees: "512 B", "1.5 KB", "2.0 MB", "1.0 GB". */
export function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Network debugger: blank when the size is unknown, "kB" not "KB". */
export function formatDebuggerBytes(value: number | null): string {
  if (value === null || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** Server environment panel: mebibytes or gibibytes, "?" when unknown. */
export function formatPanelBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "?";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}

const french = (locale: string) => locale === "fr" || locale.startsWith("fr-");

function number(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(french(locale) ? "fr-CA" : "en-US", { maximumFractionDigits: digits }).format(value)
    // fr-CA groups with no-break spaces; the card uses plain ones and nowrap
    .replace(/[\u202f\u00a0]/g, " ");
}

const UNITS = { fr: ["o", "Ko", "Mo", "Go", "To", "Po"], en: ["B", "KB", "MB", "GB", "TB", "PB"] } as const;

/** 1024-based, one decimal under 10 and none above: "1,5 Ko", "16 Go", "512 B". */
export function formatBytes(bytes: number, locale: string): string {
  const units = french(locale) ? UNITS.fr : UNITS.en;
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${number(value, locale, digits)} ${units[unit]}`;
}
