import { describe, expect, it } from "vitest";
import { cleanReplyStyle } from "./reply-style.ts";

// QA c1 D6 (#2580): what a bot report must never show.
describe("cleanReplyStyle", () => {
  it("drops a signature emoji at the end of a report", () => {
    expect(cleanReplyStyle("Rapport du jour\n\n- 3 billets fermés\n- 1 en attente\n\nBonne fin de journée ❤️")).toBe("Rapport du jour\n\n- 3 billets fermés\n- 1 en attente\n\nBonne fin de journée");
    expect(cleanReplyStyle("Tout est à jour.\n🖤")).toBe("Tout est à jour.");
  });

  it("drops heart emoji inside a multi-line report", () => {
    expect(cleanReplyStyle("Résumé 🖤\n- billet #12 fermé")).toBe("Résumé\n- billet #12 fermé");
  });

  it("keeps a reply that is only an emoji, and a one-liner's non-heart emoji", () => {
    expect(cleanReplyStyle("👍")).toBe("👍");
    expect(cleanReplyStyle("Le build passe ✅ partout")).toBe("Le build passe ✅ partout");
  });

  it("names a raw ConnectWise ticket link by its number", () => {
    const url = "https://na.myconnectwise.net/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=297048&companyName=acme";
    expect(cleanReplyStyle(`Source : ${url}`)).toBe("Source : billet #297048");
    expect(cleanReplyStyle(`Billet #297048 (${url})`)).toBe("Billet #297048");
    expect(cleanReplyStyle(`Voir [le billet](${url}).`)).toBe(`Voir [le billet](${url}).`);
  });

  it("never shows a UUID or a hex id prefix", () => {
    expect(cleanReplyStyle("Carte c16f208c en attente de ta réponse.")).toBe("Carte en attente de ta réponse.");
    expect(cleanReplyStyle("Fil 1eff15cf-5d16-4e6f-942b-d4d6c4e03bc9 terminé.")).toBe("Fil terminé.");
    expect(cleanReplyStyle("Agent (a8c8b33e-e843-447e-b7e9-a17037c30c36) prêt.")).toBe("Agent prêt.");
  });

  it("leaves code, inline code and ordinary words alone", () => {
    const code = "```\nid = 1eff15cf-5d16-4e6f-942b-d4d6c4e03bc9 ❤️\n```";
    expect(cleanReplyStyle(`Voici :\n${code}`)).toBe(`Voici :\n${code}`);
    expect(cleanReplyStyle("L'id est `c16f208c`.")).toBe("L'id est `c16f208c`.");
    expect(cleanReplyStyle("Carte deadbeef? non, carte cafe et facture 2026")).toBe("Carte deadbeef? non, carte cafe et facture 2026");
  });
});
