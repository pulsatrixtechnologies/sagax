/** Isolated gallery for Playwright screenshots of the ```widget fence (HTML
 * in the sandboxed iframe, src/components/WidgetFrame.tsx) drawn with the
 * shadcn/ui kit (src/lib/widget-kit.ts). Not shipped in the app.
 * The native service desk list sits beside the same table written in HTML
 * with the kit: they should read as one.
 * ?skin=<id>&lang=<code>&only=<section> */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CwWidgetView } from "../components/cw/CwWidgetView";
import { WidgetFrame } from "../components/WidgetFrame";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { cwWidgetFromToolCall } from "../../shared/cw-widgets/tool-call";
import { FIXTURE_TICKETS, fixtureQueryResult } from "../../shared/cw-widgets/fixtures";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const tickets = cwWidgetFromToolCall("cw_psa_query", JSON.stringify({ resource: "service/tickets" }), fixtureQueryResult(FIXTURE_TICKETS))!;

const TICKET_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>`;

const CW_HTML = `<div class="card card-rail">
  <div class="card-header">
    <span class="icon-tile">${TICKET_ICON}</span>
    <div><div class="eyebrow">Acme Desk</div><div class="card-title">Billets</div></div>
    <span class="count">4 de 4</span>
    <div class="card-action">
      <button class="btn btn-outline" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') !== 'true')">Ouverts seulement</button>
      <label class="search"><input class="input" placeholder="Rechercher"></label>
    </div>
  </div>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>#</th><th>Billet</th><th>Entreprise</th><th>Statut</th><th>Heures</th></tr></thead>
    <tbody>
      <tr><td class="id">48213</td><td class="title">Imprimante du 2e étage hors ligne</td><td class="muted">Clinique vétérinaire Beauport</td><td><span class="badge badge-secondary">En cours</span></td><td class="tabular">1.25 h</td></tr>
      <tr><td class="id">48220</td><td class="title">Renouvellement du certificat SSL du portail client</td><td class="muted">Les Bois Laurentides inc.</td><td><span class="badge badge-warning">Nouveau</span></td><td class="tabular"></td></tr>
      <tr><td class="id">48231</td><td class="title">Accès VPN pour la nouvelle employée</td><td class="muted">Clinique vétérinaire Beauport</td><td><span class="badge badge-warning">En attente du client</span></td><td class="tabular"></td></tr>
      <tr><td class="id">48102</td><td class="title">Migration des boîtes courriel vers Microsoft 365</td><td class="muted">Coopérative du Vieux-Port</td><td><span class="badge badge-success">Fermé</span></td><td class="tabular"></td></tr>
    </tbody>
  </table></div>
</div>`;

const INPUTS = `<div class="card">
  <div class="card-header"><div><div class="eyebrow">Inputs</div><div class="card-title">Planifier un rappel</div><div class="card-description">Champs, choix et interrupteurs du kit.</div></div></div>
  <div class="card-content stack">
    <div class="grid-2">
      <div class="field"><label class="label" for="t">Titre</label><input id="t" class="input" placeholder="Rappeler le client" value="Suivi Beauport"></div>
      <div class="field"><label class="label" for="w">Quand</label><span class="select-wrap"><select id="w" class="select"><option>Demain 9 h</option><option>Lundi</option></select></span></div>
    </div>
    <label class="search"><input class="input" placeholder="Rechercher un contact"></label>
    <div class="field"><label class="label" for="n">Note</label><textarea id="n" class="textarea" placeholder="Détails"></textarea></div>
    <div class="row"><input type="checkbox" class="checkbox" id="c1" checked><label for="c1">Notifier par courriel</label><span class="spacer"></span><label for="s1" class="muted">Récurrent</label><input type="checkbox" class="switch" id="s1" checked></div>
    <div class="row"><input type="radio" class="radio" name="p" checked> Haute <input type="radio" class="radio" name="p"> Normale</div>
  </div>
  <div class="card-footer"><button class="btn btn-ghost">Annuler</button><span class="spacer"></span><button class="btn btn-secondary">Brouillon</button><button class="btn">Enregistrer</button></div>
