import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { preparerProfilDepuisFiche } from "./profil-fiche.ts";

const dossier = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const fausseCle = ["fausse", "cle", "exemple", "0001"].join("-");
const exemple = readFileSync(`${dossier}/profil-fiche.exemple.yaml`, "utf8").replace(/\r\n/g, "\n");

const profilExemple = {
  version: 1 as const,
  employe: { nom: "Alex Martin", role: "soutien" },
  bots: [
    {
      nom: "Accueil",
      domaine: "Coordination du soutien",
      permissions: {
        demandes: "lecture" as const,
        reponses: "ecriture-avec-confirmation" as const,
      },
      connecteurs: ["courriel", "documents"],
      niveau_perspicax: ["organisation:lecture", "equipe:lecture", "personnel:ecriture"],
      niveau_autonomie: 0 as const,
    },
    {
      nom: "Suivi des dossiers",
      domaine: "Suivi des dossiers",
      permissions: { dossiers: "lecture" as const },
      connecteurs: [],
      niveau_perspicax: ["personnel:lecture"],
      niveau_autonomie: 0 as const,
    },
  ],
};

describe("preparerProfilDepuisFiche", () => {
  it("prépare le profil de la fiche fictive et ne crée rien", () => {
    const journal: string[] = [];
    const registre: unknown[] = [];
    const magasin: unknown[] = [];
    const resultat = preparerProfilDepuisFiche(exemple, {
      journal: { ecrire: (message) => journal.push(message) },
      registre: { creer: (profil) => registre.push(profil) },
      magasin: { deposer: (entrees) => magasin.push(entrees) },
      cles: { "connecteur-exemple": fausseCle },
    });

    expect(resultat).toEqual({ ok: true, cree: false, erreurs: [], profil: profilExemple });
    expect(registre).toEqual([]);
    expect(magasin).toEqual([]);
    expect(journal).toEqual(["Profil préparé, création en attente."]);
    expect(JSON.stringify(resultat)).not.toContain(fausseCle);
    expect(journal.join("\n")).not.toContain(fausseCle);
  });

  it("crée le profil seulement après une approbation explicite et dépose la clé dans le magasin", () => {
    const journal: string[] = [];
    const registre: unknown[] = [];
    const magasin: Array<ReadonlyArray<{ nom: string; valeur: string }>> = [];
    const resultat = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      journal: { ecrire: (message) => journal.push(message) },
      registre: { creer: (profil) => registre.push(profil) },
      magasin: { deposer: (entrees) => magasin.push(entrees) },
    });

    expect(resultat).toEqual({ ok: true, cree: true, erreurs: [], profil: profilExemple });
    expect(registre).toEqual([profilExemple]);
    expect(magasin).toEqual([[{ nom: "connecteur-exemple", valeur: fausseCle }]]);
    expect(journal).toEqual(["Clés déposées dans le magasin.", "Profil créé."]);
    expect(JSON.stringify(resultat)).not.toContain(fausseCle);
    expect(JSON.stringify(journal)).not.toContain(fausseCle);
  });

  it("ne crée rien si l'approbation n'a pas de registre ou de magasin pour les clés", () => {
    let deposeSansRegistre = false;
    const sansRegistre = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      magasin: {
        deposer: () => {
          deposeSansRegistre = true;
        },
      },
    });
    expect(sansRegistre.ok).toBe(false);
    expect(sansRegistre.cree).toBe(false);
    expect(sansRegistre.profil).toBeNull();
    expect(deposeSansRegistre).toBe(false);
    expect(sansRegistre.erreurs[0]?.message).toContain("Rien n'a été créé.");

    let depose = false;
    const sansMagasin = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      registre: { creer: () => undefined },
      magasin: {
        deposer: () => {
          depose = true;
        },
      },
    });
    expect(sansMagasin).toEqual({ ok: true, cree: true, erreurs: [], profil: profilExemple });
    expect(depose).toBe(true);

    let cree = false;
    const clesSansMagasin = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      registre: {
        creer: () => {
          cree = true;
        },
      },
    });
    expect(clesSansMagasin.ok).toBe(false);
    expect(clesSansMagasin.cree).toBe(false);
    expect(cree).toBe(false);
    expect(JSON.stringify(clesSansMagasin)).not.toContain(fausseCle);
  });

  it("refuse un domaine qui n'a pas 3 mots, une écriture sans confirmation et un niveau autre que 0", () => {
    const fiche = exemple
      .replace("Coordination du soutien", "Coordination")
      .replace("reponses: ecriture-avec-confirmation", "reponses: ecriture")
      .replace("niveau_autonomie: 0", "niveau_autonomie: 2");
    const resultat = preparerProfilDepuisFiche(fiche);
    expect(resultat.ok).toBe(false);
    expect(resultat.profil).toBeNull();
    const messages = resultat.erreurs.map((erreur) => erreur.message).join("\n");
    expect(messages).toContain("exactement 3 mots");
    expect(messages).toContain("ecriture-avec-confirmation");
    expect(messages).toContain("doit être 0");
  });

  it("refuse un niveau Perspicax inconnu, un champ inconnu et plus de 6 bots", () => {
    const niveau = preparerProfilDepuisFiche(exemple.replace("personnel:ecriture", "admin:total"));
    expect(niveau.ok).toBe(false);
    expect(niveau.erreurs.some((erreur) => erreur.message.includes("Perspicax"))).toBe(true);

    const inconnu = preparerProfilDepuisFiche(exemple.replace("secrets: aucun", "note: ne-pas-reprendre\n  secrets: aucun"));
    expect(inconnu.ok).toBe(false);
    expect(inconnu.erreurs.some((erreur) => erreur.message.includes("inconnu"))).toBe(true);
    expect(JSON.stringify(inconnu)).not.toContain("ne-pas-reprendre");

    const bots = `${exemple.split("  secrets:")[0]}    - nom: Bot 3
      domaine: "Troisieme bot fictif"
      permissions:
        demandes: lecture
      connecteurs: []
      niveau_perspicax:
        - personnel:lecture
      niveau_autonomie: 0
    - nom: Bot 4
      domaine: "Quatrieme bot fictif"
      permissions:
        demandes: lecture
      connecteurs: []
      niveau_perspicax:
        - personnel:lecture
      niveau_autonomie: 0
    - nom: Bot 5
      domaine: "Cinquieme bot fictif"
      permissions:
        demandes: lecture
      connecteurs: []
      niveau_perspicax:
        - personnel:lecture
      niveau_autonomie: 0
    - nom: Bot 6
      domaine: "Sixieme bot fictif"
      permissions:
        demandes: lecture
      connecteurs: []
      niveau_perspicax:
        - personnel:lecture
      niveau_autonomie: 0
    - nom: Bot 7
      domaine: "Septieme bot fictif"
      permissions:
        demandes: lecture
      connecteurs: []
      niveau_perspicax:
        - personnel:lecture
      niveau_autonomie: 0
  secrets: aucun
`;
    const trop = preparerProfilDepuisFiche(bots);
    expect(trop.ok).toBe(false);
    expect(trop.erreurs.some((erreur) => erreur.message.includes("6"))).toBe(true);
  });

  it("n'écrit jamais une clé dans le profil, le journal, les erreurs ou les sources", () => {
    const journal: string[] = [];
    const magasin: Array<ReadonlyArray<{ nom: string; valeur: string }>> = [];
    const ficheSale = exemple.replace(
      "secrets: aucun",
      `api_key: ${fausseCle}\n  secrets: ${fausseCle}\n  bots_nom: ${fausseCle}`,
    );
    const refuse = preparerProfilDepuisFiche(ficheSale, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      journal: { ecrire: (message) => journal.push(message) },
      registre: { creer: () => undefined },
      magasin: { deposer: (entrees) => magasin.push(entrees) },
    });
    expect(refuse.ok).toBe(false);
    expect(refuse.profil).toBeNull();
    expect(magasin).toEqual([]);
    expect(JSON.stringify(refuse)).not.toContain(fausseCle);
    expect(journal.join("\n")).not.toContain(fausseCle);

    const consoleCapture: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      consoleCapture.push(args.map((arg) => String(arg)).join(" "));
    };
    let cree = false;
    try {
      const creeApres = preparerProfilDepuisFiche(exemple, {
        approbation: true,
        cles: { "connecteur-exemple": fausseCle },
        journal: { ecrire: (message) => journal.push(message) },
        registre: {
          creer: () => {
            cree = true;
          },
        },
        magasin: {
          deposer: () => {
            throw new Error(fausseCle);
          },
        },
      });
      expect(cree).toBe(false);
      expect(JSON.stringify(creeApres)).not.toContain(fausseCle);
      expect(creeApres.erreurs[0]?.message).toContain("Rien n'a été créé.");
    } finally {
      console.log = original;
    }
    expect(consoleCapture.join("\n")).not.toContain(fausseCle);

    const jeton = "sk-" + "fausseexemple0001";
    const ficheJeton = exemple.replace("Coordination du soutien", `Coordination du ${jeton}`);
    const refuseJeton = preparerProfilDepuisFiche(ficheJeton, { approbation: true });
    expect(refuseJeton.ok).toBe(false);
    expect(refuseJeton.profil).toBeNull();
    expect(JSON.stringify(refuseJeton)).not.toContain(jeton);
    expect(JSON.stringify(refuseJeton)).not.toContain("sk-");

    const sources = [
      `${dossier}/profil-fiche.ts`,
      `${dossier}/profil-fiche-types.ts`,
      `${dossier}/profil-fiche-helpers.ts`,
      `${dossier}/profil-fiche-yaml.ts`,
      `${dossier}/profil-fiche-validate.ts`,
      `${dossier}/profil-fiche.test.ts`,
      `${dossier}/profil-fiche.exemple.yaml`,
    ];
    for (const source of sources) {
      expect(readFileSync(source, "utf8")).not.toContain(fausseCle);
      expect(readFileSync(source, "utf8")).not.toContain(jeton);
    }
    const moduleSource = readFileSync(`${dossier}/profil-fiche.ts`, "utf8");
    // #1383: facade may import only sibling phase modules under profil-fiche-*.
    for (const line of moduleSource.split("\n").filter((row) => /^import\b/.test(row))) {
      expect(line).toMatch(/from "\.\/profil-fiche-[a-z-]+\.ts";$/);
    }
    expect(moduleSource.match(/^export function [A-Za-z0-9_]+/gm)).toEqual([
      "export function preparerProfilDepuisFiche",
    ]);
    expect(moduleSource.match(/^function /gm)).toBeNull();
  });

  it("dit que les clés restent au magasin si le registre refuse après le dépôt", () => {
    const journal: string[] = [];
    const magasin: Array<ReadonlyArray<{ nom: string; valeur: string }>> = [];
    const resultat = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      journal: { ecrire: (message) => journal.push(message) },
      magasin: { deposer: (entrees) => magasin.push(entrees) },
      registre: {
        creer: () => {
          throw new Error(fausseCle);
        },
      },
    });
    expect(resultat.ok).toBe(false);
    expect(resultat.cree).toBe(false);
    expect(resultat.profil).toBeNull();
    expect(magasin).toHaveLength(1);
    expect(magasin[0]?.[0]?.nom).toBe("connecteur-exemple");
    expect(resultat.erreurs[0]?.message).toContain("magasin");
    expect(resultat.erreurs[0]?.message).not.toContain("Rien n'a été créé");
    expect(JSON.stringify(resultat)).not.toContain(fausseCle);
    expect(journal.join("\n")).not.toContain(fausseCle);
    expect(journal).toContain("Clés déposées dans le magasin.");
    expect(journal).toContain("Le registre a refusé le profil.");
  });

  it("ne dépose pas les clés une deuxième fois", () => {
    const journal: string[] = [];
    const depots: Array<ReadonlyArray<{ nom: string; valeur: string }>> = [];
    let creations = 0;
    let refus = true;
    const magasin = {
      deposer: (entrees: ReadonlyArray<{ nom: string; valeur: string }>) => {
        depots.push(entrees);
      },
    };
    const registre = {
      creer: () => {
        creations += 1;
        if (refus) {
          refus = false;
          throw new Error("refus");
        }
      },
    };
    const demande = {
      approbation: true as const,
      cles: { "connecteur-exemple": fausseCle },
      journal: { ecrire: (message: string) => journal.push(message) },
      magasin,
      registre,
    };
    const premier = preparerProfilDepuisFiche(exemple, demande);
    expect(premier.ok).toBe(false);
    expect(premier.cree).toBe(false);
    expect(depots).toHaveLength(1);
    expect(creations).toBe(1);

    const second = preparerProfilDepuisFiche(exemple, demande);
    expect(second.ok).toBe(true);
    expect(second.cree).toBe(true);
    expect(depots).toHaveLength(1);
    expect(creations).toBe(2);
    expect(journal.filter((ligne) => ligne === "Clés déposées dans le magasin.")).toHaveLength(1);

    const troisieme = preparerProfilDepuisFiche(exemple, demande);
    expect(troisieme.ok).toBe(true);
    expect(troisieme.cree).toBe(true);
    expect(depots).toHaveLength(1);
    expect(creations).toBe(2);
    expect(JSON.stringify({ premier, second, troisieme, journal })).not.toContain(fausseCle);
  });

  it("refuse une clé reconstruite par le décodage, un __proto__ et un jeton reconnaissable", () => {
    const morceaux = ["abcd", "efgh"];
    const cleReconstruite = morceaux.join("");
    const guillemets = exemple.replace("Alex Martin", `${morceaux[0]}\\${morceaux[1]}`);
    const journal: string[] = [];
    const magasin: unknown[] = [];
    let cree = false;
    const decodee = preparerProfilDepuisFiche(guillemets, {
      approbation: true,
      cles: { k: cleReconstruite },
      journal: { ecrire: (message) => journal.push(message) },
      magasin: { deposer: (entrees) => magasin.push(entrees) },
      registre: {
        creer: () => {
          cree = true;
        },
      },
    });
    expect(decodee.ok).toBe(false);
    expect(decodee.profil).toBeNull();
    expect(cree).toBe(false);
    expect(magasin).toEqual([]);
    expect(JSON.stringify(decodee)).not.toContain(cleReconstruite);
    expect(journal.join("\n")).not.toContain(cleReconstruite);

    const courte = ["sh", "ort", "ky"].join("");
    const permissionCourte = exemple.replace("demandes: lecture", `demandes: ${courte}`);
    const refuseCourte = preparerProfilDepuisFiche(permissionCourte, { cles: { k: courte } });
    expect(refuseCourte.ok).toBe(false);
    expect(JSON.stringify(refuseCourte)).not.toContain(courte);

    const ficheProto = exemple.replace(
      "    - nom: Accueil",
      `    - nom: Accueil\n      __proto__:\n        api_key: ${fausseCle}`,
    );
    const proto = preparerProfilDepuisFiche(ficheProto, {
      approbation: true,
      cles: { k: fausseCle },
      registre: { creer: () => undefined },
      magasin: { deposer: () => magasin.push("proto") },
    });
    expect(proto.ok).toBe(false);
    expect(proto.profil).toBeNull();
    expect(JSON.stringify(proto)).not.toContain(fausseCle);

    const jeton = "sgx_" + "sess_" + "a".repeat(43);
    const ficheJeton = exemple.replace("Alex Martin", jeton);
    const refuseJeton = preparerProfilDepuisFiche(ficheJeton);
    expect(refuseJeton.ok).toBe(false);
    expect(refuseJeton.profil).toBeNull();
    expect(JSON.stringify(refuseJeton)).not.toContain(jeton);

    const domaine = preparerProfilDepuisFiche(exemple.replace("Coordination du soutien", "un deux\\ntrois"));
    expect(domaine.ok).toBe(false);
    expect(domaine.profil).toBeNull();
    expect(domaine.erreurs.every((erreur) => !erreur.message.includes("\n") && !erreur.message.includes("\t"))).toBe(true);
  });

  it("lit une liste sur la même ligne que le tiret et ne double pas le nom manquant", () => {
    const premiere = exemple.replace(
      "    - nom: Accueil\n      domaine:",
      "    - connecteurs: [courriel, documents]\n      nom: Accueil\n      domaine:",
    ).replace("      connecteurs: [courriel, documents]\n", "");
    const liste = preparerProfilDepuisFiche(premiere);
    expect(liste.ok).toBe(true);
    if (liste.ok) expect(liste.profil.bots[0]?.connecteurs).toEqual(["courriel", "documents"]);

    const sansNom = exemple.replace('    nom: "Alex Martin"\n', "");
    const manque = preparerProfilDepuisFiche(sansNom);
    expect(manque.ok).toBe(false);
    expect(manque.erreurs.filter((erreur) => erreur.message.includes("besoin d'un nom"))).toHaveLength(1);
  });

  it("crée quand même le profil si le journal échoue après le dépôt", () => {
    let cree = false;
    const resultat = preparerProfilDepuisFiche(exemple, {
      approbation: true,
      cles: { "connecteur-exemple": fausseCle },
      journal: {
        ecrire: () => {
          throw new Error(fausseCle);
        },
      },
      magasin: { deposer: () => undefined },
      registre: {
        creer: () => {
          cree = true;
        },
      },
    });
    expect(cree).toBe(true);
    expect(resultat.ok).toBe(true);
    expect(resultat.cree).toBe(true);
    expect(JSON.stringify(resultat)).not.toContain(fausseCle);
  });

  it("ne jette pas sur une valeur imbriquée et ne laisse pas passer un secret déguisé", () => {
    const imbriquee = exemple.replace("        - personnel:ecriture", "        - organisation: lecture");
    expect(() => preparerProfilDepuisFiche(imbriquee)).not.toThrow();
    const illisible = preparerProfilDepuisFiche(imbriquee);
    expect(illisible.ok).toBe(false);
    expect(illisible.erreurs.some((erreur) => erreur.message.includes("illisible"))).toBe(true);

    const courte = ["sh", "ort", "ky"].join("");
    const dansLeNom = preparerProfilDepuisFiche(exemple.replace("nom: Accueil", `nom: x${courte}`), {
      approbation: true,
      cles: { k: courte },
      registre: { creer: () => undefined },
      magasin: { deposer: () => undefined },
    });
    expect(dansLeNom.ok).toBe(false);
    expect(dansLeNom.profil).toBeNull();
    expect(JSON.stringify(dansLeNom)).not.toContain(courte);

    const nombre = ["1234", "567"].join("");
    const chiffre = preparerProfilDepuisFiche(exemple.replace("reponses: ecriture-avec-confirmation", `reponses: ${nombre}`), {
      cles: { k: nombre },
    });
    expect(chiffre.ok).toBe(false);
    expect(JSON.stringify(chiffre)).not.toContain(nombre);

    const majuscule = "SGX_" + "a".repeat(20);
    const refuseMaj = preparerProfilDepuisFiche(exemple.replace("Alex Martin", majuscule));
    expect(refuseMaj.ok).toBe(false);
    expect(JSON.stringify(refuseMaj)).not.toContain(majuscule);

    const mot = ["s3cret", "pass"].join("-");
    const commente = preparerProfilDepuisFiche(`# https://alice:${mot}@example.test/x\n${exemple}`, { approbation: true });
    expect(commente.ok).toBe(false);
    expect(commente.profil).toBeNull();
    expect(JSON.stringify(commente)).not.toContain(mot);
  });
});
