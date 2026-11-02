// A question that asks for permission (#1819, #1905): "May I continue?",
// "Should I contact the verifier?", "Go ahead with the merge?", "Puis-je
// envoyer le message?". Under Full access the person already answered it
// (server/full-access-gate.ts), so the recommended option, which the model
// is told to put first, is taken without a card. A real product decision
// ("Which client is this for?") and a missing fact only the person can
// supply (a password, an account) are never read as permission.
//
// Pure and shared: the server answers with it; a client may show why a
// card was settled. English and French, the two languages of the prompt.

export interface ChoiceQuestion {
  title?: string;
  question: string;
  options: readonly string[];
}

/** "May I", "can I", "should we", "shall I", "puis-je", "dois-je", "est-ce
 * que je peux"... the question is about the bot's own next step. */
const ASKS_TO_ACT = [
  /\b(?:may|can|could|shall|should|must|do)\s+(?:i|we)\b/i,
  /\b(?:do|would|did)\s+you\s+(?:want|like|wish|prefer)\s+(?:me|us)\s+to\b/i,
  /\b(?:want|like)\s+me\s+to\b/i,
  /\b(?:is|would)\s+it\s+(?:ok|okay|fine|all\s+right|alright)\b/i,
  /\b(?:puis-je|peux-je|pourrais-je|dois-je|devrais-je|devrait-on|doit-on|peut-on|pourrait-on)\b/i,
  /\best-ce\s+que\s+(?:je|j'|on|nous)\s+(?:peux|peut|pouvons|dois|doit|devons|devrais|pourrais|pourrait)\b/i,
  /\b(?:veux-tu|voulez-vous|souhaites-tu|souhaitez-vous|aimerais-tu|aimeriez-vous)\s+que\s+(?:je|j'|on|nous)\b/i,
  /\b(?:est-ce\s+que\s+)?(?:tu\s+veux|vous\s+voulez|tu\s+souhaites|vous\s+souhaitez)\s+que\s+(?:je|j'|on|nous)\b/i,
];

/** The words of a permission or a confirmation, in the title or the question. */
const PERMISSION_WORDS = [
  /\b(?:permission|approval|approve|approved|authori[sz]e|authori[sz]ation|authori[sz]ed|confirm|confirmation|confirmed|consent|green\s+light|go[- ]ahead|sign[- ]off|clearance|blessing)\b/i,
  /\b(?:proceed|continue|carry\s+on|move\s+(?:ahead|forward)|get\s+started|kick\s+off)\b/i,
  /\b(?:permission|approbation|approuver|approuv[eé]e?s?|autoriser|autorisation|autoris[eé]e?s?|confirmer|confirmation|confirm[eé]e?s?|consentement|feu\s+vert|accord)\b/i,
  /\b(?:proc[eé]der|poursuivre|continuer|enchaîner|enchainer|aller\s+de\s+l'avant|d[eé]marrer|lancer)\b/i,
  /\b(?:ton|votre)\s+go\b/i,
];

/** The answers of a confirmation: a yes and a no, a go and a wait. */
const AFFIRMATIVE = /^(?:yes|yep|yeah|ok|okay|sure|go|go\s+ahead|go\s+for\s+it|proceed|continue|do\s+it|allow|approve|approved|confirm|confirmed|accept|agreed|send(?:\s+it)?|ship\s+it|merge(?:\s+it)?|start|run(?:\s+it)?|apply|contact|oui|ouais|ok|d'accord|vas-y|allez-y|go|proc[eé]de[rz]?|continue[rz]?|poursui[sz]|fais-le|faites-le|envoie[rz]?|lance[rz]?|approuv[eé]r?|confirm[eé]r?|accepte[rz]?)\b/i;
const NEGATIVE = /^(?:no|nope|not\s+(?:now|yet)|hold(?:\s+off)?|wait|skip|cancel|stop|deny|decline|refuse|don'?t|do\s+not|later|never\s+mind|pause|non|pas\s+(?:maintenant|encore|tout\s+de\s+suite)|attends|attendez|annule[rz]?|arr[eê]te[rz]?|refuse[rz]?|plus\s+tard|laisse\s+tomber|laissez\s+tomber|saute[rz]?|ignore[rz]?)\b/i;

/** A fact only the person can supply: never answered for them. */
const ASKS_FOR_INPUT = [
  /\b(?:password|passcode|passphrase|pin\b|token|api\s*key|secret|credential|2fa|mfa|otp|one[- ]time\s+code|verification\s+code|enter\s+(?:the|your)|paste|type\s+(?:the|your|in))\b/i,
  /\b(?:what(?:'s|\s+is)|which|who|where|when|how\s+(?:many|much))\b/i,
  /\b(?:mot\s+de\s+passe|jeton|cl[eé]\s+api|secret|identifiant|code\s+(?:de\s+v[eé]rification|unique|2fa)|saisis(?:sez)?|colle[rz]?|entre[rz]?\s+(?:le|la|ton|votre))\b/i,
  /\b(?:quel(?:le)?s?|lequel|laquelle|lesquel(?:le)?s|qui|o[uù]|quand|combien|comment)\b/i,
];

function tidy(option: string): string {
  return option.trim().replace(/^[\s"'“”«»\-:*•·]+/, "").replace(/[\s.!"'”»]+$/, "");
}

function hasAffirmative(options: readonly string[]): boolean {
  return options.map(tidy).some((option) => AFFIRMATIVE.test(option));
}

function hasNegative(options: readonly string[]): boolean {
  return options.map(tidy).some((option) => NEGATIVE.test(option));
}

/** Whether this choice asks the person for permission or a confirmation of
 * the bot's own next step, rather than for a decision or a fact of theirs. */
export function permissionQuestion(input: ChoiceQuestion): boolean {
  const text = `${input.title ?? ""}\n${input.question}`.trim();
  if (!text || !Array.isArray(input.options) || input.options.length < 2) return false;
  const asksToAct = ASKS_TO_ACT.some((pattern) => pattern.test(text));
  const permissionWords = PERMISSION_WORDS.some((pattern) => pattern.test(text));
  const declinable = hasNegative(input.options);
  const yesNo = declinable && hasAffirmative(input.options);
  // "Which account should I use?", "What is the password?": a fact or a
  // choice of theirs, even when the phrasing asks to act.
  if (ASKS_FOR_INPUT.some((pattern) => pattern.test(text)) && !yesNo) return false;
  if (permissionWords && (asksToAct || yesNo || /\?\s*$/.test(input.question.trim()))) return true;
  // "Shall I open it?" with a way to say no: the step is the bot's, the
  // answer a permission. "Should I use A or B?" with no such answer is a
  // choice of theirs.
  if (asksToAct && declinable) return true;
  // Two answers, a yes and a no: a confirmation by its shape alone.
  return yesNo && input.options.length === 2;
}

/** The answer Full access gives: the recommended option, which the model is
 * told to put first. Null when the question is not a permission one. */
export function recommendedPermissionAnswer(input: ChoiceQuestion): string | null {
  if (!permissionQuestion(input)) return null;
  const first = input.options[0];
  return typeof first === "string" && first.trim() ? first : null;
}
