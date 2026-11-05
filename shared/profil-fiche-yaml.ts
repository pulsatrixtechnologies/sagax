// Parse YAML restreint de la fiche de besoins (#1383).

import type { ResultatProfil } from "./profil-fiche-types.ts";
import type { FicheHelpers } from "./profil-fiche-helpers.ts";

export type Noeud = string | number | Noeud[] | { [cle: string]: Noeud };
type Cadre = {
  indent: number;
  genre: "map" | "seq";
  valeur: { [cle: string]: Noeud } | Noeud[];
  cleEnAttente: string | null;
};

export type YamlParseOk = { kind: "racine"; racine: { [cle: string]: Noeud } };
export type YamlParseResult = ResultatProfil | YamlParseOk;

export function parserFicheYaml(fiche: string, h: FicheHelpers): YamlParseResult {
  const { erreurs, nettoyer, ecrire, refuser } = h;
const brut = fiche.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const morceaux = brut.split("\n");
const lignes: Array<{ n: number; indent: number; texte: string }> = [];
for (let i = 0; i < morceaux.length; i++) {
  const ligne = morceaux[i] ?? "";
  let indent = 0;
  while (indent < ligne.length && ligne[indent] === " ") indent += 1;
  let texte = ligne.slice(indent);
  let quote: string | null = null;
  let coupe = -1;
  for (let j = 0; j < texte.length; j++) {
    const c = texte[j] ?? "";
    if (quote) {
      if (c === "\\" && quote === '"') {
        j += 1;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (j === 0 || texte[j - 1] === " ")) {
      coupe = j;
      break;
    }
    if (c === "&" || c === "*" || c === "!" || (c === "<" && texte[j + 1] === "<")) {
      return refuser("yaml_invalide", `Ligne ${i + 1} : le YAML accepté refuse les ancres, les alias et les balises.`);
    }
  }
  if (coupe >= 0) texte = texte.slice(0, coupe).trimEnd();
  if (texte.trim() === "") continue;
  lignes.push({ n: i + 1, indent, texte: texte.trim() });
}
if (lignes.length === 0) return refuser("fiche_vide", "La fiche est vide.");
if (lignes.length > 400) return refuser("fiche_trop_grande", "La fiche dépasse 400 lignes.");

let racine: Noeud | null = null;
const pile: Cadre[] = [];
let yamlCassee = false;

for (const ligne of lignes) {
  if (yamlCassee) break;
  while (pile.length > 0 && (pile[pile.length - 1]?.indent ?? 0) > ligne.indent) pile.pop();
  if (pile.length > 12) {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : la fiche est trop imbriquée.` });
    yamlCassee = true;
    break;
  }
  const sommet = pile.length > 0 ? pile[pile.length - 1] ?? null : null;

  if (ligne.texte.startsWith("- ")) {
    const reste = ligne.texte.slice(2).trim();
    if (reste === "" || reste === "|" || reste === ">" || reste.startsWith("|") || reste.startsWith(">")) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
      yamlCassee = true;
      break;
    }
    let seq: Noeud[];
    if (sommet && sommet.genre === "seq" && sommet.indent === ligne.indent) {
      seq = sommet.valeur as Noeud[];
    } else if (sommet && sommet.genre === "map" && sommet.cleEnAttente && ligne.indent > sommet.indent) {
      seq = [];
      (sommet.valeur as { [cle: string]: Noeud })[sommet.cleEnAttente] = seq;
      sommet.cleEnAttente = null;
      pile.push({ indent: ligne.indent, genre: "seq", valeur: seq, cleEnAttente: null });
    } else {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
      yamlCassee = true;
      break;
    }

    let cleListe = "";
    let apres: string | null = null;
    let k = 0;
    if (reste.startsWith('"') || reste.startsWith("'")) {
      apres = null;
    } else {
      while (k < reste.length && reste[k] !== ":") k += 1;
      if (reste[k] === ":") {
        const suite = reste.slice(k + 1);
        if (suite === "" || suite.startsWith(" ")) {
          cleListe = reste.slice(0, k).trim();
          apres = suite.trim();
        }
      }
    }
    if (cleListe !== "") {
      const item = Object.create(null) as { [cle: string]: Noeud };
      seq.push(item);
      if (apres === "") {
        pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: cleListe });
      } else if (apres !== null && apres.startsWith("[")) {
        if (!apres.endsWith("]")) {
          erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
          yamlCassee = true;
          break;
        }
        const dedans = apres.slice(1, -1).trim();
        const liste: Noeud[] = [];
        if (dedans !== "") {
          let courant = "";
          let guillemet: string | null = null;
          for (let j = 0; j < dedans.length; j++) {
            const c = dedans[j] ?? "";
            if (guillemet) {
              courant += c;
              if (c === "\\" && guillemet === '"') {
                j += 1;
                courant += dedans[j] ?? "";
                continue;
              }
              if (c === guillemet) guillemet = null;
              continue;
            }
            if (c === '"' || c === "'") {
              guillemet = c;
              courant += c;
              continue;
            }
            if (c === ",") {
              liste.push(courant.trim());
              courant = "";
              continue;
            }
            courant += c;
          }
          if (guillemet) {
            erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
            yamlCassee = true;
            break;
          }
          if (courant.trim() !== "") liste.push(courant.trim());
        }
        item[cleListe] = liste;
        pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: null });
      } else {
        item[cleListe] = apres ?? "";
        pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: null });
      }
    } else {
      seq.push(reste);
    }
    continue;
  }

  let cle = "";
  let brutValeur: string | null = null;
  let ouvert = false;
  if (ligne.texte.startsWith('"') || ligne.texte.startsWith("'") || ligne.texte.startsWith("|") || ligne.texte.startsWith(">")) {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
    yamlCassee = true;
    break;
  }
  let sep = 0;
  while (sep < ligne.texte.length && ligne.texte[sep] !== ":") sep += 1;
  if (ligne.texte[sep] !== ":") {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
    yamlCassee = true;
    break;
  }
  const suite = ligne.texte.slice(sep + 1);
  if (suite !== "" && !suite.startsWith(" ")) {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
    yamlCassee = true;
    break;
  }
  cle = ligne.texte.slice(0, sep).trim();
  brutValeur = suite.trim();
  ouvert = brutValeur === "";
  if (cle === "" || brutValeur === "|" || brutValeur === ">" || brutValeur.startsWith("|") || brutValeur.startsWith(">")) {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
    yamlCassee = true;
    break;
  }

  let map: { [cle: string]: Noeud };
  if (sommet && sommet.genre === "map" && sommet.indent === ligne.indent && sommet.cleEnAttente === null) {
    map = sommet.valeur as { [cle: string]: Noeud };
  } else if (sommet && sommet.genre === "map" && sommet.cleEnAttente && ligne.indent > sommet.indent) {
    map = Object.create(null) as { [cle: string]: Noeud };
    (sommet.valeur as { [cle: string]: Noeud })[sommet.cleEnAttente] = map;
    sommet.cleEnAttente = null;
    const cadre: Cadre = { indent: ligne.indent, genre: "map", valeur: map, cleEnAttente: null };
    pile.push(cadre);
  } else if (!sommet && racine === null) {
    map = Object.create(null) as { [cle: string]: Noeud };
    racine = map;
    pile.push({ indent: ligne.indent, genre: "map", valeur: map, cleEnAttente: null });
  } else {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
    yamlCassee = true;
    break;
  }
  if (Object.prototype.hasOwnProperty.call(map, cle) || pile[pile.length - 1]?.cleEnAttente === cle) {
    erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : clé dupliquée.` });
    yamlCassee = true;
    break;
  }
  if (ouvert) {
    const cadre = pile[pile.length - 1];
    if (!cadre) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
      yamlCassee = true;
      break;
    }
    cadre.cleEnAttente = cle;
  } else if (brutValeur.startsWith("[")) {
    if (!brutValeur.endsWith("]")) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
      yamlCassee = true;
      break;
    }
    const dedans = brutValeur.slice(1, -1).trim();
    const liste: Noeud[] = [];
    if (dedans !== "") {
      let courant = "";
      let guillemet: string | null = null;
      for (let j = 0; j < dedans.length; j++) {
        const c = dedans[j] ?? "";
        if (guillemet) {
          courant += c;
          if (c === "\\" && guillemet === '"') {
            j += 1;
            courant += dedans[j] ?? "";
            continue;
          }
          if (c === guillemet) guillemet = null;
          continue;
        }
        if (c === '"' || c === "'") {
          guillemet = c;
          courant += c;
          continue;
        }
        if (c === ",") {
          liste.push(courant.trim());
          courant = "";
          continue;
        }
        courant += c;
      }
      if (guillemet) {
        erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
        yamlCassee = true;
        break;
      }
      if (courant.trim() !== "") liste.push(courant.trim());
    }
    map[cle] = liste;
  } else {
    map[cle] = brutValeur;
  }
}

