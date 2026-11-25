// The sentences an image generation gives a person when it cannot happen,
// in the person's language (#5223, expected 5). The reason is computed
// server-side (`code`: credits, a refused credential, the network); the
// words come from the app's locale catalogs through the server's one way of
// saying a line (server/people/person-words.ts), so the chat's image and
// the avatar say the same thing and neither keeps English of its own.
import { personWord, type PersonLanguage } from "../people/person-words.ts";

export type ImageLanguage = PersonLanguage;

export type ImageWord =
  | "genTimeout" | "editTimeout" | "genUnreachable" | "editUnreachable"
  | "credits" | "accountRefused" | "keyRefused" | "genFailed" | "editFailed"
  | "noImage" | "needsBase64" | "invalidData" | "tooLarge" | "unreadable"
  | "noProvider" | "notSaved" | "noOwner"
  | "avatarRealPerson" | "avatarNeedsOpenai" | "avatarNeedsXai" | "avatarNeedsCustom"
  | "avatarTimeout" | "avatarTooLarge" | "avatarUnreadable" | "avatarInvalidResponse"
  | "avatarNeedsBase64" | "avatarInvalidData" | "avatarOversized";

/** One image sentence in this language. A caller that knows no person (a
 * test, a direct call) reads English, the catalog's source. */
export function imageWord(language: ImageLanguage | undefined, word: ImageWord, vars?: Readonly<Record<string, string | number>>): string {
  return personWord(language ?? "en", `image.error.${word}`, vars);
}
