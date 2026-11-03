// cua-driver 0.28.2 refuses browser_prepare's existing_profile strategy in
// standard mode unless its daemon was launched with --grant existing-profile
// or an authorization host, and the embedded host takes neither. The refusal
// names only those two, so a bot relays them to the person, who has no way to
// act on either. This adds, to that one refusal, what the bot can do instead.
type JsonObject = Record<string, unknown>;

export const OWN_PROFILE_UNAVAILABLE =
  "Computer control on this computer cannot attach to the person's own signed-in browser profile, and Sagax has no setting that lets them allow it, so do not retry strategy existing_profile or ask them to grant it. To work in a site they are signed in to, use the screen: launch_app with urls opens the page in their own browser, signed in as they are; read it with get_window_state and act with click, type_text and press_key. Or use your own browser tools if you have them, and ask the person to sign in there when the site needs their login.";

const REFUSAL_CODE = "browser_consent_required";

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function refusesOwnProfile(result: JsonObject): boolean {
  const structured = result.structuredContent;
  if (!isObject(structured) || !isObject(structured.refusal)) return false;
  const { code, message } = structured.refusal;
  return code === REFUSAL_CODE && typeof message === "string" && message.includes("existing-profile");
}

/** One MCP stdio frame from the local driver: only an existing-profile
 * refusal is parsed and changed, every other line passes byte for byte. */
export function localComputerResultLine(line: string): string {
  if (!line.includes(REFUSAL_CODE)) return line;
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    return line;
  }
  if (!isObject(frame) || !isObject(frame.result) || !Array.isArray(frame.result.content) || !refusesOwnProfile(frame.result)) return line;
  const content = [...frame.result.content, { type: "text", text: OWN_PROFILE_UNAVAILABLE }];
  return JSON.stringify({ ...frame, result: { ...frame.result, content } });
}
