// The shadcn/ui kit a ```widget document carries. A widget is plain
// HTML/CSS/JS in a sandboxed iframe with no network, so React components are
// out of reach: the kit is a self-contained stylesheet instead, with the
// shadcn theme variables (--background, --card, --primary, ...) computed from
// the active Sagax skin and component classes (.card, .btn, .badge, .table,
// ...) drawn like the app's own blocks, the ConnectWise widget first
// (src/components/cw/CwWidgetView.tsx). Nothing here touches the DOM except
// readWidgetTheme, and every value that reaches the document is sanitized.

/** The app tokens a widget theme is computed from (src/styles.css). */
export const WIDGET_THEME_TOKENS = [
  "--code-color-scheme",
  "--color-ink",
  "--color-ink-secondary",
  "--color-ink-tertiary",
  "--color-panel",
  "--color-card",
  "--color-menu",
  "--color-raised",
  "--color-raised-hover",
  "--color-inset",
  "--color-hairline",
  "--color-accent",
  "--color-accent-ink",
  "--color-accent-text",
  "--color-focus",
  "--color-unread",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--color-danger-ink",
  "--identity-purple",
  "--font-sans",
] as const;

export type WidgetThemeToken = (typeof WIDGET_THEME_TOKENS)[number];
export type WidgetThemeTokens = Partial<Record<WidgetThemeToken, string>>;

/** The Midnight and Pulsatrix Light values, used when a token cannot be read
 * (a test, a server render) so a widget never draws unthemed. */
const FALLBACK: Record<"light" | "dark", Record<Exclude<WidgetThemeToken, "--code-color-scheme" | "--identity-purple">, string>> = {
  dark: {
    "--color-ink": "#f5f5f5",
    "--color-ink-secondary": "#f5f5f5a8",
    "--color-ink-tertiary": "#f5f5f58a",
    "--color-panel": "#161616",
    "--color-card": "#1f1f1f",
    "--color-menu": "#1f1f1f",
    "--color-raised": "#1f1f1f",
    "--color-raised-hover": "#2c2c2c",
    "--color-inset": "#1b1b1b",
    "--color-hairline": "#353535",
    "--color-accent": "#f5f5f5",
    "--color-accent-ink": "#121212",
    "--color-accent-text": "#7cb5ff",
    "--color-focus": "#1884fc",
    "--color-unread": "#1884fc",
    "--color-success": "#00ba69",
    "--color-warning": "#e28600",
    "--color-danger": "#ff6463",
    "--color-danger-ink": "#121212",
    "--font-sans": "\"Geist Variable\", -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif",
  },
  light: {
    "--color-ink": "#161616",
    "--color-ink-secondary": "#161616a8",
    "--color-ink-tertiary": "#1616168a",
    "--color-panel": "#ffffff",
    "--color-card": "#ffffff",
    "--color-menu": "#ffffff",
    "--color-raised": "#f2f2f2",
    "--color-raised-hover": "#e8e8e8",
    "--color-inset": "#f6f6f6",
    "--color-hairline": "#dedede",
    "--color-accent": "#2a78d6",
    "--color-accent-ink": "#ffffff",
    "--color-accent-text": "#1f63b8",
    "--color-focus": "#2a78d6",
    "--color-unread": "#2a78d6",
    "--color-success": "#13804f",
    "--color-warning": "#b35c00",
    "--color-danger": "#d12c3a",
    "--color-danger-ink": "#ffffff",
    "--font-sans": "Inter, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", system-ui, sans-serif",
  },
};

/** A token value safe to write inside a <style> declaration: colors,
 * color-mix(), numbers and font lists. Anything that could close the rule,
 * open a tag or name a resource (url(), @import, image-set) is refused. */
