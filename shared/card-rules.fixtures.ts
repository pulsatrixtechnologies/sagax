// #4490: the two badly made cards the owner was shown, rebuilt with
// invented words (the public repository carries no real card text), and the
// well formed calls that replace them. Used by the server's refusal tests,
// the renderer's DOM tests and the gallery captures.

/** A time-entry routine's card: one block of text asking seven things at
 * once, with nothing to click. */
export const BAD_TIME_CARD = {
  title: "Tonight's time entries",
  question: [
    "I drafted tonight's entries from your calendar and inbox. For each line, tell me what to do:",
    "1. Standup with the acme team, 9:00 to 9:15: done, not done or move to tomorrow?",
    "2. Design review with Ada, 10:00: it has no end time. How long did it last?",
    "3. Call about the Nimbus migration: which ticket does it go on, and for how long?",
    "4. Taxi receipt from Tuesday: which expense code?",
    "5. Weekly summary email: does it count as billable, and for how long?",
    "6. Lunch and learn: done or not done?",
    "7. Backup check: move to Friday?",
    "Reply with one line per item.",
  ].join("\n"),
  options: ["Done", "Later"],
} as const;

/** The same card as one form: a row per line, each with its own control. */
export const GOOD_TIME_CARD = {
  title: "Time entries to confirm (routine Evening timesheet)",
  question: "Seven entries drafted from today's calendar. Confirm each one.",
  questions: [
    { question: "Standup with the acme team, 9:00 to 9:15", header: "Standup", kind: "choice", options: ["Done", "Not done", "Move to tomorrow"] },
    { question: "Design review with Ada, 10:00: how long did it last?", header: "Design review", kind: "duration" },
    { question: "Nimbus migration call: which ticket?", header: "Ticket", kind: "text" },
    { question: "Nimbus migration call: how long?", header: "Call length", kind: "duration" },
    { question: "Taxi receipt from Tuesday: expense code", header: "Expense code", kind: "choice", options: ["Travel", "Meals", "Office"] },
    { question: "Weekly summary email: billable?", header: "Summary", kind: "yes_no" },
    { question: "Backup check: move to Friday?", header: "Backup check", kind: "yes_no", optional: true },
  ],
} as const;

/** A drafts card: six drafts listed as plain text, the actions named in a
 * sentence, no checkbox and no button. */
export const BAD_DRAFTS_CARD = {
  title: "Posts for tonight",
  question: [
    "Six drafts are ready for tonight:",
    "1. Release notes for Nimbus 2.4, with the three fixes",
    "2. Thread about the acme meetup next week",
    "3. Reply to the question about offline mode",
    "4. Short clip of the new sidebar",
    "5. Thank-you post for the beta testers",
    "6. Reminder about Friday's maintenance window",
    "All checked. Post selected sends them. Skip tonight sends nothing.",
  ].join("\n"),
  options: ["OK", "Not now"],
} as const;

/** The same card as a checklist: one row per draft with its own checkbox,
 * pre-checked as the bot proposes, and the two actions as buttons. */
export const GOOD_DRAFTS_CARD = {
  title: "Posts to publish tonight (routine Evening posts)",
  question: "Six drafts are ready. Uncheck any you do not want posted.",
  items: [
    { label: "Release notes for Nimbus 2.4", detail: "Nimbus 2.4 is out: faster sync, a calmer sidebar and three fixes from your reports. Thanks for every bug you sent us." },
    { label: "Thread about the acme meetup", detail: "Next Thursday we are at the acme meetup. Come say hi, we will demo the offline mode and bring stickers." },
    { label: "Reply about offline mode", detail: "Yes: offline mode keeps your last 30 days and syncs when you are back online." },
    { label: "Clip of the new sidebar", detail: "Fifteen seconds of the new sidebar: drag to reorder, pin what matters.", checked: false },
    { label: "Thank-you post for beta testers", detail: "Two hundred of you tested 2.4 before anyone else. Thank you, it shows." },
    { label: "Maintenance reminder", detail: "Friday 22:00 to 23:00, sync pauses for an upgrade. Nothing to do on your side." },
  ],
  actions: ["Post selected", "Skip tonight"],
} as const;

/** #4490 review: inputs probed against the heuristics. Each must be kept:
 * a list that is context, past-tense "checked", quoted text, labels that
 * repeat the card's own options. */
export const PROBED_GOOD: readonly { question: string; options: readonly string[] }[] = [
  { question: "I checked the following:\n- disk\n- memory\n- network\nRestart?", options: ["Restart", "Wait"] },
  { question: "The selected backup holds:\n- the mail database\n- the shared drive\n- the CRM export\nRestore it now?", options: ["Restore", "Wait"] },
  { question: "J'ai coché ces étapes :\n- sauvegarde\n- mise à jour\n- redémarrage\nJe ferme le billet ?", options: ["Fermer", "Attendre"] },
  { question: "Blog posts: three drafts are ready for review. Social posts: two are scheduled for Friday. Publish the blog drafts now?", options: ["Publish", "Wait"] },
  { question: "Marketing posts on Monday. Sales sends the weekly report on Friday. Keep this schedule?", options: ["Keep", "Change"] },
  { question: "Ada's ticket says: \"Is the server down? Why is mail so slow? When will it be fixed?\" Reply with the outage notice?", options: ["Send notice", "Hold"] },
  { question: "The deploy failed twice. What now?\n- Retry the deploy?\n- Roll back?", options: ["Retry the deploy", "Roll back"] },
  { question: "I ran the check for each server: web, db, cache. All green. Deploy now?", options: ["Deploy", "Wait"] },
  { question: "Pour chaque client : A, B et C, la facture est prête. On envoie ?", options: ["Envoyer", "Attendre"] },
  { question: "Release notes sends at 9. Weekly digest posts at noon. Keep the schedule?", options: ["Keep", "Change"] },
];

/** #4490 review: inputs probed against the heuristics that must be refused. */
export const PROBED_BAD: readonly { question: string; options: readonly string[]; rule: string }[] = [
  { question: "For each line say done, not done or move: standup, review, lunch, receipt, summary, call.", options: ["Done", "Not done", "Move"], rule: "several-questions" },
  { question: "Standup done or move; review how long; receipt which code; summary billable or not", options: ["OK", "Later"], rule: "several-questions" },
  { question: "Pour chaque billet, dis-moi : fait, pas fait ou à déplacer : standup, revue, reçu.", options: ["Fait", "Pas fait", "Déplacer"], rule: "several-questions" },
];
