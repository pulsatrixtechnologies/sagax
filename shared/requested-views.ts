// Views in the chat only on request (JC 2026-10-20: « je veux pas de widget
// qui pop dans le chat pour aucune raison ; ça doit fitter avec ce qu'on
// demande »). One rule for every client: a view (a ConnectWise widget, a
// video player, a settled screenshot) that a TOOL RESULT would add on its
// own appears only when the person's message of that turn asked for that
// kind of view. Views the bot writes itself (```chart, ```csv, ```widget,
// ```cw, show_widget) follow the same rule through the system prompt
// (RICH_OUTPUT_PROMPT, WIDGET_PROMPT). Approval cards, connection cards and
// attachments the person asked for are not views and are never held back.
//
// The server applies it when a row is created (server/index.ts) and marks
// the rows it lets through `requested: true`; clients draw a video or screen
// row only with that mark, so rows stored before this rule stay hidden.

export type RequestedView = "view" | "video" | "screen";

const ASKS: Record<RequestedView, RegExp> = {
  // an interactive view, a widget, a chart, a diagram, a card, a dashboard,
  // a small tool. A plain "table" / "en tableau" is a Markdown table, not a view.
  view: /\b(?:widgets?|vues? interactives?|interactive (?:views?|tables?|cards?|charts?|lists?)|tableaux? interactifs?|listes? interactives?|cartes? interactives?|charts?|graphiques?|graphe?s? (?:of|des?|du)|diagrams?|diagrammes?|visuali[sz](?:e|er|ez|ation|ations)|dashboards?|tableaux? de bord|plots?|sous forme de (?:carte|graphique|widget|vue)|(?:as|in) (?:a )?(?:card|widget|chart|view)|calculat(?:or|rice)|simulat(?:or|eur))\b/iu,
  // a video, a stream, a recording to watch (not "regarde le billet")
  video: /\b(?:vid[ée]os?|videos?|clips?|streams?|livestreams?|diffusions?|recordings?|enregistrements? vid[ée]o|lecteur vid[ée]o|video player)\b/iu,
  // the computer's screen
  screen: /\b(?:screenshots?|screen ?shots?|captures? (?:d['’]|de l['’]|du |de )?[ée]cran|(?:prends?|prenez|fais|faites) une capture|take a capture|capture (?:it|the screen|l['’]?[ée]cran)|(?:montre|affiche|show)[- ](?:moi |me )?(?:l['’]|the |ton |your |my |mon )?(?:[ée]cran|screen)|what(?:'s| is| does)? (?:on )?(?:the |my |your )?screen|(?:voir|see) (?:l['’]|the |ton |your )?(?:[ée]cran|screen))\b/iu,
};

/** True when the person's message asks for that kind of view. */
export function askedForView(text: string | undefined | null, kind: RequestedView): boolean {
  if (!text) return false;
  return ASKS[kind].test(text.normalize("NFC"));
}