export function safeTokenValue(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  if (!text || text.length > 300) return undefined;
  if (!/^[\w\s#%().,'"+\-/]*$/.test(text)) return undefined;
  if (/url\s*\(|image-set|image\s*\(|expression|@import|\\/i.test(text)) return undefined;
  // quotes must pair, or a font name could swallow the rest of the rule
  if ((text.match(/"/g)?.length ?? 0) % 2 || (text.match(/'/g)?.length ?? 0) % 2) return undefined;
  return text;
}

export interface WidgetTheme {
  scheme: "light" | "dark";
  /** the `:root{...}` rule with the shadcn variables, ready for a <style> */
  css: string;
}

const mix = (color: string, percent: number, other = "transparent") => `color-mix(in srgb, ${color} ${percent}%, ${other})`;

/** The shadcn variables for a set of Sagax tokens. Missing or unsafe tokens
 * take the fallback of the scheme. */
export function widgetThemeFromTokens(tokens: WidgetThemeTokens): WidgetTheme {
  const scheme = tokens["--code-color-scheme"]?.trim() === "light" ? "light" : "dark";
  const base = FALLBACK[scheme];
  const token = (name: keyof typeof base) => safeTokenValue(tokens[name]) ?? base[name];
  const ink = token("--color-ink");
  const panel = token("--color-panel");
  const raised = token("--color-raised");
  const hairline = token("--color-hairline");
  const accent = token("--color-accent");
  const success = token("--color-success");
  const warning = token("--color-warning");
  const danger = token("--color-danger");
  const purple = safeTokenValue(tokens["--identity-purple"]) ?? token("--color-accent-text");
  const vars: Record<string, string> = {
    "color-scheme": scheme,
    // the widget sits on the bubble: no ground of its own
    "--background": "transparent",
    "--foreground": ink,
    "--card": panel,
    "--card-foreground": ink,
    "--popover": token("--color-menu"),
    "--popover-foreground": ink,
    "--primary": accent,
    "--primary-foreground": token("--color-accent-ink"),
    "--secondary": raised,
    "--secondary-foreground": ink,
    "--muted": token("--color-inset"),
    "--muted-foreground": token("--color-ink-secondary"),
    "--subtle-foreground": token("--color-ink-tertiary"),
    "--accent": token("--color-raised-hover"),
    "--accent-foreground": ink,
    "--destructive": danger,
    "--destructive-foreground": token("--color-danger-ink"),
    "--success": success,
    "--warning": warning,
    "--info": token("--color-accent-text"),
    "--border": mix(hairline, 50),
    "--input": mix(hairline, 60),
    "--ring": token("--color-focus"),
    "--radius": "12px",
    "--chart-1": token("--color-unread"),
    "--chart-2": success,
    "--chart-3": warning,
    "--chart-4": purple,
    "--chart-5": danger,
    "--font-sans": token("--font-sans"),
    // the names older widgets were told about
    "--omb-bg": "transparent",
    "--omb-fg": ink,
    "--omb-muted": token("--color-ink-secondary"),
    "--omb-border": hairline,
    "--omb-accent": token("--color-accent-text"),
  };
  const css = `:root{${Object.entries(vars).map(([name, value]) => `${name}:${value}`).join(";")}}`;
  return { scheme, css };
}

/** Read the tokens from where the widget is drawn (its skin may be a
 * subtree, like the picker's live miniatures). */
export function readWidgetTheme(element: object | null): WidgetTheme {
  const tokens: WidgetThemeTokens = {};
  // through globalThis: the server's tests read this module without the DOM lib
  const computed = (globalThis as { getComputedStyle?: (target: object) => { getPropertyValue(name: string): string } }).getComputedStyle;
  if (element && typeof computed === "function") {
    try {
      const style = computed.call(globalThis, element);
      for (const name of WIDGET_THEME_TOKENS) {
        const value = style.getPropertyValue(name).trim();
        if (value) tokens[name] = value;
      }
    } catch {
      // unthemed: the fallback below
    }
  }
  return widgetThemeFromTokens(tokens);
}

/** The message the app posts to a widget frame when the skin changes. */
export const WIDGET_THEME_MESSAGE = "sagax-widget-theme";

/** Runs in the widget document: swaps the theme rule when the app posts a
 * new one. Only the parent may post it. */
export const WIDGET_THEME_LISTENER = `(function(){addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.type!==${JSON.stringify(WIDGET_THEME_MESSAGE)}||typeof d.css!=='string')return;var s=document.getElementById('sagax-theme');if(s)s.textContent=d.css;});})();`;

// Inline SVG masks (data: images are allowed by the widget CSP): drawn in
// currentColor through mask-image, so they follow the theme.
const SEARCH_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E\")";
const CHECK_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\")";
const CHEVRON_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

const tint = (color: string, percent: number) => `color-mix(in srgb,var(${color}) ${percent}%,transparent)`;
const toward = (color: string, percent: number) => `color-mix(in srgb,var(${color}) ${percent}%,var(--foreground))`;
const FOCUS = "outline:none;box-shadow:0 0 0 2px " + tint("--ring", 60);

/** Reset, typography and the component classes. Static: every color is a
 * variable of the theme rule, so a skin change never rebuilds it. */
export const WIDGET_KIT_CSS = [
  // reset and ground: transparent, no margin around the widget
  "*,*::before,*::after{box-sizing:border-box}",
  "html,body{margin:0;padding:0;background:transparent}",
  "body{padding:2px;color:var(--foreground);font-family:var(--font-sans);font-size:13px;line-height:20px;-webkit-font-smoothing:antialiased;overflow-x:auto;display:flow-root}",
  "body>:first-child{margin-top:0}body>:last-child{margin-bottom:0}",
  "button,input,select,textarea{font:inherit;color:inherit;letter-spacing:inherit}",
  "h1,h2,h3,h4{margin:0 0 6px;font-weight:600;color:var(--foreground)}h1{font-size:18px;line-height:26px;letter-spacing:-.01em}h2{font-size:16px;line-height:22px;letter-spacing:-.01em}h3{font-size:14px;line-height:20px}h4{font-size:13px;line-height:18px}",
  "p{margin:0 0 8px}small,.text-xs{font-size:12px;line-height:16px}.text-sm{font-size:13px}.text-base{font-size:14px;line-height:20px}",
  "a{color:var(--info);text-underline-offset:2px}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;padding:1px 5px;border-radius:6px;background:var(--muted)}",
  ".muted,.text-muted{color:var(--muted-foreground)}.subtle{color:var(--subtle-foreground)}.tabular,.num{font-variant-numeric:tabular-nums}",
  ".truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".eyebrow{font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:.16em;color:var(--subtle-foreground)}",
  // layout helpers
  ".row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.stack{display:flex;flex-direction:column;gap:12px}.spacer{flex:1}",
  ".grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}.grid-2{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}.grid-3{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}",
  // card: one surface, the ConnectWise widget's
  ".card{min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:calc(var(--radius) + 4px);background:var(--card);color:var(--card-foreground);box-shadow:0 1px 2px rgb(0 0 0 / .05)}",
  `.card+.card{margin-top:8px}.card-rail{box-shadow:inset 4px 0 0 var(--primary),0 1px 2px rgb(0 0 0 / .05)}.card-rail>*{margin-inline-start:4px}`,
  `.card-header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid ${mixVar("--border", 80)};background:${tint("--secondary", 40)}}`,
  ".card-header>.grow,.card-header>div:not([class]){min-width:0}",
  ".card-title{margin:0;font-size:14px;line-height:20px;font-weight:600;color:var(--card-foreground)}",
  ".card-description{margin:0;font-size:12px;line-height:16px;color:var(--subtle-foreground)}",
  ".card-action{margin-inline-start:auto;display:flex;flex:1 1 12rem;max-width:20rem;align-items:center;justify-content:flex-end;gap:8px;min-width:12rem}.card-action>.search{flex:1}.card-action>.btn{flex-shrink:0}",
  ".card-content{padding:12px 14px}.card-content.flush{padding:0}",
  `.card-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-top:1px solid ${mixVar("--border", 80)};background:${tint("--muted", 40)}}`,
  ".icon-tile{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--muted);color:var(--foreground)}.icon-tile svg{width:15px;height:15px}",
  ".count{font-size:12px;color:var(--subtle-foreground)}",
  // buttons: the app's pills
  ".btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:1px solid transparent;border-radius:999px;background:var(--primary);color:var(--primary-foreground);font-size:12px;font-weight:600;line-height:1;white-space:nowrap;cursor:pointer;user-select:none;transition:background-color .15s,opacity .15s}",
  `.btn:hover{opacity:.9}.btn:focus-visible{${FOCUS}}.btn:disabled,.btn[aria-disabled=true]{opacity:.5;pointer-events:none}.btn svg{width:14px;height:14px;flex-shrink:0}`,
  ".btn-default{background:var(--primary);color:var(--primary-foreground)}",
  ".btn-secondary{background:var(--secondary);color:var(--secondary-foreground);font-weight:500}.btn-secondary:hover{opacity:1;background:var(--accent)}",
  ".btn-outline{background:transparent;border-color:var(--input);color:var(--muted-foreground);font-weight:500}.btn-outline:hover{opacity:1;background:var(--accent);color:var(--accent-foreground)}",
  ".btn-outline[aria-pressed=true]{background:var(--primary);border-color:var(--primary);color:var(--primary-foreground)}",
  ".btn-ghost{background:transparent;color:var(--muted-foreground);font-weight:500}.btn-ghost:hover{opacity:1;background:var(--accent);color:var(--accent-foreground)}",
  ".btn-destructive{background:var(--destructive);color:var(--destructive-foreground)}",
  ".btn-link{background:transparent;color:var(--info);padding:0;height:auto;font-weight:500}.btn-link:hover{text-decoration:underline}",
  ".btn-sm{height:28px;padding:0 10px;font-size:11.5px}.btn-lg{height:40px;padding:0 18px;font-size:14px}.btn-icon{width:32px;padding:0}.btn-sm.btn-icon{width:28px}",
  // badges: soft tints, as the ticket statuses
  ".badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid transparent;border-radius:999px;background:var(--primary);color:var(--primary-foreground);font-size:11px;line-height:16px;font-weight:500;white-space:nowrap}",
  ".badge-default{background:var(--primary);color:var(--primary-foreground)}",
  ".badge-secondary{background:var(--muted);color:var(--muted-foreground)}",
  ".badge-outline{background:transparent;border-color:var(--input);color:var(--muted-foreground)}",
  `.badge-destructive{background:${tint("--destructive", 15)};color:${toward("--destructive", 70)}}`,
  `.badge-success{background:${tint("--success", 15)};color:${toward("--success", 70)}}`,
  `.badge-warning{background:${tint("--warning", 15)};color:${toward("--warning", 70)}}`,
  `.badge-info{background:${tint("--info", 15)};color:var(--info)}`,
  // fields
  `.input,.select,.textarea{display:block;width:100%;min-width:0;height:32px;padding:0 12px;border:1px solid var(--input);border-radius:999px;background:var(--card);color:var(--foreground);font-size:13px;outline:none}`,
  ".input::placeholder,.textarea::placeholder{color:var(--subtle-foreground)}",
  `.input:focus-visible,.select:focus-visible,.textarea:focus-visible{${FOCUS}}.input:disabled,.select:disabled,.textarea:disabled{opacity:.5}`,
  ".textarea{height:auto;min-height:72px;padding:8px 12px;border-radius:12px;line-height:20px;resize:vertical}",
  `.select{appearance:none;-webkit-appearance:none;padding-inline-end:30px;background-image:none;cursor:pointer}`,
  `.select-wrap{position:relative;display:block}.select-wrap::after{content:"";position:absolute;inset-inline-end:11px;top:50%;width:13px;height:13px;margin-top:-6.5px;background:var(--subtle-foreground);-webkit-mask:${CHEVRON_MASK} center/contain no-repeat;mask:${CHEVRON_MASK} center/contain no-repeat;pointer-events:none}`,
  `.search{position:relative;display:block;min-width:0}.search::before{content:"";position:absolute;inset-inline-start:10px;top:50%;width:13px;height:13px;margin-top:-6.5px;background:var(--subtle-foreground);-webkit-mask:${SEARCH_MASK} center/contain no-repeat;mask:${SEARCH_MASK} center/contain no-repeat;pointer-events:none}.search .input{padding-inline-start:32px;font-size:12px}`,
  ".label{display:block;margin-bottom:4px;font-size:12px;font-weight:500;color:var(--muted-foreground)}",
  ".field{display:flex;flex-direction:column;gap:4px;min-width:0}",
  `input.checkbox{appearance:none;-webkit-appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--input);border-radius:5px;background:var(--card);cursor:pointer;display:inline-grid;place-content:center;vertical-align:middle}`,
  `input.checkbox::before{content:"";width:11px;height:11px;background:var(--primary-foreground);-webkit-mask:${CHECK_MASK} center/contain no-repeat;mask:${CHECK_MASK} center/contain no-repeat;transform:scale(0);transition:transform .12s}`,
  "input.checkbox:checked{background:var(--primary);border-color:var(--primary)}input.checkbox:checked::before{transform:scale(1)}",
  `input.checkbox:focus-visible,input.switch:focus-visible,input.radio:focus-visible{${FOCUS}}`,
  "input.radio{appearance:none;-webkit-appearance:none;flex-shrink:0;width:16px;height:16px;margin:0;border:1px solid var(--input);border-radius:50%;background:var(--card);cursor:pointer;vertical-align:middle}input.radio:checked{border:5px solid var(--primary)}",
  "input.switch{appearance:none;-webkit-appearance:none;position:relative;flex-shrink:0;width:32px;height:18px;margin:0;border-radius:999px;background:var(--input);cursor:pointer;transition:background-color .15s;vertical-align:middle}",
  "input.switch::before{content:\"\";position:absolute;top:2px;inset-inline-start:2px;width:14px;height:14px;border-radius:50%;background:var(--card);box-shadow:0 1px 2px rgb(0 0 0 / .25);transition:transform .15s}",
  "input.switch:checked{background:var(--primary)}input.switch:checked::before{transform:translateX(14px);background:var(--primary-foreground)}",
  "input[type=range]{width:100%;accent-color:var(--primary);touch-action:pan-y}",
  // form rows: a label that wraps (or sits beside) a checkbox, radio or switch is
  // one line of auto width whose text wraps normally, whatever kit class the
  // bot put on the label; the kit control look stays on the input itself
  "label{max-width:100%}label:has(>input[type=checkbox],>input[type=radio]),label.checkbox,label.radio,label.switch,label.check{display:flex;flex-direction:row;align-items:flex-start;gap:8px;width:auto;min-width:0;height:auto;padding:0;margin:0;border:0;background:none;cursor:pointer;white-space:normal;overflow-wrap:anywhere}",
  "label>input[type=checkbox],label>input[type=radio]{flex-shrink:0;margin-top:2px}input[type=checkbox]:not(.checkbox):not(.switch),input[type=radio]:not(.radio){width:auto;height:auto;min-width:0;accent-color:var(--primary)}",
  "input.input[type=checkbox],input.input[type=radio]{width:auto;min-width:0}",
  // dragging a slider or pressing a control never selects text around it
  "label,button,summary,input[type=range],input[type=checkbox],input[type=radio]{-webkit-user-select:none;user-select:none}body:has(input[type=range]:active){-webkit-user-select:none;user-select:none}",
  // tabs
  ".tabs{display:flex;flex-direction:column;gap:10px}",
  ".tabs-list{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--muted);width:fit-content;max-width:100%;overflow-x:auto}",
  ".tabs-trigger{height:28px;padding:0 12px;border:0;border-radius:999px;background:transparent;color:var(--muted-foreground);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}",
  `.tabs-trigger:hover{color:var(--foreground)}.tabs-trigger:focus-visible{${FOCUS}}`,
  ".tabs-trigger[aria-selected=true],.tabs-trigger.active{background:var(--card);color:var(--foreground);box-shadow:0 1px 2px rgb(0 0 0 / .12)}",
  ".tabs-content[hidden]{display:none}",
  // table: the ConnectWise list
  ".table-wrap{overflow-x:auto}",
  ".table{width:100%;border-collapse:collapse;font-size:13px}",
  `.table thead{background:${tint("--muted", 50)}}`,
  ".table th{padding:8px 12px;text-align:start;font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--subtle-foreground);white-space:nowrap}",
  `.table td{padding:10px 12px;vertical-align:middle;color:var(--foreground)}`,
  `.table tbody tr{border-top:1px solid ${mixVar("--border", 60)}}.table tbody tr:hover{background:${tint("--secondary", 50)}}`,
  ".table td.num,.table th.num{text-align:end;font-variant-numeric:tabular-nums}",
  ".table td.id{color:var(--muted-foreground);font-variant-numeric:tabular-nums}",
  ".table td.title{max-width:14rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}",
  ".table td.muted{max-width:9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  // separator, progress, alert, avatar, skeleton, kbd
  ".separator,hr{height:1px;margin:12px 0;border:0;background:var(--border)}.separator-vertical{width:1px;height:auto;align-self:stretch;margin:0 8px}",
  ".progress{position:relative;width:100%;height:6px;overflow:hidden;border-radius:999px;background:var(--muted)}",
  ".progress>span,.progress>div,.progress-indicator{display:block;height:100%;border-radius:inherit;background:var(--primary);transition:width .2s}",
  "progress.progress{appearance:none;-webkit-appearance:none;border:0}progress.progress::-webkit-progress-bar{background:var(--muted);border-radius:999px}progress.progress::-webkit-progress-value{background:var(--primary);border-radius:999px}progress.progress::-moz-progress-bar{background:var(--primary);border-radius:999px}",
  ".alert{display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:2px;align-items:start;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:var(--card);color:var(--card-foreground);font-size:13px}",
  ".alert>:not(svg):not(.alert-icon){grid-column:2}.alert>svg,.alert-icon{grid-row:span 2;width:16px;height:16px;margin-top:2px}",
  ".alert-title{font-weight:600;line-height:20px}.alert-description{color:var(--muted-foreground);line-height:18px}",
  `.alert-destructive{border-color:${tint("--destructive", 40)};color:${toward("--destructive", 70)}}`,
  `.alert-warning{border-color:${tint("--warning", 40)};color:${toward("--warning", 70)}}`,
  `.alert-success{border-color:${tint("--success", 40)};color:${toward("--success", 70)}}`,
  ".avatar{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:32px;height:32px;overflow:hidden;border-radius:50%;background:var(--muted);color:var(--muted-foreground);font-size:12px;font-weight:600}.avatar img{width:100%;height:100%;object-fit:cover}.avatar-sm{width:24px;height:24px;font-size:10px}",
  ".skeleton{border-radius:8px;background:var(--secondary);animation:sx-pulse 2s ease-in-out infinite}@keyframes sx-pulse{50%{opacity:.5}}",
  ".kbd{display:inline-flex;align-items:center;height:20px;min-width:20px;padding:0 5px;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;background:var(--muted);color:var(--muted-foreground);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}",
  ".stat{font-size:28px;line-height:1;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}",
  "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}",
].join("");

function mixVar(name: string, percent: number): string {
  return `color-mix(in srgb,var(${name}) ${percent}%,transparent)`;
}

/** The kit as the bot is told about it (server/system-prompt.ts). */
export const WIDGET_KIT_CLASSES = [
  ".card .card-header .card-title .card-description .card-action .card-content .card-footer .eyebrow .icon-tile .count",
  ".btn (+ .btn-secondary .btn-outline .btn-ghost .btn-destructive .btn-link, .btn-sm .btn-lg .btn-icon)",
  ".badge (+ .badge-secondary .badge-outline .badge-success .badge-warning .badge-destructive)",
  ".input .search .textarea .select .checkbox .radio .switch .label .field",
  ".tabs .tabs-list .tabs-trigger[aria-selected] .table .separator .progress .alert .avatar .skeleton .kbd .stat",
  ".row .stack .grid .muted",
] as const;

/** The app's Geist face (latin, variable weight) as a data: URL, so a widget
 * draws in the app's font without a network request (font-src data:). */
export function widgetFontFace(dataUrl: string): string {
  if (!/^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return "";
  return `@font-face{font-family:'Geist Variable';font-style:normal;font-display:block;font-weight:100 900;src:url(${dataUrl}) format('woff2-variations'),url(${dataUrl}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
}
