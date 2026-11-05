// Helpers partagés pour preparerProfilDepuisFiche (#1383).

import type { DemandeProfil, ErreurFiche, ResultatProfil } from "./profil-fiche-types.ts";

const FORME_CLE = /(?:sk-|xai-|csk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[abposr]-|AKIA|AIza|om[dg]_|gsk_|hf_|npm_|sgx_|whsec_|omb_|eyJ[A-Za-z0-9_-]{8,}\.)[A-Za-z0-9._~+/=-]{8,}/i;
const URL_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const SECRET_CLE = /(?:^|[_-])(?:api[_-]?key|apikey|password|passwd|token|authorization|access[_-]?key|private[_-]?key|jeton|mot[_-]?de[_-]?passe|secret)$/i;

export { FORME_CLE, URL_USERINFO, SECRET_CLE };

export type FicheHelpers = {
  erreurs: ErreurFiche[];
  sensibles: string[];
  exactes: string[];
  nettoyer: (message: string) => string;
  ecrire: (message: string) => void;
  refuser: (code: string, message: string) => ResultatProfil;
  caractereInterdit: (texte: string, autoriseSaut: boolean) => boolean;
  valeurSecrete: (texte: string) => boolean;
  affiche: (valeur: unknown) => string;
};

export function creerFicheHelpers(demande: DemandeProfil): FicheHelpers {
  const erreurs: ErreurFiche[] = [];
  const sensibles: string[] = [];
  const exactes: string[] = [];
  if (demande.cles) {
    for (const valeur of Object.values(demande.cles)) {
      if (typeof valeur === "string" && valeur.length > 0) {
        exactes.push(valeur);
        if (valeur.length >= 4) sensibles.push(valeur);
      }
    }
  }
  sensibles.sort((a, b) => b.length - a.length);

const nettoyer = (message: string): string => {
  let propre = message;
  for (const secret of sensibles) {
    if (propre.includes(secret)) propre = propre.split(secret).join("valeur retirée");
  }
  while (FORME_CLE.test(propre)) propre = propre.replace(FORME_CLE, "valeur retirée");
  return propre;
};

const ecrire = (message: string) => {
  try {
    demande.journal?.ecrire(nettoyer(message));
  } catch {
    // Le journal ne bloque pas la création et son exception n'est pas recopiée.
  }
};

const refuser = (code: string, message: string): ResultatProfil => {
  ecrire("Fiche refusée.");
  return { ok: false, cree: false, profil: null, erreurs: [{ code, message: nettoyer(message) }] };
};

const caractereInterdit = (texte: string, autoriseSaut: boolean): boolean => {
  if (/\p{Cf}/u.test(texte)) return true;
  for (let i = 0; i < texte.length; i++) {
    const code = texte.charCodeAt(i);
    if (autoriseSaut && (code === 0x0a || code === 0x0d)) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
};

const valeurSecrete = (texte: string): boolean => {
  if (FORME_CLE.test(texte) || URL_USERINFO.test(texte)) return true;
  const basse = texte.toLowerCase();
  if (basse.includes("-----begin ") && basse.includes("private key-----")) return true;
  if (/bearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(texte)) return true;
  for (const candidat of exactes) if (texte === candidat) return true;
  for (const candidat of sensibles) if (texte.includes(candidat)) return true;
  return false;
};

const affiche = (valeur: unknown): string =>
  typeof valeur === "string" || typeof valeur === "number" ? String(valeur) : "illisible";

  return { erreurs, sensibles, exactes, nettoyer, ecrire, refuser, caractereInterdit, valeurSecrete, affiche };
}
