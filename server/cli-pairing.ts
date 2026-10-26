// What `openmausbot serve` and `openmausbot pair` print for a pairing code. A
// browser on this computer is no longer the owner just by being here (port of
// OpenMausBot #2930), so it signs in once with the link printed for it.
import qrcode from "qrcode-terminal";

/** The pairing link a device opens, rendered as text and a QR code.
 *
 * One window has two links. `url` opens the web app and is what a browser and
 * the iOS app read. `inviteUrl` is the sagax:// scheme the native
 * companion scanners accept, and it is the ONLY thing an Android app can
 * scan — its parser rejects any https QR outright. Which one becomes the QR
 * therefore depends on which app is about to scan it; the other is still
 * printed as text so neither route is hidden. */
export function pairingBlock(input: {
  code: string;
  url: string | null;
  inviteUrl?: string | null;
  /** Signs in a browser on this computer: browsers get no loopback trust. */
  localUrl?: string | null;
  expiresAt: number;
  hint?: string | null;
  phone?: "ios" | "android";
}): string {
  const lines = [`pairing code:  ${input.code}`, `expires:       ${new Date(input.expiresAt).toLocaleTimeString()} (single use)`];
  if (input.localUrl) lines.push(`this computer: ${input.localUrl}`);
  if (!input.url && !input.inviteUrl) {
    lines.push(`open:          /pair on the address you use for this server, and type the code`);
    if (input.hint) lines.push(`               (${input.hint})`);
    return lines.join("\n");
  }
  // One QR, and it belongs to whichever app is about to scan it. Android's
  // scanner rejects an https payload outright, so an Android phone gets the
  // app-scheme invite; everyone else gets the web link, which Camera opens
  // and which the iOS app also accepts.
  const scanInvite = input.phone === "android" && !!input.inviteUrl;
  // Print every link this window has, and label them by what the QR below
  // actually encodes: "scan" belongs only to the link it is a picture of. A
  // link that is named but never shown is worse than one that is absent —
  // the iOS app takes a pasted invite, so the text form is the fallback when
  // a QR cannot be scanned off a terminal.
  if (input.url) lines.push(scanInvite ? `web browser:   ${input.url}` : `open or scan:  ${input.url}`);
  if (input.inviteUrl) lines.push(`phone app:     ${input.inviteUrl}`);
  const target = scanInvite ? input.inviteUrl! : input.url;
  if (target) {
    lines.push("");
    lines.push(qrToString(target));
    lines.push("");
    if (scanInvite) {
      lines.push(`Scan that in the Sagax app. For a browser instead, open the web`);
      lines.push(`address above and type the code.`);
    } else if (input.phone === "android") {
      // Android asked for an app invite this server cannot build. Say so,
      // rather than leave a QR its scanner will reject under instructions
      // telling someone to scan it.
      lines.push(`That QR opens the web app. The Android app needs the phone-app link,`);
      lines.push(`which this server cannot build without a public address: set`);
      lines.push(`SAGAX_PUBLIC_URL, or open the web address above and type the code.`);
    } else if (input.inviteUrl) {
      lines.push(`Scan that with Camera for the browser, or paste the phone-app link`);
      lines.push(`above into the Sagax app.`);
    }
  }
  return lines.join("\n");
}

export function qrToString(text: string): string {
  let out = "";
  qrcode.generate(text, { small: true }, (rendered: string) => {
    out = rendered;
  });
  return out;
}

/** The guided start's one sign-in, for the browser it opens on this computer. */
export function browserSignInLines(localUrl: string, code: string, expiresAt: number): string {
  return [
    "Sign in from a browser on this computer with this link (single use, until",
    `${new Date(expiresAt).toLocaleTimeString()}): ${localUrl}`,
    `or type the code ${code} on the sign-in page. Later: openmausbot pair`,
  ].join("\n");
}
