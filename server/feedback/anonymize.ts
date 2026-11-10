// Feedback anonymizer (#2618, #3299): every word of a report passes here on
// the server before anything leaves it. Secrets go through the existing
// redactor (server/redact.ts, which also runs the vault's held-value
// scrubbers); this adds what a public issue must never carry: emails,
// phone numbers, the names of people, organizations, bots and computers
// this server knows, ticket numbers and the text quoted after them, ids,
// private file paths, computer names, IP addresses, client domains and
// GitHub mentions. Each is replaced by a neutral word in brackets. Message
// content outside the report never reaches it: the report is built from
// named fields only (server/feedback/report.ts).
import { redactSecretsInText } from "../redact.ts";

export interface AnonymizeNames {
  people?: readonly string[];
  orgs?: readonly string[];
  bots?: readonly string[];
  /** Computers, places and servers this server knows by name. */
  hosts?: readonly string[];
  /** Any other identifying word (an account, a mailbox name, a channel). */
  other?: readonly string[];
}

/** Hosts a report may name as they are: the product's own repository and
 * the machine itself. Anything else that looks like a domain is masked. */
const ALLOWED_HOSTS = new Set(["github.com", "api.github.com", "githubusercontent.com", "raw.githubusercontent.com", "localhost"]);

/** Top-level domains that make a dotted word a host. A file name (index.ts,
 * server.log, spans.jsonl) ends in none of them. */
