/** Isolated gallery of the record windows of the other plugins (M-20261127-141,
 * M-20261127-146): the real chips, the real HoverCard and the real record
 * window with its plugin bodies (a SentinelOne threat, an Axcient x360Recover
 * protected system, a BookStack page, a Twilio conversation, an X post, a
 * folder of files), over a stand-in console (src/lib/record-plugin-fixtures.ts)
 * that answers the card and the detail route and takes every write in memory
 * (nothing leaves the page). Invented records only.
 * ?lang=fr|en &skin=<id>
 *   &console=card  the console serves the cards only, no detail (the windows show the card's facts)
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { loadLocale } from "../lib/i18n";
import { seedPersonProducts } from "../lib/person-products";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import { parsePersonProduct, type PersonProduct } from "../../shared/person-products";
import { PLUGIN_PRODUCTS as P, pluginConsole, type Lang, type PluginScene } from "../lib/record-plugin-fixtures";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang: Lang = params.get("lang") === "en" ? "en" : "fr";
await loadLocale(lang);
const stand = pluginConsole(lang, params.get("console") === "card");

seedPersonProducts(stand.products.map((raw) => parsePersonProduct(raw)).filter((one): one is PersonProduct => Boolean(one)));
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/api/me/perspicax/products")) return json({ products: stand.products });
  const match = /\/api\/me\/records\/([^/]+)\/([^/]+)\/([^/?]+)(\/detail)?/.exec(url);
  if (match) {
    const [product, kind, id] = [decodeURIComponent(match[1]!), decodeURIComponent(match[2]!), decodeURIComponent(match[3]!)];
    if (match[4]) {
      if (init?.method === "POST") return stand.write(JSON.parse(String(init.body))) ? json({ updated: true }) : json({ code: "action_unknown" }, 400);
      const query = new URL(url, window.location.href).searchParams;
      const answer = stand.section(product, kind, id, query.get("section") ?? "", Number(query.get("page") ?? 1));
      return answer ? json(answer) : json({ state: "unavailable", code: "kind_unknown" }, 404);
    }
    const card = stand.card(product, kind, id);
    return json(card ? { card } : { state: "unknown" });
  }
  // the app's other routes are not this gallery's: answered as a server without them
  if (/\/(api|v1)\//.test(url)) return new Response(JSON.stringify({ error: "not in the gallery" }), { status: 404, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};

const link = (scene: PluginScene, label: string) => `[${label}](sagax://record/${P[scene].id}/${P[scene].kind}/${P[scene].record})`;
const CHAT = lang === "fr"
  ? `La menace ${link("threat", "Trojan.Agent")} sur ACME-PC-014 est atténuée. La sauvegarde de ${link("backup", "ACME-SRV01")} roule et sa ${link("page", "procédure")} est à jour. Ada n'a pas reçu le ${link("conversation", "rappel")} ; la ${link("post", "publication")} a 38 j'aime et le ${link("folder", "dossier du client")} a 8 éléments.`
  : `The threat ${link("threat", "Trojan.Agent")} on ACME-PC-014 is mitigated. The backup of ${link("backup", "ACME-SRV01")} runs and its ${link("page", "procedure")} is up to date. Ada did not get the ${link("conversation", "reminder")}; the ${link("post", "post")} has 38 likes and the ${link("folder", "customer's folder")} holds 8 items.`;

function Page() {
  return (
    <div className="min-h-screen bg-app p-6 text-ink">
      <div className="max-w-[44rem] text-[15px] leading-6" data-gallery-chat>
        <ChatMarkdown text={CHAT} botId="bot-gallery" draftId="bot:bot-gallery:thread-gallery" message={{ threadId: "thread-gallery", messageId: "m-1" }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><StoreProvider><Page /></StoreProvider></StrictMode>);
