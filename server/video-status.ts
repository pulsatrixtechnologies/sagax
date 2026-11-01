// The conversation row of one make_video job: progress while xAI works, the
// stop or failure receipt when it ends without a video. The completed MP4
// replaces this row (server/index.ts publish). Worded in the person's own
// language (server/person-language.ts); English for any other choice.
import { parseWidgetInput, widgetToText, type WidgetRoot } from "../shared/widget.ts";
import type { VideoJob } from "./video-generation.ts";

type Words = {
  title: string;
  running: (progress?: number) => string;
  downloading: string;
  cancelled: string;
  failed: string;
  paused: string;
  unknown: string;
  retry: string;
  codes: Record<string, string>;
};

const EN: Words = {
  title: "Video",
  running: (progress) => progress === undefined ? "Generating with xAI…" : `Generating with xAI… ${Math.round(progress)} %`,
  downloading: "Saving the video in this conversation…",
  cancelled: "Stopped here. xAI has no cancellation, so its generation may still finish and be billed. Ask the bot to retry to fetch it.",
  failed: "The video could not be made.",
  paused: "The video is not saved yet.",
  unknown: "xAI did not confirm the request. It may still be billed; no second request was sent.",
  retry: "Ask the bot to retry: it resumes this same request without paying twice.",
  codes: {
    moderation: "xAI did not release this video after moderation.",
    expired: "xAI expired the request before the video was saved.",
    invalid_argument: "xAI refused the parameters, the image or the content.",
    permission_denied: "This xAI account cannot generate videos. Check it in Settings > Providers.",
    failed_precondition: "xAI cannot make this video with this model, mode or resolution.",
    service_unavailable: "xAI video generation is unavailable right now.",
    internal_error: "xAI failed while generating.",
    timeout: "Following the generation took too long.",
    download_failed: "The finished video could not be downloaded.",
    invalid_media: "xAI returned something that is not an MP4.",
    http_401: "xAI refused the API key. Check it in Settings > Providers.",
    http_403: "xAI refused this account. Check it in Settings > Providers.",
    http_429: "xAI's rate limit or credits are exhausted.",
  },
};

const FR: Words = {
  title: "Vidéo",
  running: (progress) => progress === undefined ? "Génération avec xAI…" : `Génération avec xAI… ${Math.round(progress)} %`,
  downloading: "Enregistrement de la vidéo dans cette conversation…",
  cancelled: "Arrêtée ici. xAI n'offre pas d'annulation : sa génération peut se terminer et être facturée. Demande au bot de réessayer pour la récupérer.",
  failed: "La vidéo n'a pas pu être créée.",
  paused: "La vidéo n'est pas encore enregistrée.",
  unknown: "xAI n'a pas confirmé la demande. Elle peut être facturée ; aucune deuxième demande n'a été envoyée.",
  retry: "Demande au bot de réessayer : il reprend cette même demande sans payer deux fois.",
  codes: {
    moderation: "xAI n'a pas publié cette vidéo après la modération.",
    expired: "xAI a expiré la demande avant que la vidéo soit enregistrée.",
    invalid_argument: "xAI a refusé les paramètres, l'image ou le contenu.",
    permission_denied: "Ce compte xAI ne peut pas générer de vidéos. Vérifie-le dans Réglages > Fournisseurs.",
    failed_precondition: "xAI ne peut pas faire cette vidéo avec ce modèle, ce mode ou cette résolution.",
    service_unavailable: "La génération vidéo de xAI est indisponible pour le moment.",
    internal_error: "xAI a échoué pendant la génération.",
    timeout: "Le suivi de la génération a pris trop de temps.",
    download_failed: "La vidéo terminée n'a pas pu être téléchargée.",
    invalid_media: "xAI a renvoyé autre chose qu'un MP4.",
    http_401: "xAI a refusé la clé API. Vérifie-la dans Réglages > Fournisseurs.",
    http_403: "xAI a refusé ce compte. Vérifie-le dans Réglages > Fournisseurs.",
    http_429: "La limite de débit ou les crédits xAI sont épuisés.",
  },
};

export function videoStatusWords(language: string | undefined): Words {
  return language?.toLowerCase().startsWith("fr") ? FR : EN;
}

/** The lines the row shows for this job's state. */
export function videoStatusLines(job: Pick<VideoJob, "status" | "progress" | "code" | "error">, language: string | undefined): string[] {
  const words = videoStatusWords(language);
  const cause = job.code ? words.codes[job.code] : undefined;
  switch (job.status) {
    case "submitting":
    case "pending": return [words.running(job.progress)];
    case "downloading": return [words.downloading];
    case "completed": return [words.downloading];
    case "cancelled": return [words.cancelled];
    case "unknown": return [words.unknown];
    case "paused": return [words.paused, cause ?? job.error ?? "", words.retry].filter(Boolean);
    case "failed": return [words.failed, cause ?? job.error ?? ""].filter(Boolean);
  }
}

/** A direct conversation draws a card with a progress bar; a room, which
 * has no widgets, gets the same words as text. */
export function videoStatusRow(job: Pick<VideoJob, "status" | "progress" | "code" | "error">, language: string | undefined): { text: string; root: WidgetRoot } {
  const words = videoStatusWords(language);
  const lines = videoStatusLines(job, language);
  const running = job.status === "pending" || job.status === "submitting" || job.status === "downloading";
  const parsed = parseWidgetInput({
    type: "Card", title: words.title,
    children: [
      ...lines.map((value) => ({ type: "Text", value })),
      ...(running ? [{ type: "Progress", value: Math.min(1, Math.max(0, (job.status === "downloading" ? 100 : job.progress ?? 0) / 100)) }] : []),
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return { text: widgetToText(parsed.value), root: parsed.value };
}