for (const cadre of pile) {
  if (cadre.cleEnAttente) {
    erreurs.push({ code: "yaml_invalide", message: "Une valeur imbriquée est manquante." });
    yamlCassee = true;
    break;
  }
}
if (yamlCassee || erreurs.length > 0 || racine === null || Array.isArray(racine)) {
  for (let i = 0; i < erreurs.length; i++) {
    const erreur = erreurs[i];
    if (!erreur) continue;
    let message = erreur.message;
    message = nettoyer(message);
    erreurs[i] = { code: erreur.code, message };
  }
  if (erreurs.length === 0) erreurs.push({ code: "yaml_invalide", message: "La fiche n'est pas lisible." });
  ecrire("Fiche refusée.");
  return { ok: false, cree: false, profil: null, erreurs };
}

const aConvertir: Array<{ parent: { [cle: string]: Noeud } | Noeud[]; cle: string | number }> = [];
for (const cle of Object.keys(racine)) aConvertir.push({ parent: racine, cle });
while (aConvertir.length > 0) {
  const lieu = aConvertir.pop();
  if (!lieu) break;
  const valeur = Array.isArray(lieu.parent) ? lieu.parent[lieu.cle as number] : lieu.parent[lieu.cle as string];
  if (typeof valeur === "string") {
    let converti: Noeud = valeur;
    if (valeur.length >= 2 && valeur.startsWith('"') && valeur.endsWith('"')) {
      let texte = "";
      const corps = valeur.slice(1, -1);
      for (let j = 0; j < corps.length; j++) {
        const c = corps[j] ?? "";
        if (c === "\\" && j + 1 < corps.length) {
          const n = corps[j + 1];
          texte += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 1;
        } else {
          texte += c;
        }
      }
      converti = texte;
    } else if (valeur.length >= 2 && valeur.startsWith("'") && valeur.endsWith("'")) {
      converti = valeur.slice(1, -1).replace(/''/g, "'");
    } else if (/^(?:0|[1-9]\d*)$/.test(valeur)) {
      converti = Number(valeur);
    }
    if (Array.isArray(lieu.parent)) lieu.parent[lieu.cle as number] = converti;
    else lieu.parent[lieu.cle as string] = converti;
  } else if (Array.isArray(valeur)) {
    for (let j = 0; j < valeur.length; j++) aConvertir.push({ parent: valeur, cle: j });
  } else if (typeof valeur === "object") {
    for (const cle of Object.keys(valeur)) aConvertir.push({ parent: valeur, cle });
  }
}


  return { kind: "racine", racine: racine as { [cle: string]: Noeud } };
}
