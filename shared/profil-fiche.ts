// Prépare un profil à partir d'une fiche. La création et le dépôt des clés
// n'ont lieu que lorsque l'approbation est exactement vraie. Une clé ne
// ressort jamais dans le profil, le journal ou une erreur. Un second appel
// avec le même magasin ne dépose pas une clé déjà déposée, et le même
// registre ne crée pas deux fois le même profil.
//
// #1383: phases in profil-fiche-{types,helpers,yaml,validate}.ts

export type {
  PermissionEntite,
  BotPrepare,
  ProfilPrepare,
  ErreurFiche,
  DemandeProfil,
  ResultatProfil,
} from "./profil-fiche-types.ts";

import type { DemandeProfil, ResultatProfil } from "./profil-fiche-types.ts";
import { creerFicheHelpers } from "./profil-fiche-helpers.ts";
import { parserFicheYaml } from "./profil-fiche-yaml.ts";
import { validerFicheCorps } from "./profil-fiche-validate.ts";

const NOM_CLE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const depotsFaits = new WeakMap<object, Set<string>>();
const profilsFaits = new WeakMap<object, Set<string>>();

export function preparerProfilDepuisFiche(fiche: string, demande: DemandeProfil = {}): ResultatProfil {
  const h = creerFicheHelpers(demande);
  const { refuser, ecrire, caractereInterdit, valeurSecrete } = h;

  if (typeof fiche !== "string" || fiche.trim() === "") return refuser("fiche_vide", "La fiche est vide.");
  if (fiche.length > 32768) return refuser("fiche_trop_grande", "La fiche dépasse 32768 caractères.");
  if (caractereInterdit(fiche, true)) return refuser("fiche_interdite", "La fiche contient un caractère interdit.");
  if (valeurSecrete(fiche)) {
    return refuser(
      "secret",
      "La fiche contient un secret. Retirez-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
    );
  }

  const yaml = parserFicheYaml(fiche, h);
  if (!("kind" in yaml) || yaml.kind !== "racine") return yaml as ResultatProfil;

  const validated = validerFicheCorps(yaml.racine, h);
  if (!("kind" in validated) || validated.kind !== "profil") return validated as ResultatProfil;
  const profil = validated.profil;

  if (demande.approbation !== true) {
    ecrire("Profil préparé, création en attente.");
    return { ok: true, cree: false, profil, erreurs: [] };
  }
  if (!demande.registre) return refuser("approbation_registre", "L'approbation exige un registre de profils. Rien n'a été créé.");

  const entrees: Array<{ nom: string; valeur: string }> = [];
  if (demande.cles) {
    for (const nom of Object.keys(demande.cles)) {
      const valeur = demande.cles[nom];
      if (typeof valeur !== "string" || valeur.length === 0) {
        return refuser("cle_invalide", "Une clé est vide. Rien n'a été créé.");
      }
      if (!NOM_CLE.test(nom)) return refuser("cle_invalide", "Un nom de clé est refusé. Rien n'a été créé.");
      entrees.push({ nom, valeur });
    }
  }
  const magasin = demande.magasin;
  const dejaDeposees = magasin ? depotsFaits.get(magasin) : undefined;
  const aDeposer = dejaDeposees ? entrees.filter((entree) => !dejaDeposees.has(entree.nom)) : entrees;
  if (aDeposer.length > 0 && !magasin) {
    return refuser("approbation_magasin", "L'approbation avec des clés exige un magasin de secrets. Rien n'a été créé.");
  }
  if (aDeposer.length > 0 && magasin) {
    try {
      magasin.deposer(aDeposer);
    } catch {
      return refuser("magasin_refuse", "Le magasin de secrets a refusé le dépôt. Rien n'a été créé.");
    }
    const faits = depotsFaits.get(magasin) ?? new Set<string>();
    for (const entree of aDeposer) faits.add(entree.nom);
    depotsFaits.set(magasin, faits);
    ecrire("Clés déposées dans le magasin.");
  }
  const empreinte = JSON.stringify(profil);
  const dejaCree = profilsFaits.get(demande.registre)?.has(empreinte) === true;
  if (!dejaCree) {
    try {
      demande.registre.creer(profil);
    } catch {
      const message =
        entrees.length > 0
          ? "Le registre a refusé le profil. Les clés restent dans le magasin. Le profil n'a pas été créé."
          : "Le registre a refusé le profil. Rien n'a été créé.";
      ecrire("Le registre a refusé le profil.");
      return { ok: false, cree: false, profil: null, erreurs: [{ code: "registre_refuse", message }] };
    }
    const faits = profilsFaits.get(demande.registre) ?? new Set<string>();
    faits.add(empreinte);
    profilsFaits.set(demande.registre, faits);
    ecrire("Profil créé.");
  }
  return { ok: true, cree: true, profil, erreurs: [] };
}
