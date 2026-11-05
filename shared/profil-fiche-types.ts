// Types publics de la fiche de besoins (#1383).

export type PermissionEntite = "aucune" | "lecture" | "ecriture-avec-confirmation";

export type BotPrepare = {
  nom: string;
  domaine: string;
  permissions: Record<string, PermissionEntite>;
  connecteurs: string[];
  niveau_perspicax: string[];
  niveau_autonomie: 0;
};

export type ProfilPrepare = {
  version: 1;
  employe: { nom: string; role: string };
  bots: BotPrepare[];
};

export type ErreurFiche = { code: string; message: string };

export type DemandeProfil = {
  approbation?: boolean;
  cles?: Readonly<Record<string, string>>;
  magasin?: { deposer(entrees: ReadonlyArray<{ nom: string; valeur: string }>): void };
  registre?: { creer(profil: ProfilPrepare): void };
  journal?: { ecrire(message: string): void };
};

export type ResultatProfil =
  | { ok: false; cree: false; profil: null; erreurs: ErreurFiche[] }
  | { ok: true; cree: false; profil: ProfilPrepare; erreurs: [] }
  | { ok: true; cree: true; profil: ProfilPrepare; erreurs: [] };