</div>`;

const DATA = `<div class="card">
  <div class="card-header"><div><div class="eyebrow">Data &amp; charts</div><div class="card-title">Heures de la semaine</div></div><span class="count">27,5 h</span></div>
  <div class="card-content stack">
    <div class="grid-3">
      <div><div class="eyebrow">Facturables</div><div class="stat">21,0</div></div>
      <div><div class="eyebrow">Internes</div><div class="stat">6,5</div></div>
      <div><div class="eyebrow">Taux</div><div class="stat">76 %</div></div>
    </div>
    <svg viewBox="0 0 300 90" width="100%" height="90" role="img" aria-label="Heures par jour">
      <g>${[[18, 8, "--chart-1"], [70, 7.5, "--chart-1"], [122, 6, "--chart-1"], [174, 4, "--chart-2"], [226, 2, "--chart-3"]].map(([x, h, c]) => `<rect x="${x}" y="${80 - Number(h) * 9}" width="40" height="${Number(h) * 9}" rx="5" fill="var(${c})"/>`).join("")}</g>
      <line x1="0" x2="300" y1="80.5" y2="80.5" stroke="var(--border)"/>
    </svg>
    <div class="row"><span class="badge badge-outline">Lun</span><span class="badge badge-outline">Mar</span><span class="badge badge-outline">Mer</span><span class="badge badge-outline">Jeu</span><span class="badge badge-outline">Ven</span></div>
  </div>
</div>`;

const FEEDBACK = `<div class="card">
  <div class="card-header"><div><div class="eyebrow">Feedback</div><div class="card-title">Sauvegardes de la nuit</div></div></div>
  <div class="card-content stack">
    <div class="alert alert-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg><div class="alert-title">12 sur 13 réussies</div><div class="alert-description">Dernière vérification à 03:10.</div></div>
    <div class="alert alert-destructive"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><div class="alert-title">SRV-FS01 en échec</div><div class="alert-description">Le volume D: n'est plus accessible.</div></div>
    <div class="stack" style="gap:6px"><div class="row"><span class="muted">Réplication hors site</span><span class="spacer"></span><span class="tabular">68 %</span></div><div class="progress"><span style="width:68%"></span></div></div>
    <div class="row"><div class="skeleton" style="width:32px;height:32px;border-radius:50%"></div><div class="stack" style="gap:6px;flex:1"><div class="skeleton" style="height:10px;width:60%"></div><div class="skeleton" style="height:10px;width:40%"></div></div></div>
    <div class="row"><span class="badge">Nouveau</span><span class="badge badge-secondary">En analyse</span><span class="badge badge-warning">En attente</span><span class="badge badge-success">Fermé</span><span class="badge badge-destructive">Critique</span></div>
  </div>
</div>`;

const LAYOUT = `<div class="card">
  <div class="tabs card-content">
    <div class="tabs-list" role="tablist">
      <button class="tabs-trigger" role="tab" aria-selected="true">Équipe</button><button class="tabs-trigger" role="tab" aria-selected="false">Clients</button><button class="tabs-trigger" role="tab" aria-selected="false">Ententes</button>
    </div>
    <div class="stack" style="gap:10px">
      <div class="row"><span class="avatar">AM</span><div><div style="font-weight:500">Alex</div><div class="muted text-xs">Technique, Québec</div></div><span class="spacer"></span><span class="badge badge-success">Disponible</span></div>
      <div class="separator" style="margin:0"></div>
      <div class="row"><span class="avatar">MV</span><div><div style="font-weight:500">Mallory</div><div class="muted text-xs">Ventes</div></div><span class="spacer"></span><span class="badge badge-secondary">En réunion</span></div>
    </div>
  </div>
  <script>document.querySelectorAll('.tabs-trigger').forEach(function(b){b.onclick=function(){document.querySelectorAll('.tabs-trigger').forEach(function(o){o.setAttribute('aria-selected', String(o===b));});};});</script>