const TLDS = "com|net|org|ca|io|dev|app|ai|co|us|uk|fr|de|be|ch|info|biz|cloud|tech|online|site|xyz|me|tv|eu|qc|quebec|local|lan|internal|corp|gov|edu|gouv|business|services|solutions|systems|email|team|work|cc";
const HOST = new RegExp(`\\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))\\b(?![\\w-])`, "gi");
const EMAIL = /[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/gu;
const MENTION = /(^|[^\w`])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\b/g;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const IPV6 = /(?<![\w:.])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi;
const PHONE_NA = /(?<![\w+])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)/g;
const PHONE_INTL = /(?<![\w+])\+\d{1,3}(?:[\s.-]?\(?\d+\)?){2,6}(?!\w)/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
/** A word of 12+ letters and digits mixed: a record id, a session key. */
const MIXED_ID = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{12,}\b/g;
/** The date and hour of an ISO timestamp (2026-11-07T23): a log line's time, not an id. */
const TIMESTAMP_HEAD = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
/** A path in a private place (a home folder, a mounted volume, a share):
 * its folders name people and clients, so the whole path goes. */
const POSIX_PATH = /(?:~|(?<![\w.:/\]])\/(?:Users|home|Volumes|mnt|media|srv|private|var|tmp|root|data|opt|Library|cloud|workspaces?|share|shares))(?:\/[^\s/'"`<>()[\]{},;|]+)+\/?/g;
const WIN_PATH = /(?<![\w\\])[A-Za-z]:\\(?:[^\\\s'"`<>|]+\\?)*/g;
const UNC_PATH = /\\\\[^\\\s'"`<>|]+(?:\\[^\\\s'"`<>|]*)*/g;
/** A ticket, case or request number, and the text quoted right after it. */
const TICKET = /\b(?:tickets?|billets?|cases?|cas|incidents?|demandes?|SR|INC|RITM)\s*(?:#|no\.?|n[°o]\.?|number|num[ée]ro)?\s*:?\s*#?[A-Z]{0,4}-?\d{3,}\b/giu;
const TICKET_TEXT = /\[ticket\](\s*(?:[-:]\s*)?)(?:"[^"\n]*"|«[^»\n]*»|“[^”\n]*”|'[^'\n]{3,}')/g;
const HASH_NUMBER = /(?<![\w&])#\d{5,}\b/g;
/** A computer named after its owner ("Ada's MacBook Pro", "adas-imac"). */
const OWNED_DEVICE = /(?<![\p{L}\p{N}])[\p{L}\p{N}]+(?:['’]s\s+(?:MacBook|iMac|Mac\s?mini|Mac\s?Studio|Mac\s?Pro|iPhone|iPad|PC|Laptop|Desktop|computer|ordi)|s?-(?:MacBook|iMac|Mac-?mini|Mac-?Studio|Mac-?Pro|iPhone|iPad))(?:[- ](?:Pro|Air|Max|mini|\d+))*(?:\.local)?(?![\p{L}\p{N}])/giu;
/** A server or workstation name in capitals with a dash and a digit (SRV-DC01). */
const NETBIOS = /(?<![\w-])(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9]{1,14}(?:-[A-Z0-9]{1,15})+(?![\w-])/g;
const TECH_PREFIX = /^(?:UTF|ISO|SHA|HTTP|TLS|SSL|AES|RSA|ES|GPT|MD|CVE|RFC|IPV|BASE|ECMA|H|X|WCAG|OAUTH|PKCS|EC|P|ARM|AMD|M)-/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameReplacer(names: readonly string[] | undefined, mark: string): (text: string) => string {
  const cleaned = [...new Set((names ?? []).map((name) => name.trim()).filter((name) => name.length >= 3))]
    .sort((a, b) => b.length - a.length);
  if (cleaned.length === 0) return (text) => text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${cleaned.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return (text) => text.replace(pattern, mark);
}

/** One text, safe for a public issue. */
export function anonymize(text: string, names: AnonymizeNames): string {
  if (!text) return "";
  let out = redactSecretsInText(text);
  out = out.replace(EMAIL, "[email]");
  out = out.replace(MENTION, (_m, lead: string) => `${lead}[handle]`);
  out = out.replace(UNC_PATH, "[path]").replace(WIN_PATH, "[path]").replace(POSIX_PATH, "[path]");
  out = out.replace(TICKET, "[ticket]").replace(HASH_NUMBER, "[ticket]").replace(TICKET_TEXT, "[ticket]$1[ticket text]");
  out = out.replace(OWNED_DEVICE, "[host]");
  out = out.replace(NETBIOS, (match) => (TECH_PREFIX.test(match) || match.indexOf("-") < 2 ? match : "[host]"));
  out = out.replace(UUID, "[id]");
  out = out.replace(IPV4, "[ip]");
  out = out.replace(IPV6, (match) => (match.includes("::") || match.split(":").length >= 5 ? "[ip]" : match));
  out = out.replace(PHONE_INTL, "[phone]").replace(PHONE_NA, "[phone]");
  out = out.replace(HOST, (host: string) => {
    const lower = host.toLowerCase();
    return ALLOWED_HOSTS.has(lower) || [...ALLOWED_HOSTS].some((allowed) => lower.endsWith(`.${allowed}`)) ? host : "[domain]";
  });
  out = out.replace(LONG_HEX, "[id]").replace(MIXED_ID, (match) => (match.startsWith("[") || TIMESTAMP_HEAD.test(match) ? match : "[id]"));
  out = nameReplacer(names.people, "[person]")(out);
  out = nameReplacer(names.orgs, "[org]")(out);
  out = nameReplacer(names.bots, "[bot]")(out);
  out = nameReplacer(names.hosts, "[host]")(out);
  out = nameReplacer(names.other, "[name]")(out);
  return out;
}

// Names the server does not know (#3299): a colleague, a client company, a
// contact named in a chat. A person's words and their chat requests name
// them freely, so every proper noun there goes: a capitalized word (or a
// run of them, or a word in capitals) that is neither an ordinary word
// starting a sentence nor a product or technical term below becomes
// [name]. A client named in lower case right after a word that announces
// one ("client", "chez", "company") goes too.

/** Ordinary English and French words that start a sentence with a capital. */
const COMMON_WORDS = new Set(`
a about above after aren can couldn didn doesn don hadn hasn haven isn shouldn wasn weren won wouldn todo again against all almost also although always am an and another any anyone anything anyway are around as ask at back be because been before being below best better between both but by can cannot could did do does doing done down during each either else even ever every everything few first for from further get gets getting give go goes going good got had has have having he hello help her here hey hi his how however i if in instead into is it its just last later let lets like look make many maybe me might more most much must my need never new next no none nor not nothing now of off often ok okay old on once one only open or other our out over please put quite rather really right same see she should show since so some something sometimes soon still such sure take than thank thanks that the their them then there these they thing things this those though through thus to today tomorrow too try trying under until up us use used using very want was we well were what whatever when where whether which while who why will with without would yes yesterday yet you your
add allow apply book build call cancel change check clean click close copy create delete disable do edit enable explain export fetch file find fix follow generate import install list load log merge move pick plan post print pull push read refresh reload remove rename reopen reply report reset restart retry run save schedule search select send set setup share sign start stop summarize switch sync test turn type undo update upgrade upload verify write
error warning note issue bug idea question problem expected actual steps step summary context page chat bot bots app server message request reply update version model engine tool tools routine routines task tasks feature settings profile account team group workspace window screen button menu card
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
à afin ai ainsi alors après aucun aucune aujourd'hui au aussi autre autres aux avant avec avoir bien bon bonjour bonsoir car ce ceci cela celle celui ces cet cette chaque ci comme comment dans de demain des depuis dois donc dont du elle elles en encore enfin ensuite est et était été être eu fait faut hier ici il ils j je jamais juste la le les leur leurs lui ma mais me merci même mes moi mon ne ni non nos notre nous on ou où oui par parce pas peu peut peux plus pour pourquoi pourrais pourrait puis quand que quel quelle quelles quels qui quoi rien sa salut sans se ses si son sont souvent sur ta te tes toi ton toujours tous tout toute toutes très tu un une vers voici voilà vos votre vous ça
ajoute ajouter annule appelle cherche clique corrige crée créer donne écris efface enlève envoie envoyer essaie explique ferme fais faire installe lance lis liste met mets montre ouvre partage peux-tu pouvez-vous redémarre regarde remplace renomme répare réponds résume sauvegarde supprime trouve vérifie
erreur avertissement problème idée attendu résultat étape étapes contexte page chat réglages paramètres compte équipe groupe fenêtre écran bouton tâche tâches routine outil outils modèle moteur demande billet
lundi mardi mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin juillet août septembre octobre novembre décembre
failed fail fails company companies organization organizations customer customers board boards reach reached failure cannot unable invalid unexpected unknown missing required timeout timed refused denied unauthorized forbidden found retry retrying retried connection connect connected disconnected requests response responses status rate limit limited quota exceeded internal bad gateway service unavailable overloaded provider driver session user users contact agreement site render rendered loading loaded fetch fetched parse parsing syntax type reference range uncaught unhandled promise rejection exception stack trace warn info debug fatal err get post put patch head options true false null undefined nan object array string number function cause caused reading properties property access network offline abort aborted cancelled canceled closed done started starting stopped completed complete success returned return got received sent sending permission permissions scope scopes expired revoked login logout auth authentication authorization signed client socket stream handshake certificate host port proxy redirect empty ignored skipped queued pending running blocked denied duplicate conflict gone payload body header headers value key field method path query invalid timeout
échec échoué impossible introuvable invalide inconnu inconnue manquant manquante refusé refusée délai expiré expirée
`.split(/\s+/).filter(Boolean));

/** Products, platforms and technical words a report may name as they are. */
const TECH_TERMS = new Set(`
sagax github git claude anthropic openai chatgpt gpt codex gemini grok llama mistral ollama copilot cursor vscode xcode
mac macos macbook imac ios ipados iphone ipad android windows linux ubuntu debian docker kubernetes electron chrome chromium safari firefox edge webkit node nodejs npm pnpm vite react typescript javascript python rust swift
microsoft google apple azure aws amazon slack teams outlook office excel word powerpoint onedrive sharepoint gmail calendar drive dropbox icloud zoom discord telegram whatsapp signal notion jira confluence linear trello asana figma stripe twilio
connectwise sentinelone screenconnect bookstack passportal axcient itglue hubspot salesforce quickbooks
api apis url urls uri ui ux cpu gpu ram ssd dns dhcp vpn sso mfa otp pdf csv json yaml xml html css js ts sql http https ssh ftp sftp smtp imap pop mcp llm ai ia os pc id ids sms crm psa rmm erp cli it ti usb lan wan wifi wi-fi ssl tls ip tcp udp oauth jwt saml ldap ad aad rest sdk ide qa ok faq asap fyi svp ps am pm utc est edt et pst ce cc bcc tv
utf ascii regex cron webhook webhooks token tokens oauth2 ipv4 ipv6 vm vms ec2 s3 iam rbac acl nas san raid smb nfs
`.split(/\s+/).filter(Boolean));

/** Words that announce a client or company named next, in lower case. */
const NAMES_NEXT = /(?<![\p{L}\p{N}])(client|cliente|clients|customer|customers|company|compagnie|entreprise|organisation|organization|org|chez|firme|employer|employeur|tenant|user|utilisateur|utilisatrice|contact|member|membre)(\s*:?\s+(?:(?:qui\s+)?(?:s['’]appelle|se\s+nomme|nommée?|appelée?|named|called|is|est|was|était)\s+)?)(?!\[)([\p{L}][\p{L}\p{N}&'’.-]*)/giu;

/** One capitalized word: an initial capital, then letters, digits, an
 * apostrophe or a hyphen inside (O'Neil, Jean-Pierre, D'Amours). */
const CAP_WORD = /(?<![\p{L}\p{N}_[\]./\\@#-])\p{Lu}[\p{L}\p{N}]*(?:[-'’][\p{L}\p{N}]+)*(?![\p{L}\p{N}_\]])/gu;
const ELISION = /^((?:[LDJCMNSTlcdjmnst]|Qu|qu)['’])(.+)$/u;

function isKnownWord(word: string): boolean {
  const lower = word.toLowerCase().replace(/['’](?:s|t|m|re|ve|ll|d)$/u, "");
  return COMMON_WORDS.has(lower) || TECH_TERMS.has(lower) || TECH_TERMS.has(lower.replace(/s$/, ""));
}

/** A code word of an error or a log line: a class name whose last part is
 * an ordinary word (TypeError, AbortSignal, NotFound), or an errno (ENOENT).
 * A name in camel case (McDonald, NorthWind) ends in no known word. */
function isCodeWord(word: string): boolean {
  if (/^E[A-Z]{3,}$/.test(word)) return true;
  const parts = /^\p{Lu}[\p{Ll}\p{N}]+(?:\p{Lu}[\p{Ll}\p{N}]*)+$/u.test(word) ? word.split(/(?=\p{Lu})/u) : null;
  return Boolean(parts && parts.length >= 2 && isKnownWord(parts.at(-1)!));
}

/** Masks names the server cannot know: proper nouns in free text. With
 * `technical` (an error, a log line), code words stay as they are. */
export function maskUnknownNames(text: string, options: { technical?: boolean } = {}): string {
  if (!text) return "";
  let out = text.replace(CAP_WORD, (word: string) => {
    const elided = ELISION.exec(word);
    if (elided) {
      const rest = elided[2]!;
      return /^\p{Lu}/u.test(rest) && !isKnownWord(rest) ? `${elided[1]}[name]` : word;
    }
    // a word cut by a hyphen (Jean-Pierre, Wi-Fi) is known when the whole is
    if (isKnownWord(word) || word.split(/[-'’]/).every((part) => isKnownWord(part))) return word;
    if (options.technical && isCodeWord(word)) return word;
    // a single capital letter (a list item, "A") and "I" stay
    if (word.length === 1) return word;
    // a code-like word with digits (H264, P50) stays
    if (/\d/.test(word) && !/^\p{Lu}[\p{Ll}]+$/u.test(word)) return word;
    return "[name]";
  });
  out = out.replace(NAMES_NEXT, (match: string, cue: string, gap: string, word: string) => {
    if (isKnownWord(word) || word.startsWith("[")) return match;
    return `${cue}${gap}[name]`;
  });
  // a run of names ("[name] [name]", "[name] & [name]", "[name] D'[name]") reads as one
  return out.replace(/\[name\](?:(?:\s+|\s*[&+]\s*|\s+(?:de|du|des|of|von|van|der|la|le)\s+)(?:[DdLl]['’])?\[name\])+/giu, "[name]");
}

/** A person's own words or chat request, safe for a public issue: every
 * mark of anonymize(), then the proper nouns the server does not know. */
export function anonymizeWords(text: string, names: AnonymizeNames): string {
  return maskUnknownNames(anonymize(text, names));
}

/** An error or a log line, safe for a public issue (#3299): every mark of
 * anonymize(), then the proper nouns the server does not know. An error names
 * the record it failed on as it is ("No agreement for company Northwind
 * Traders"), so the names go wherever they stand, not only between quotes;
 * the code words of the line (TypeError, ENOENT, GET) stay. */
export function anonymizeTechnical(text: string, names: AnonymizeNames): string {
  return maskUnknownNames(anonymize(text, names), { technical: true });
}

/** The last `max` lines, each anonymized (anonymizeTechnical) and cut to 400 characters. */
export function anonymizeLines(lines: readonly string[], names: AnonymizeNames, max = 40): string[] {
  return lines.slice(-max).map((line) => {
    const clean = anonymizeTechnical(String(line), names).replace(/\s+/g, " ").trim();
    return clean.length > 400 ? `${clean.slice(0, 399)}…` : clean;
  });
}

/** A failed tool's name, safe for a public issue (#3299). A connector's tool
 * carries the connector's name (mcp__<connector>__<tool>, <connector>.<tool>,
 * <connector>:<tool>), which may be a client's or a person's: that part
 * becomes [connector] unless each of its words is a known product or
 * technical word. The tool's own name stays. */
export function anonymizeToolName(name: string, names: AnonymizeNames): string {
  const known = (part: string) => part.split(/[_-]+/).filter(Boolean).every((word) => isKnownWord(word));
  const mcp = /^(mcp__)(.+?)(__.+)$/i.exec(name);
  const split = mcp ? [mcp[1]!, mcp[2]!, mcp[3]!] : (() => {
    const at = /^([^.:]+)([.:].+)$/.exec(name);
    return at ? ["", at[1]!, at[2]!] : null;
  })();
  const masked = split ? `${split[0]}${known(split[1]) ? split[1] : "[connector]"}${split[2]}` : name;
  return anonymizeTechnical(masked, names);
}
