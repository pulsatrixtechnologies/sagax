#!/usr/bin/env -S node --experimental-strip-types
/**
 * Headless screenshots of bot content (published pages and chat widgets) as
 * the app draws them, in a light and a dark theme: a dashboard, a report and
 * a list, each as a page (HTML or Markdown) and as a widget. The documents
 * are built by this checkout's own renderers (pageDocument, widgetHostPage),
 * so running it on main and on a branch gives the before and after.
 * Headless Chromium only (Playwright): no window opens, no network.
 * Usage: node --experimental-strip-types scripts/capture/bot-content-theme.ts
 *   [--out DIR] [--prefix before|after]
 *   (SAGAX_VERIFY_BROWSER_CHROME=<chromium> to use an installed browser)
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { pageDocument } from "../../server/pages/published-pages-render.ts";
import { geistFace, widgetHostPage } from "../../server/widgets/widget-check.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]! : fallback;
};
const outDir = resolve(arg("--out", join(root, "docs", "screenshots", "bot-content-theme")));
const prefix = arg("--prefix", "after");

// What a bot writes when it follows the prompt: the kit's classes, no colors.
const DASHBOARD = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tableau de bord</title></head><body>
<header class="page-header"><div class="eyebrow">Support · semaine 43</div><h1>Tableau de bord du support</h1><p class="lead">Billets ouverts, temps de réponse et charge par technicien.</p></header>
<div class="grid">
  <div class="card stat-card"><div class="stat-label">Billets ouverts</div><div class="stat">42</div><div class="stat-delta positive">−6 vs semaine passée</div></div>
  <div class="card stat-card"><div class="stat-label">Première réponse</div><div class="stat">1 h 12</div><div class="stat-delta negative">+8 min</div></div>
  <div class="card stat-card"><div class="stat-label">Résolus</div><div class="stat">118</div><div class="stat-delta">stable</div></div>
</div>
<h2>Charge par technicien</h2>
<div class="card"><div class="card-content"><div class="bar-chart">
  <div class="bar-row"><span class="bar-label">Alex</span><span class="bar" style="--value:82%"></span><span class="bar-value">18</span></div>
  <div class="bar-row"><span class="bar-label">Camille</span><span class="bar" style="--value:64%"></span><span class="bar-value">14</span></div>
  <div class="bar-row"><span class="bar-label">Sam</span><span class="bar" style="--value:41%"></span><span class="bar-value">9</span></div>
</div></div></div>
<h2>Billets prioritaires</h2>
<table><thead><tr><th>#</th><th>Client</th><th>Sujet</th><th>État</th></tr></thead><tbody>
<tr><td>4812</td><td>Client A</td><td>Courriel en panne</td><td><span class="badge badge-destructive">Urgent</span></td></tr>
<tr><td>4809</td><td>Client B</td><td>Imprimante réseau</td><td><span class="badge badge-warning">En attente</span></td></tr>
<tr><td>4801</td><td>Client C</td><td>Accès VPN</td><td><span class="badge badge-success">Résolu</span></td></tr>
</tbody></table>
</body></html>`;

const REPORT = `# Rapport mensuel d'infrastructure

Octobre 2026. Sommaire des incidents, des sauvegardes et des mises à jour.

## Faits saillants

- **Disponibilité** : 99,97 % sur les serveurs suivis.
- **Sauvegardes** : 312 réussies, 2 reprises.
- **Correctifs** : 48 postes mis à jour, 3 en attente.

> Les deux reprises de sauvegarde ont réussi au deuxième essai.

## Sauvegardes par site

| Site | Réussies | Reprises | Taille |
|:-----|--------:|--------:|------:|
| Siège | 180 | 1 | 2,4 To |
| Entrepôt | 92 | 1 | 640 Go |
| Bureau nord | 40 | 0 | 210 Go |

## Prochaines étapes

1. Remplacer le disque du NAS de l'entrepôt.
2. Planifier la mise à jour \`firmware 7.2\` du pare-feu.

---

Préparé automatiquement.`;

const LIST = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Liste</title></head><body>
<h1>Tâches de la semaine</h1>
<p class="muted">Cinq tâches, triées par échéance.</p>
<ul class="list">
  <li><div><strong>Renouveler le certificat SSL</strong><div class="muted">Portail client</div></div><span class="badge badge-warning">Lundi</span></li>
  <li><div><strong>Audit des comptes inactifs</strong><div class="muted">Microsoft 365</div></div><span class="badge badge-secondary">Mardi</span></li>
  <li><div><strong>Test de restauration</strong><div class="muted">Serveur de fichiers</div></div><span class="badge badge-secondary">Jeudi</span></li>
  <li><div><strong>Mise à jour du pare-feu</strong><div class="muted">Siège</div></div><span class="badge badge-outline">Vendredi</span></li>
</ul>
<hr>
<h2>Notes</h2>
<p>Le test de restauration demande une fenêtre de <code>2 h</code>. Voir aussi <a href="#">la procédure</a>.</p>
<p><button class="btn">Exporter</button> <button class="btn btn-secondary">Partager</button></p>
</body></html>`;

// A page that brings its own look: the theme is a base it overrides.
const OWN_STYLE = `<!doctype html><html><head><meta charset="utf-8"><style>body{background:#fdf6e3;color:#073642;font-family:Georgia,serif;max-width:none;margin:0;padding:24px}h1{color:#b58900}</style></head><body><h1>Une page à son propre style</h1><p>Le fond, la police et les couleurs viennent de la page.</p></body></html>`;

const WIDGET_DASHBOARD = `<div class="card"><div class="card-header"><div><div class="eyebrow">Support</div><div class="card-title">Cette semaine</div></div><span class="count">3 indicateurs</span></div>
<div class="card-content"><div class="grid-3"><div><div class="stat-label">Ouverts</div><div class="stat">42</div><div class="stat-delta positive">−6</div></div><div><div class="stat-label">Réponse</div><div class="stat">1 h 12</div><div class="stat-delta negative">+8 min</div></div><div><div class="stat-label">Résolus</div><div class="stat">118</div></div></div>
<div class="separator"></div><div class="bar-chart"><div class="bar-row"><span class="bar-label">Alex</span><span class="bar" style="--value:82%"></span><span class="bar-value">18</span></div><div class="bar-row"><span class="bar-label">Camille</span><span class="bar bar-2" style="--value:64%"></span><span class="bar-value">14</span></div></div></div></div>`;

const WIDGET_LIST = `<div class="card"><div class="card-header"><div class="card-title">Tâches</div><div class="card-action"><button class="btn btn-sm btn-secondary">Tout voir</button></div></div>
<div class="card-content flush"><ul class="list"><li><span>Renouveler le certificat SSL</span><span class="badge badge-warning">Lundi</span></li><li><span>Audit des comptes inactifs</span><span class="badge badge-secondary">Mardi</span></li><li><span>Test de restauration</span><span class="badge badge-success">Fait</span></li></ul></div></div>`;

const PAGES = [
  { name: "page-tableau-de-bord", kind: "html" as const, content: DASHBOARD },
  { name: "page-rapport", kind: "markdown" as const, content: REPORT },
  { name: "page-liste", kind: "html" as const, content: LIST },
  { name: "page-style-propre", kind: "html" as const, content: OWN_STYLE },
];
const WIDGETS = [
  { name: "widget-tableau-de-bord", code: WIDGET_DASHBOARD },
  { name: "widget-liste", code: WIDGET_LIST },
];
// The Pulsatrix skin's tokens (src/styles.css), as the app sends them with
// its preview address: the page follows the person's skin, not only light
// or dark.
const PULSATRIX = {
  dark: { "--code-color-scheme": "dark", "--color-panel": "#060f20", "--color-raised": "#16233c", "--color-raised-hover": "#1d2d4c", "--color-card": "#0d192c", "--color-menu": "#0d1729", "--color-inset": "#081225", "--color-hairline": "#223353", "--color-ink": "#eef2fb", "--color-ink-secondary": "#9aa6c2", "--color-ink-tertiary": "#8d99b5", "--color-accent": "#3c76f4", "--color-unread": "#3c76f4", "--color-accent-text": "#c8e4ff", "--color-focus": "#4f86f7", "--color-accent-ink": "#030b17", "--color-success": "#38d591", "--color-danger": "#f25a64", "--color-danger-ink": "#030b17", "--color-warning": "#ff9800" },
  light: { "--code-color-scheme": "light", "--color-panel": "#f6f8fb", "--color-raised": "#ffffff", "--color-raised-hover": "#e6ebf4", "--color-card": "#ffffff", "--color-menu": "#ffffff", "--color-inset": "#dfe6f2", "--color-hairline": "#b8c3d9", "--color-ink": "#0b1526", "--color-ink-secondary": "#4f5868", "--color-ink-tertiary": "#4f5868", "--color-accent": "#2f62dd", "--color-unread": "#2f62dd", "--color-accent-text": "#2652bd", "--color-focus": "#2652bd", "--color-accent-ink": "#f6f8fc", "--color-success": "#0f5132", "--color-danger": "#c02936", "--color-danger-ink": "#ffffff", "--color-warning": "#7d4d09" },
};
const THEMES = [{ theme: "light" as const, label: "clair" }, { theme: "dark" as const, label: "sombre" }];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.SAGAX_VERIFY_BROWSER_CHROME ? { executablePath: process.env.SAGAX_VERIFY_BROWSER_CHROME } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, offline: true });
  for (const { theme, label } of THEMES) {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: theme });
    for (const fixture of PAGES) {
      await page.goto("about:blank");
      const html = pageDocument({ kind: fixture.kind, title: fixture.name, content: fixture.content, lang: "fr" }, { meta: true, theme, font: geistFace() } as Parameters<typeof pageDocument>[1]);
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(outDir, `${prefix}-${fixture.name}-${label}.png`), fullPage: true });
    }
    // the dashboard in the Pulsatrix skin, as the app's preview asks for it
    await page.goto("about:blank");
    await page.setContent(pageDocument({ kind: "html", title: "skin", content: DASHBOARD, lang: "fr" }, { meta: true, theme, skin: PULSATRIX[theme], font: geistFace() } as Parameters<typeof pageDocument>[1]), { waitUntil: "load" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(outDir, `${prefix}-page-tableau-de-bord-skin-pulsatrix-${label}.png`), fullPage: true });
    await page.close();
    // a fresh page per widget: a page's CSP meta stays with its document
    for (const fixture of WIDGETS) {
      const host = await context.newPage();
      await host.emulateMedia({ colorScheme: theme });
      await host.setViewportSize({ width: 640, height: 200 });
      await host.setContent(widgetHostPage(fixture.code, theme), { waitUntil: "load" });
      await host.waitForTimeout(400);
      await host.screenshot({ path: join(outDir, `${prefix}-${fixture.name}-${label}.png`), fullPage: true });
      await host.close();
    }
  }
  // beside the app: its conversation in the same theme (docs/screenshots/geist-font)
  for (const { theme, label } of THEMES) {
    const app = join(root, "docs", "screenshots", "geist-font", `apres-conversation-${label}.png`);
    const mine = join(outDir, `${prefix}-page-tableau-de-bord-skin-pulsatrix-${label}.png`);
    if (!existsSync(app) || !existsSync(mine)) continue;
    const img = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
    const ground = theme === "dark" ? "#0b0b0b" : "#e9e9e9";
    const side = await context.newPage();
    await side.setViewportSize({ width: 1600, height: 800 });
    await side.setContent(`<body style="margin:0;padding:16px;display:flex;gap:16px;align-items:flex-start;background:${ground}"><img style="width:50%;border-radius:8px" src="${await img(app)}"><img style="width:50%;border-radius:8px" src="${await img(mine)}"></body>`, { waitUntil: "load" });
    await side.screenshot({ path: join(outDir, `${prefix}-comparaison-app-${label}.png`), fullPage: true });
    await side.close();
  }
} finally {
  await browser.close();
}
console.log(`captures in ${outDir}`);