</div>`;

const TOOLS = `<div class="card">
  <div class="card-header"><span class="icon-tile">%</span><div><div class="eyebrow">Tools</div><div class="card-title">Calculateur de marge</div></div><div class="card-action"><span class="kbd">⌘</span><span class="kbd">K</span></div></div>
  <div class="card-content stack">
    <div class="grid-2">
      <div class="field"><label class="label" for="cost">Coût</label><input id="cost" class="input" type="number" value="1200"></div>
      <div class="field"><label class="label" for="m">Marge (%)</label><input id="m" class="input" type="number" value="35"></div>
    </div>
    <input type="range" min="0" max="80" value="35" id="r">
    <div class="row"><span class="muted">Prix de vente</span><span class="spacer"></span><span class="stat" id="out">1 846,15 $</span></div>
  </div>
  <div class="card-footer"><button class="btn btn-outline btn-sm">Réinitialiser</button><span class="spacer"></span><button class="btn btn-destructive btn-sm">Effacer</button><button class="btn btn-sm">Copier</button></div>
  <script>(function(){var c=document.getElementById('cost'),m=document.getElementById('m'),r=document.getElementById('r'),o=document.getElementById('out');function u(){var p=Number(c.value)/(1-Number(m.value)/100);o.textContent=new Intl.NumberFormat('fr-CA',{style:'currency',currency:'CAD'}).format(p);}m.oninput=function(){r.value=m.value;u();};r.oninput=function(){m.value=r.value;u();};c.oninput=u;u();})();</script>
</div>`;

// what a widget looked like before the kit: its own colors and ground
const LEGACY = `<style>.box{background:#1e2a44;color:#e7ecff;border:1px solid #6b5bd6;border-radius:10px;padding:12px;font-family:Arial}.box button{background:#7c5cff;color:white;border:0;border-radius:6px;padding:6px 10px}</style>
<div class="box"><b>Ancien widget</b> avec ses propres couleurs. <button>Action</button></div>`;

// #1799: <a target=_blank> and window.open post to the parent; no allow-popups
const EXTERNAL_LINKS = `<div class="card">
  <div class="card-header"><div><div class="eyebrow">#1799</div><div class="card-title">Liens externes</div><div class="card-description">Le pont ouvre le navigateur systeme, sans allow-popups.</div></div></div>
  <div class="card-content stack">
    <p><a href="https://example.com" target="_blank" rel="noopener noreferrer">Lien target=_blank</a></p>
    <button class="btn" type="button" onclick="window.open('https://example.com','_blank')">window.open</button>
  </div>
</div>`;

function Bubble({ children }: { children: ReactNode }) {
  return <div data-chat-bubble className="w-full max-w-[780px] rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink">{children}</div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  if (only && only !== title) return null;
  return (
    <section data-gallery-section={title}>
      <h2 className="mb-3 font-mono text-[12px] text-ink-tertiary">{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <h1 className="text-lg font-semibold">Widgets HTML (```widget) avec le kit shadcn/ui</h1>
        <Section title="cw-native-vs-html">
          <div className="grid gap-6 lg:grid-cols-2">
            <div><p className="mb-2 text-[12px] text-ink-secondary">Widget natif (```cw)</p><Bubble><CwWidgetView widget={tickets} brand="Acme Desk" threadId="gallery" botId="gallery" /></Bubble></div>
            <div><p className="mb-2 text-[12px] text-ink-secondary">Même tableau en HTML avec le kit</p><Bubble><WidgetFrame code={CW_HTML} /></Bubble></div>
          </div>
        </Section>
        <Section title="Inputs"><Bubble><WidgetFrame code={INPUTS} /></Bubble></Section>
        <Section title="Data & charts"><Bubble><WidgetFrame code={DATA} /></Bubble></Section>
        <Section title="Feedback"><Bubble><WidgetFrame code={FEEDBACK} /></Bubble></Section>
        <Section title="Layout"><Bubble><WidgetFrame code={LAYOUT} /></Bubble></Section>
        <Section title="Tools"><Bubble><WidgetFrame code={TOOLS} /></Bubble></Section>
        <Section title="external-links"><Bubble><WidgetFrame code={EXTERNAL_LINKS} /></Bubble></Section>
        <Section title="legacy"><Bubble><p className="mb-1">Un ancien widget garde ses couleurs, sans fond autour :</p><WidgetFrame code={LEGACY} /></Bubble></Section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
