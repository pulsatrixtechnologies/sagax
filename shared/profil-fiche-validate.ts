// Valide le corps fiche_de_besoins et construit le profil (#1383).

import type { BotPrepare, PermissionEntite, ProfilPrepare, ResultatProfil } from "./profil-fiche-types.ts";
import type { FicheHelpers } from "./profil-fiche-helpers.ts";
import type { Noeud } from "./profil-fiche-yaml.ts";

const ID_SIMPLE = /^[a-z][a-z0-9-]{0,40}$/;
const NIVEAU = /^(organisation|equipe|personnel):(lecture|proposition|ecriture)$/;
const SECRET_CLE = /(?:^|[_-])(?:api[_-]?key|apikey|password|passwd|token|authorization|access[_-]?key|private[_-]?key|jeton|mot[_-]?de[_-]?passe|secret)$/i;

export type ValidateOk = { kind: "profil"; profil: ProfilPrepare };
export type ValidateResult = ResultatProfil | ValidateOk;

export function validerFicheCorps(racine: { [cle: string]: Noeud }, h: FicheHelpers): ValidateResult {
  const { erreurs, nettoyer, ecrire, refuser, affiche, caractereInterdit, valeurSecrete } = h;
const clesRacine = Object.keys(racine);
if (clesRacine.length !== 1 || clesRacine[0] !== "fiche_de_besoins") {
  return refuser("fiche_racine", "La fiche doit commencer par fiche_de_besoins.");
}
const corps = racine.fiche_de_besoins;
if (corps === undefined || typeof corps !== "object" || Array.isArray(corps)) {
  return refuser("fiche_racine", "La fiche doit commencer par fiche_de_besoins.");
}

const visite: Noeud[] = [corps];
while (visite.length > 0) {
  const noeud = visite.pop();
  if (noeud === undefined || typeof noeud === "string" || typeof noeud === "number") continue;
  if (Array.isArray(noeud)) {
    for (const element of noeud) visite.push(element);
    continue;
  }
  for (const cle of Object.keys(noeud)) {
    if (caractereInterdit(cle, false)) return refuser("fiche_interdite", "La fiche contient un caractère interdit.");
    if (cle !== "secrets" && (SECRET_CLE.test(cle) || valeurSecrete(cle))) {
      return refuser(
        "secret",
        "La fiche contient un secret. Retire-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
      );
    }
    const valeur = noeud[cle];
    if (typeof valeur === "string" || typeof valeur === "number") {
      const texte = String(valeur);
      if (caractereInterdit(texte, false) || valeurSecrete(texte)) {
        return refuser(
          caractereInterdit(texte, false) ? "fiche_interdite" : "secret",
          caractereInterdit(texte, false)
            ? "La fiche contient un caractère interdit."
            : "La fiche contient un secret. Retire-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
        );
      }
    }
    if (valeur !== undefined && typeof valeur !== "string" && typeof valeur !== "number") visite.push(valeur);
  }
}

const champsCorps = ["version", "employe", "bots", "secrets"];
for (const cle of Object.keys(corps)) {
  if (!champsCorps.includes(cle)) {
    erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
  }
}
if (corps.version !== 1) erreurs.push({ code: "version", message: "Le champ version doit être 1." });
if (corps.secrets !== "aucun") {
  erreurs.push({
    code: "secrets_declaration",
    message: corps.secrets === undefined ? "La fiche doit déclarer « secrets: aucun »." : "La fiche ne peut pas porter de secret.",
  });
}

const employe = corps.employe;
let nomEmploye = "";
let roleEmploye = "";
if (employe === undefined || typeof employe !== "object" || Array.isArray(employe)) {
  erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom et d'un rôle." });
} else {
  for (const cle of Object.keys(employe)) {
    if (cle !== "nom" && cle !== "role") erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
  }
  if (typeof employe.nom !== "string") erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom." });
  else nomEmploye = employe.nom.trim();
  if (typeof employe.role !== "string") erreurs.push({ code: "employe", message: "L'employé a besoin d'un rôle." });
  else roleEmploye = employe.role.trim();
}
if (nomEmploye !== "") {
  let interdit = nomEmploye.length > 80;
  for (let i = 0; i < nomEmploye.length && !interdit; i++) {
    const code = nomEmploye.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
  }
  if (interdit) erreurs.push({ code: "employe", message: "Le nom de l'employé doit tenir sur une ligne d'au plus 80 caractères." });
} else if (typeof employe === "object" && employe !== null && !Array.isArray(employe) && typeof employe.nom === "string") {
  erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom." });
}
if (roleEmploye !== "") {
  let interdit = roleEmploye.length > 60;
  for (let i = 0; i < roleEmploye.length && !interdit; i++) {
    const code = roleEmploye.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
  }
  if (interdit) erreurs.push({ code: "employe", message: "Le rôle de l'employé doit tenir sur une ligne d'au plus 60 caractères." });
} else if (typeof employe === "object" && employe !== null && !Array.isArray(employe) && typeof employe.role === "string") {
  erreurs.push({ code: "employe", message: "L'employé a besoin d'un rôle." });
}

const botsPrepares: BotPrepare[] = [];
if (!Array.isArray(corps.bots)) erreurs.push({ code: "bots", message: "La fiche doit nommer au moins un bot." });
else if (corps.bots.length < 1) erreurs.push({ code: "bots", message: "La fiche doit nommer au moins un bot." });
else if (corps.bots.length > 6) erreurs.push({ code: "bots", message: "Une fiche compte au plus 6 bots." });
else {
  for (let b = 0; b < corps.bots.length; b++) {
    const bot = corps.bots[b];
    if (bot === undefined || typeof bot !== "object" || Array.isArray(bot)) {
      erreurs.push({ code: "bot", message: `Le bot ${b + 1} est illisible.` });
      continue;
    }
    for (const cle of Object.keys(bot)) {
      if (!["nom", "domaine", "permissions", "connecteurs", "niveau_perspicax", "niveau_autonomie"].includes(cle)) {
        erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
      }
    }
    const nom = typeof bot.nom === "string" ? bot.nom.trim() : "";
    if (nom === "") erreurs.push({ code: "bot", message: `Le bot ${b + 1} a besoin d'un nom.` });
    else {
      let interdit = nom.length > 80;
      for (let i = 0; i < nom.length && !interdit; i++) {
        const code = nom.charCodeAt(i);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
      }
      if (interdit) erreurs.push({ code: "bot", message: "Le nom d'un bot doit tenir sur une ligne d'au plus 80 caractères." });
    }
    const etiquette = nom === "" ? `bot ${b + 1}` : nom;
    const domaine = typeof bot.domaine === "string" ? bot.domaine.trim() : "";
    let domaineInterdit = false;
    for (let i = 0; i < domaine.length && !domaineInterdit; i++) {
      const code = domaine.charCodeAt(i);
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) domaineInterdit = true;
    }
    const morceauxDomaine = domaine === "" ? [] : domaine.split(/\s+/);
    let mots = 0;
    for (const mot of morceauxDomaine) if (mot !== "") mots += 1;
    if (domaineInterdit) {
      erreurs.push({ code: "domaine", message: `Le domaine du bot « ${etiquette} » doit tenir sur une ligne.` });
    } else if (mots !== 3) {
      erreurs.push({
        code: "domaine",
        message: `Le domaine du bot « ${etiquette} » doit compter exactement 3 mots.`,
      });
    }
    const permissions: Record<string, PermissionEntite> = {};
    if (bot.permissions === undefined || typeof bot.permissions !== "object" || Array.isArray(bot.permissions)) {
      erreurs.push({ code: "permission", message: `Le bot « ${etiquette} » a besoin de permissions par entité.` });
    } else if (Object.keys(bot.permissions).length === 0) {
      erreurs.push({ code: "permission", message: `Le bot « ${etiquette} » a besoin de permissions par entité.` });
    } else {
      for (const entite of Object.keys(bot.permissions)) {
        if (!ID_SIMPLE.test(entite)) {
          erreurs.push({ code: "permission", message: `L'entité « ${entite} » du bot « ${etiquette} » est refusée.` });
          continue;
        }
        const droit = bot.permissions[entite];
        if (droit !== "aucune" && droit !== "lecture" && droit !== "ecriture-avec-confirmation") {
          erreurs.push({
            code: "permission",
            message: `La permission « ${affiche(droit)} » sur « ${entite} » du bot « ${etiquette} » est refusée. Valeurs permises : aucune, lecture, ecriture-avec-confirmation.`,
          });
        } else {
          permissions[entite] = droit;
        }
      }
    }
    const connecteurs: string[] = [];
    if (!Array.isArray(bot.connecteurs)) erreurs.push({ code: "connecteur", message: `Le bot « ${etiquette} » doit lister ses connecteurs.` });
    else {
      for (const connecteur of bot.connecteurs) {
        if (typeof connecteur !== "string" || !ID_SIMPLE.test(connecteur)) {
          erreurs.push({ code: "connecteur", message: `Le connecteur « ${affiche(connecteur)} » du bot « ${etiquette} » est refusé.` });
        } else connecteurs.push(connecteur);
      }
    }
    const niveau: string[] = [];
    if (!Array.isArray(bot.niveau_perspicax) || bot.niveau_perspicax.length === 0) {
      erreurs.push({ code: "niveau_perspicax", message: `Le bot « ${etiquette} » a besoin d'un niveau Perspicax.` });
    } else {
      for (const palier of bot.niveau_perspicax) {
        if (typeof palier !== "string" || !NIVEAU.test(palier)) {
          erreurs.push({
            code: "niveau_perspicax",
            message: `Le niveau Perspicax « ${affiche(palier)} » du bot « ${etiquette} » est refusé. Écris organisation, equipe ou personnel, puis lecture, proposition ou ecriture.`,
          });
        } else niveau.push(palier);
      }
    }
    if (bot.niveau_autonomie !== 0) {
      erreurs.push({ code: "niveau_autonomie", message: `Le niveau d'autonomie du bot « ${etiquette} » doit être 0.` });
    }
    if (nom !== "" && !domaineInterdit && mots === 3 && Object.keys(permissions).length > 0 && Array.isArray(bot.connecteurs) && niveau.length > 0 && bot.niveau_autonomie === 0) {
      botsPrepares.push({
        nom,
        domaine,
        permissions,
        connecteurs,
        niveau_perspicax: niveau,
        niveau_autonomie: 0,
      });
    }
  }
}

if (erreurs.length > 0) {
  for (let i = 0; i < erreurs.length; i++) {
    const erreur = erreurs[i];
    if (!erreur) continue;
    let message = erreur.message;
    message = nettoyer(message);
    erreurs[i] = { code: erreur.code, message };
  }
  ecrire("Fiche refusée.");
  return { ok: false, cree: false, profil: null, erreurs };
}

const profil: ProfilPrepare = {
  version: 1,
  employe: { nom: nomEmploye, role: roleEmploye },
  bots: botsPrepares,
};

  return { kind: "profil", profil };
}
