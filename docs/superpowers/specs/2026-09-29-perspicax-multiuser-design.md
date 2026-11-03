# Pulsa Bot multi-utilisateur par Perspicax

**Date:** 2026-09-29
**Branch:** `develop` (Pulsa Bot, `9c70b9c`), Perspicax `main` à `66c930d` (tag `v1.6.0`)
**Status:** proposition, à approuver par the owner
**Remplace:** les décisions 1 et 2 (serveur quelconque, courriels émis par Pulsa Bot) et la tranche 1b de `2026-09-28-collaborative-org-design.md`, ainsi que le système intérim d'invitations et de codes par courriel.
**Garde:** les décisions 4 à 10 de ce même document (niveaux `use`/`run`/`edit`/`manage`, routines avec l'accès du propriétaire, conteneur par propriétaire, serveur comme VM derrière `computer:use`), réécrites ici avec l'identité, les rôles et les équipes venant de Perspicax. La décision 3 (invités) et le tableau des rôles owner/admin/member/guest sont remplacés par le modèle de Perspicax (section 3).

## 1. But, non-buts, les deux modes

### But

Une seule façon d'être plusieurs dans Pulsa Bot: le serveur privé Pulsatrix Perspicax. Perspicax est le fournisseur d'identité (comptes OAuth 2.1, mot de passe plus TOTP ou passkey, utilisateurs, équipes, comptes de service), il configure le MCP de chaque personne (`/mcp?profile=<slug>`) et il héberge une section « Pulsa Bot » dans sa console. Pulsa Bot continue d'exécuter les bots: engines CLI, ordinateurs, transcripts, routines.

Succès de la première tranche: Owner ouvre `https://bot.<domaine>`, clique « Se connecter avec Perspicax », entre son mot de passe et son TOTP sur la page de Perspicax, revient connecté dans Pulsa Bot comme un principal stable, avec le rôle déduit de son rôle Perspicax.

### Non-buts

- Pas de fédération externe (Entra, Google) dans Perspicax: il reste le seul IdP de l'organisation. Pulsa Bot, lui, parle OIDC standard et accepterait un autre IdP, sans que ce soit testé ni promis.
- Pas de multi-utilisateur sans Perspicax. Un `pulsa serve` sans IdP est solo: une personne, ses appareils.
- Pas de courriel d'identité émis par Pulsa Bot en mode organisation.
- Pas de PR, d'issue ni de push vers Sagax. Tout reste chez `pulsatrixtechnologies`.
- Pas de console Pulsa Bot dupliquée: la console Perspicax gère l'organisation, l'app Pulsa Bot gère les bots.

### Les deux modes

Le mode appartient à un **serveur** Pulsa Bot, pas à l'installation.

| | Solo | Organisation |
|---|---|---|
| Serveur de coordination | aucun: le harness local de l'app, ou un `pulsa serve` personnel | le `pulsa serve` de la compose Perspicax |
| Identité | l'opérateur local (`principals.ts`, `local: true`) | le compte Perspicax (`iss` + `sub`) |
| Appareils supplémentaires | codes d'appairage (`sessions.ts`, `openPairing`) | codes d'appairage liés au principal qui les crée, ou connexion OIDC native |
| Onboarding | garde l'étape « passer » (`src/components/onboarding/WelcomeFlow.tsx`) | l'étape Organisation propose « Rejoindre un serveur Perspicax » |
| Réglage qui l'active | rien | `SAGAX_IDENTITY=perspicax` plus le lien (section 6) |

L'app de bureau garde toujours son harness local en solo. Un serveur d'organisation s'ajoute comme un **environnement** de plus (`electron/environments.cjs`: l'app charge l'interface du serveur distant, la session vit dans le cookie HttpOnly de ce serveur). Être dans une organisation, c'est donc avoir un environnement de plus, pas changer d'installation.

### Passer de solo à organisation

1. Réglages > Organisation > « Rejoindre un serveur Perspicax »: on colle l'adresse du serveur Pulsa Bot. L'app lit `/.well-known/openmausbot/environment` (`server/environment.ts:122`), qui annonce désormais `identity: { kind: "oidc", issuer }`.
2. Connexion OIDC (section 2). L'environnement est enregistré.
3. L'app propose « Copier des bots vers l'organisation ». On choisit des bots; pour chacun, avec ou sans fils et mémoire.
4. Le transfert réutilise la sauvegarde d'équipe (`server/backup/team-backup.ts`, `shared/team-backup.ts`: bots, tâches avec leurs messages, routines, mémoire), exportée par le harness local et importée par une route authentifiée du serveur d'organisation (`POST /api/org/import`, section 8). Les canaux (`GroupRecord`) suivent seulement si leurs seuls humains sont la personne qui migre.
5. Réécriture des personnes: le principal local (`local: true`) reçoit `linkedSubjects: [{ iss, sub, serverOrigin }]`. À l'import, chaque référence au principal local (`ownerUserId`, `humanIds`, `directGrants`, `runAs`) devient le principal d'organisation de la même personne. Toute autre référence (une autre personne connue de ce poste) est retirée et listée dans le rapport d'import, jamais convertie en droit. Même mécanique que `server/identity-migration.ts`, avec une table de réécriture explicite au lieu d'une résolution par courriel.
6. C'est une **copie**. Rien n'est effacé localement. Après vérification, l'app offre « Retirer ces bots de cet ordinateur » bot par bot.
7. Les clés des fournisseurs ne voyagent pas (la sauvegarde les caviarde déjà, `redactSecretsInText`); le propriétaire les saisit dans le coffre du serveur (décision 7).

### Revenir en solo

- « Quitter l'organisation » sur le bureau: l'app appelle la déconnexion du serveur (révocation de la session Pulsa Bot et du refresh token Perspicax, section 2), puis retire l'environnement. Le harness local n'a jamais cessé d'être solo.
- Récupérer un bot: une personne qui a `manage` sur un bot d'organisation peut l'exporter en paquet (`server/package-export.ts`) et l'importer en local. Les fils ne suivent que si l'admin l'autorise (réglage d'organisation, désactivé par défaut: ce sont des données de l'organisation).
- Désactiver le compte dans Perspicax coupe tout accès au serveur d'organisation (section 2, déconnexion par le canal arrière). Les copies locales restent à la personne.

### Serveur intérim déjà en organisation

Un serveur de `develop` qui a déjà des principals créés par courriel (tranches du 2026-09-28) passe en mode Perspicax ainsi: à la première connexion OIDC d'un `sub` inconnu, si un principal intérim sans `subject` porte le même courriel, il est rattaché une seule fois, et le rattachement est écrit au journal d'audit. Après la période de migration (réglage admin, 30 jours par défaut), le rattachement par courriel est coupé et seul `iss` + `sub` compte.

### Ce qu'on réutilise de Perspicax

Règle: tout ce que Perspicax sait déjà faire, Pulsa Bot le prend au lieu de le refaire.

| Besoin | Ce qui existe dans Perspicax |
|---|---|
| Comptes et connexion | mot de passe PBKDF2 plus TOTP, ou passkey; premier accès qui force le changement de mot de passe et l'inscription du second facteur (`crates/local-oauth`, `page.rs`, `must_change_password`) |
| Cycle de vie des personnes | l'admin crée, désactive, supprime, réinitialise mot de passe et TOTP (`api/users.rs`); désactiver révoque les sessions (`model/users.rs::set_status`) |
| Rôles | `admin`, `manager`, `employee` (`model/users.rs:21`), repris tels quels (section 3) |
| Équipes et gestionnaires | `Team { managers, members, profiles }` (`model/teams.rs`); « un gestionnaire ne donne que dans ses équipes » devient la règle de partage des bots et canaux |
| Portée MCP | profils par défaut des équipes, donnés aux membres à l'arrivée (`via_team`), plus les profils donnés à la personne; c'est la portée de l'échange de jeton (section 4) |
| Journal et audit | `auth_events`, `mcp_requests` (client, profil, provenance), `admin_audit`, et l'explorateur du journal de la console |
| Coffre | XChaCha20-Poly1305 (`vault/mod.rs`), rotation hors ligne; il garde la clé de signature (P2) et les clés de fournisseur du propriétaire dont ses bots et ses routines ont besoin (décision 7, section 4 bis), comme identifiants `scope: user` liés à la personne, lus par le serveur Pulsa Bot à travers le lien au moment d'exécuter |
| Comptes de service | `kind: service`, jeton `pxat1.` montré une fois, rotation (`api/users.rs:178`): c'est le lien entre les deux serveurs |
| Console | coquille, barre latérale et ses groupes (`components/shell.tsx`), feuilles d'édition, grille, i18n; la section Pulsa Bot est un groupe de plus |
| Hôtes de redirection | `redirect_hosts.txt` et leur page d'admin (`api/oauth_redirect_hosts.rs`) |

Retiré en mode organisation, parce que Perspicax le couvre:

| Code intérim de Pulsa Bot | Remplacé par |
|---|---|
| liens d'invitation `/join#token` (`org-routes.ts`, `org-record.ts::issueInvite`, `src/pair/JoinPage.tsx`) | un compte créé par un admin dans Perspicax |
| codes par courriel (`email-otp.ts`, `account-signin.ts`) | la connexion Perspicax |
| rôles de l'annuaire d'organisation (`org-directory.ts::roleOf`, `SAGAX_SIGNIN_EMAILS`) | le claim `role` |
| liste des personnes de l'organisation (`org-routes.ts`, `OrgPerson`, Réglages > Organisation) | l'annuaire de Perspicax, lu par le lien, et ses pages Personnes et Équipes |
| mailer d'identité (`mailer.ts`, `mail-config.ts`, `compose.mail-test.yaml`) | rien à envoyer: le compte naît dans Perspicax |
| propriétaire d'organisation unique (`org-record.ts`, `ownerUserId`) | les admins Perspicax |

## 2. Identité

### Recommandation sur le trou connu: jeton d'identité ES256 et JWKS

Aujourd'hui Perspicax annonce `"id_token_signing_alg_values_supported": ["none"]` (`crates/local-oauth/src/lib.rs:179`) et, en fait, **n'émet aucun `id_token`**: `TokenResponse` (`lib.rs:2337`) ne porte que `access_token`, `refresh_token`, `expires_in`, `refresh_expires_in` et `scope`. `/api/v1/me` (`crates/gateway/src/api/me.rs:14`) n'accepte que le cookie de console ou un jeton `pxat1.` (`api/auth.rs:226`, `resolve_caller`: les lignes `sessions` de type `console` ou `api_token`), pas un jeton d'accès OAuth `pxlo1.`.

**Recommandation: signer un vrai `id_token` en ES256 et publier un JWKS.** Raisons:

- C'est le standard OIDC; Pulsa Bot (Apache-2.0) reste un client OIDC générique, utilisable avec un autre IdP.
- La vérification est locale (clé publique en cache), sans appel à Perspicax par requête.
- La même clé signe les deux autres jetons courts dont on a besoin: le jeton de déconnexion par canal arrière (OpenID Connect Back-Channel Logout 1.0) et l'assertion que la console envoie au serveur Pulsa Bot (section 5). Une seule vérification côté Pulsa Bot.
- `/me` demanderait de toute façon un changement dans `resolve_caller` pour accepter `pxlo1.`, et lierait le client Apache à une API propriétaire.

`/api/v1/me` n'est pas utilisé par Pulsa Bot. Un `userinfo_endpoint` standard pourra s'ajouter plus tard si un besoin de rafraîchir les attributs sans refresh apparaît.

### Flux de connexion: Pulsa Bot comme BFF

Le serveur Pulsa Bot est le client OIDC (patron Backend for Frontend). Ni le navigateur, ni l'app de bureau, ni le téléphone ne voient un jeton Perspicax. Ils reçoivent la session Pulsa Bot qu'ils connaissent déjà (`server/sessions.ts`: cookie HttpOnly pour le web, bearer pour les apps natives).

```
navigateur ──GET /auth/oidc/start──▶ Pulsa Bot
                                     state, nonce, PKCE S256 (en mémoire, 10 min, usage unique)
          ◀──302 authorize──────────
          ──▶ Perspicax /oauth/authorize?client_id=pulsa-bot&resource=https://bot.x&scope=openid profile email offline_access
              mot de passe + TOTP, ou passkey (page existante, page.rs)
          ◀──302 https://bot.x/auth/oidc/callback?code&state&iss
          ──▶ Pulsa Bot /auth/oidc/callback
                 POST /oauth/token (code, verifier)  ──▶ Perspicax
                 ◀── access (aud https://bot.x), refresh pxlr1., id_token ES256
                 vérifie id_token, trouve ou crée le principal, scelle le refresh
          ◀──302 / + Set-Cookie session Pulsa Bot
```

- `resource` vaut l'origine publique du serveur Pulsa Bot, pas `/mcp`. Le jeton d'accès de connexion a donc l'audience de Pulsa Bot et **ne vaut rien sur `/mcp`**: `validate_access_token` compare l'audience (`lib.rs:1709`) et le connecteur valide contre `app.config.audience()` (`crates/connector/src/http/bearer.rs:240`). La séparation des jetons de connexion et des jetons MCP est structurelle.
- Client `pulsa-bot`: client public premier parti, PKCE S256, redirection exacte `https://<origine Pulsa Bot>/auth/oidc/callback`. Pas de sélecteur de profil pour lui (section 7). `iss` (RFC 9207, déjà émis par Perspicax) est vérifié au retour.
- Vérification de l'`id_token`: `alg` exactement `ES256` (jamais `none`), `kid` connu du JWKS (rechargé une fois sur `kid` inconnu), `iss` exact, `aud` = `pulsa-bot`, `exp`, `iat` avec 60 s de tolérance, `nonce` égal à celui de la tentative.
- Pas de nouvelle dépendance npm: `node:crypto` importe une clé JWK (`createPublicKey({ key, format: "jwk" })`) et vérifie ES256 (`dsaEncoding: "ieee-p1363"`). Même style que `server/mcp/mcp-oauth.ts`, dont on réutilise `pkcePair`, `authorizationServerMetadataUrls`, `readBounded` et `safeEndpoint`.

### Par client

| Client | Comment il se connecte | Ce qu'il garde |
|---|---|---|
| Web (navigateur) | `/pair` gagne un bouton « Se connecter avec Perspicax » (`src/pair/PairPage.tsx`), flux ci-dessus | cookie de session Pulsa Bot |
| Bureau (Electron) | tranche 1: le flux dans la fenêtre, comme le web, puisque l'environnement charge l'interface du serveur. Tranche 2: navigateur système (RFC 8252), parce qu'une passkey de plateforme ne marche pas bien dans une fenêtre Electron. Le callback du serveur émet alors un **identifiant d'appairage à usage unique lié au principal** (`sessions.openPairing({ principalId, ttlMs: 120_000 })`) et redirige vers le lien `auth?origin=<o>#code=<c>` du schéma d'URL de l'app (l'ancien schéma à l'époque, `sagax://` aujourd'hui). L'app (`app.setAsDefaultProtocolClient(<schéma>)`, `electron/main.mjs:2979`; `open-url`, ligne 259) charge `<o>/pair#code=<c>` dans sa fenêtre: l'échange existant pose le cookie. | cookie de session dans le jar Chromium; aucun jeton Perspicax |
| Téléphone | tranche 1: code QR d'appairage ouvert par une personne connectée (web ou bureau), déjà lié à son principal (`server/index.ts:14957`); zéro changement natif. Tranche 2: `ASWebAuthenticationSession` (iOS) et Custom Tabs (Android) sur `/auth/oidc/start?client=phone`, retour par le lien `pair?origin=…#code=…` du schéma d'URL de l'app (l'ancien schéma à l'époque, `sagax://` aujourd'hui) puis `POST /api/pair` existant | bearer de session dans Keychain / Keystore |

Le schéma personnalisé ne transporte jamais de code Perspicax, seulement l'identifiant d'appairage Pulsa Bot: haute entropie, 2 minutes, usage unique, stocké haché, soumis au verrouillage par source (`LOCKOUT`, `sessions.ts:55`). Un code volé sur le schéma ne vaut qu'une session Pulsa Bot révocable, pour ce seul principal.

### Principal

Le principal de `server/principals.ts` reste la personne. On ajoute:

| Champ | Rôle |
|---|---|
| `subject` | `{ iss, sub }`, clé d'identité en mode organisation. `sub` est l'id ULID de l'utilisateur Perspicax (le `sub` des jetons est l'id de l'utilisateur de la gateway, `api/session.rs`, `store.get_user(&access.sub)`). Jamais réutilisé. |
| `email`, `name`, `login` | attributs tirés des claims, mis à jour à chaque connexion et rafraîchissement. Jamais une clé: Perspicax ne vérifie pas les adresses, donc `email_verified` vaut `false`. |
| `orgRole` | dernier rôle Pulsa Bot calculé (section 3), pour l'affichage hors ligne. |
| `disabledAt` | posé par la déconnexion par canal arrière ou quand l'annuaire dit `disabled`. |

`PrincipalRegistry.forSubject({ iss, sub, claims })` remplace `forAccount` en mode organisation. `controlPlaneUserId` reste lisible pour les anciens fichiers et n'est plus écrit.

### Session sur le serveur Pulsa Bot

- La session reste un `SessionRecord` (`sessions.ts:68`), avec `principalId` et un nouveau champ `idp: { iss, sub, grantRef }`. `grantRef` pointe vers l'enregistrement scellé du refresh token Perspicax de cette session, dans un coffre calqué sur `McpOAuthVault` (`mcp-oauth.ts:120`, fichier chiffré à côté des données, clé en fichier `0600` ou en variable d'environnement).
- Validation par requête: la session Pulsa Bot, comme aujourd'hui (`server/request-auth.ts`). Pas d'introspection.
- Fraîcheur: quand une session est utilisée et que son dernier rafraîchissement date de plus de 50 minutes (le jeton d'accès vit 3600 s, `ACCESS_TOKEN_TTL_SECS`, `lib.rs:229`), le serveur fait un `refresh_token` grant, en vol unique par session (même patron que `refreshing` dans `McpOAuthManager`). Le nouvel `id_token` met à jour les claims (rôle, équipes). Un `invalid_grant` révoque la session Pulsa Bot.
- Durée: la session suit le refresh Perspicax (30 jours glissants, `REFRESH_TOKEN_TTL_SECS`, `lib.rs:234`). `SESSION_TTL_MS` et `SESSION_MAX_AGE_MS` (`sessions.ts:36-41`) restent des plafonds.
- Révocation immédiate: Perspicax appelle `POST /api/auth/oidc/backchannel-logout` avec un `logout_token` ES256 (`sub`, `events`, `jti`) quand un utilisateur est désactivé, supprimé, ou révoque ses sessions. Pulsa Bot ferme les sessions de ce `sub` et leurs flux SSE (`closeSessionStreams` existe déjà).
- Déconnexion: `POST /api/auth/logout` (existant, `index.ts:14939`) révoque aussi le refresh Perspicax par un nouveau `/oauth/revoke` (RFC 7009). `mcp-oauth.ts` sait déjà lire un `revocation_endpoint`.

### Codes d'appairage et système intérim

| Mécanisme | Solo | Organisation |
|---|---|---|
| Code d'appairage lié au principal (`openPairing({ principalId })`) | gardé | gardé: c'est l'appareil de la personne qui l'a créé |
| Code d'appairage sans principal | gardé (l'opérateur) | refusé, sauf le code d'amorçage admin avant le lien (section 6) |
| Code par courriel (`email-otp.ts`, `account-signin.ts` serveur et control plane) | retiré: rien à envoyer à une seule personne | refusé, comme `HOSTED_WORKSPACE` le fait déjà (`index.ts:14647`) |
| Invitations `/join#token` (`org-routes.ts`, `org-record.ts::issueInvite`, `src/pair/JoinPage.tsx`) | retirées | remplacées par un compte créé par un admin dans Perspicax |
| Liste d'accueil `SAGAX_SIGNIN_EMAILS` (`config.ts:1064`) | retirée | remplacée par les claims |
| Mailer SMTP / SendGrid (`mailer.ts`, `mail-config.ts`) | retiré (seuls usages: connexion et invitations, `index.ts:14584`) | non utilisé |

## 3. Autorisation

Principe: le modèle de Perspicax est la référence. Pulsa Bot n'invente ni rôle, ni équipe, ni catégorie d'invité. Il lit le rôle et les équipes que l'admin gère déjà dans la console Perspicax, et n'ajoute que ce que Perspicax n'a pas: les droits sur ses propres objets (bots, canaux, routines).

### Qui décide quoi

| Décision | Source de vérité | Pourquoi |
|---|---|---|
| La personne existe, est active, son nom, son courriel | Perspicax (`crates/gateway/src/model/users.rs`, `User`) | un seul annuaire |
| Rôle (`admin`, `manager`, `employee`), type (`person`, `service`) | Perspicax (`users.rs:21`, `:57`) | idem |
| Équipes, leurs gestionnaires, leurs membres, leurs profils par défaut (`model/teams.rs`, `Team { managers, members, profiles }`; les profils de l'équipe sont donnés à chaque membre à l'arrivée, `via_team`, et retirés au départ) | Perspicax | idem |
| Qui peut se connecter à Pulsa Bot | Perspicax: toute personne active | pas de liste d'accès propre à Pulsa Bot |
| Propriété des bots, membres des canaux, visibilité des routines, niveaux par bot | Pulsa Bot | ce sont des objets de Pulsa Bot, sans équivalent dans Perspicax |
| Profils MCP qu'une personne détient | Perspicax (`profiles_of_user`, scopes `profile:<id>`) | le MCP est à Perspicax |

### Claims

Aucun claim propre à Pulsa Bot. L'`id_token` porte ce que Perspicax sait déjà:

- `role`: `admin`, `manager` ou `employee`, tel quel;
- `teams`: `[{ id, name, manager }]`, les équipes dont la personne est membre ou gestionnaire (`manager: true` quand elle figure dans `Team.managers`).

Un compte `service` ne se connecte jamais (il n'a ni mot de passe ni second facteur); il sert au lien (section 5).

### Correspondance directe

| Perspicax | Pulsa Bot |
|---|---|
| `admin` | admin de l'organisation: réglages, voit tous les bots et canaux dans la liste, peut transférer la propriété d'un bot; scopes de session `["admin", "client"]` |
| `manager` | membre, plus: administre le partage des bots et des canaux **pour les équipes qu'il gère** (donner, retirer, changer un niveau quand le droit vise une de ces équipes ou un de leurs membres), modère les canaux de ces équipes; scopes `["client"]` |
| `employee` | membre: crée ses bots, les partage, parle aux bots et canaux qu'on lui ouvre; scopes `["client"]` |

C'est exactement la règle de Perspicax pour ses profils: « a manager grants only within their teams » (`model/`, AGENTS.md de Perspicax). Une personne externe à l'organisation est un compte Perspicax comme les autres, créé par un admin, dans l'équipe qu'on veut; ses accès se règlent par les équipes et les droits, pas par une catégorie à part. Le rôle d'organisation reste distinct du scope serveur (tranche 2 du document du 2026-09-28): `can()` décide, le scope ne sert que de premier filtre (`CLIENT_ALLOW`, `request-auth.ts`).

### `can(principal, action, resource)`

Un module `server/authz.ts` absorbe `channel-visibility.ts` et `direct-grants.ts`:

- Entrées: le principal (rôle et équipes à jour, `disabledAt`), l'action (`bot.use`, `bot.run`, `bot.edit`, `bot.manage`, `bot.approve`, `channel.read`, `channel.post`, `channel.moderate`, `routine.view`, `routine.edit`, `org.settings`, `computer.use`, `vault.read`), la ressource (bot, canal, routine, org).
- Cible d'un droit: un utilisateur Perspicax (`user:<ulid>`, résolu en principal) **ou une équipe Perspicax** (`team:<ulid>`). Un droit d'équipe suit l'équipe: qui y entre l'obtient, qui en sort le perd, sans rien recopier, comme les profils `via_team`. Un canal peut avoir une équipe pour membres.
- Niveaux par bot: `use` ⊂ `run` ⊂ `edit` ⊂ `manage` (décision 5). Gardés parce que Perspicax n'a rien pour « parler à un bot » contre « lancer ses routines » contre « modifier ses instructions ».
- Qui administre un droit: le propriétaire du bot, qui a `manage`, un admin, et le gestionnaire d'une équipe pour les droits qui visent son équipe ou ses membres.
- L'approbation reste au propriétaire ou à son délégué `approver`, jamais à l'admin par défaut.
- Un admin règle l'organisation mais ne lit pas le Direct privé d'un autre: `bot.use` sur le bot d'autrui exige un droit.
- Un principal `disabledAt` n'a aucun droit; ses droits restent listés pour l'historique.
- Utilisé par le filtre SSE, la liste des canaux et des bots, la recherche (`searchHitVisible`) et chaque route qui modifie. Les fonctions pures de `channel-visibility.ts` deviennent des cas de `can()`, avec leurs tests.

La branche `fix/member-identity` (`server/viewer-identity.ts`, `memberBotFieldViolation` dans `request-auth.ts`) se garde telle quelle: le nom et le courriel viennent des claims au lieu de l'adresse de connexion.

### Les sections de la barre latérale sont des canaux (décision de the owner, 2026-09-30)

Aujourd'hui une section de la barre latérale n'est qu'une étiquette texte posée sur un bot (`bot.section`, créée depuis le menu d'un bot: « Déplacer vers l'équipe » puis « Nouvelle équipe… », `Sidebar.tsx`). Owner veut qu'une section soit vue comme un canal, au sens Discord ou Teams:

- Une section **est** un canal d'organisation: elle a un identifiant, un nom, des membres (utilisateurs ou équipes Perspicax, `user:<ulid>` / `team:<ulid>`, avec les rôles de canal `moderator`, `participant`, `readonly`) et sa propre conversation de groupe.
- Les bots rangés dans une section sont les bots du canal: être membre de la section donne `bot.use` sur ces bots (niveau par défaut réglable par section, jamais plus que `run` sans droit explicite), et l'accès suit l'appartenance, comme un droit d'équipe. Retirer quelqu'un de la section lui retire cet accès tout de suite (scénario C).
- Partager une section avec une équipe Perspicax partage d'un coup tous ses bots et sa conversation: c'est la voie normale de partage; le droit par bot reste pour les exceptions.
- « General » est la section par défaut et personnelle: non partageable, non renommable, non supprimable.
- Gestion par clic droit dans la barre latérale: sur l'en-tête d'une section, « Nouvelle section… », « Renommer… », « Membres et partage… », « Monter » / « Descendre », « Tout replier / Tout déplier », « Supprimer la section » (ses bots retournent dans General); sur l'espace vide de la liste, « Nouvelle section… ». Création et renommage en place dans l'en-tête (Entrée valide, Échap annule); Maj+F10 ou la touche menu ouvre le même menu au clavier. Qui peut faire quoi passe par `can()` (`channel.moderate` pour renommer, gérer les membres et supprimer).
- Migration: chaque étiquette `bot.section` existante devient une section-canal privée à son propriétaire, sans aucun membre de plus; rien n'est partagé sans action de quelqu'un.
- En mode solo, les sections restent de simples groupes locaux (mêmes menus, sans « Membres et partage… »).

Tranche: la tranche 3 livre le modèle (section = canal, migration, clic droit, conversation de section) avec le partage à un utilisateur; la tranche 4 ajoute le partage d'une section à une équipe Perspicax et les niveaux par défaut. Si la tranche 3 est déjà en cours ou livrée au moment de lire ceci, tout va dans la tranche 4.

## 4. MCP configuré automatiquement

### Recommandation: échange de jeton RFC 8693, pas un second OAuth par personne

Le client OAuth MCP existant (`server/mcp/mcp-oauth.ts`) ferait refaire à chaque personne une connexion complète par profil: la page d'autorisation de Perspicax ne garde aucune session de navigateur (aucun cookie posé par `routes.rs` ni `page.rs`), donc chaque autorisation redemande mot de passe et TOTP. De plus son coffre est indexé par nom de serveur, pas par personne (`McpOAuthVault.get(name)`, `withAuthHeaders`, `mcp-oauth.ts:784`): sur un serveur partagé, la connexion d'une personne servirait à toutes.

**Recommandation: le serveur Pulsa Bot échange le jeton de la personne contre un jeton MCP court, sur `/oauth/token`, en RFC 8693.**

```
POST /oauth/token
Authorization: Basic pulsa-bot-server:<jeton pxat1. du compte de service du lien>
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<jeton d'accès de la personne, aud = origine Pulsa Bot>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
resource=https://px.x/mcp?profile=<slug>
```

Perspicax vérifie le lien (section 5), le `subject_token` (audience = l'origine du serveur lié, client `pulsa-bot`, utilisateur actif), trouve le profil parmi ceux que la personne détient (`scope_for_hint` sur `profile_choices`, `routes.rs:326`, `lib.rs:1195`), puis appelle `mint_internal_access_token(sub, [scope], "pulsa-bot:<server id>", mcp_audience, ttl)` (`lib.rs:1655`). Cette primitive existe déjà pour le moteur de fils IA, intersecte avec ce que le compte détient (SEC2 du 2026-09-11) et ne crée pas de refresh. TTL: 15 minutes au plus, jamais au-delà de l'expiration du `subject_token`. Un profil non détenu répond `invalid_target`, comme un mauvais `resource` aujourd'hui.

Le jeton obtenu est un jeton MCP ordinaire: le journal de Perspicax (`mcp_requests`, `client`, `client_name`, `profile_ids`, `credential_id`) montre chaque appel au nom de la personne, avec le client `pulsa-bot:<server id>`. Le pont (ci-dessous) envoie `clientInfo.name = "Pulsa Bot (<bot id>)"`, donc la console voit aussi quel bot a appelé.

`mcp-oauth.ts` reste pour les serveurs MCP tiers qu'une personne ajoute. En mode organisation, son coffre s'indexe par `(principalId, name)`.

### Quel profil, pour qui

- Chaque bot porte `perspicax: { profiles: [slug] }`, choisi par qui a `edit`, parmi les profils que **cette personne** détient (liste lue par échange à blanc ou par l'annuaire).
- Tour interactif: le MCP tourne sous l'identité de **la personne qui a envoyé le message**, pas du propriétaire. Si elle ne détient pas le profil, l'outil n'apparaît pas et le bot le dit. C'est la seule façon de garder exacte la visibilité par personne de Perspicax (« per-user visibility staying exact through the scopes », AGENTS.md de Perspicax, décisions en vigueur).
- Tour déclenché par un autre bot (délégation, `server/delegations.ts`): l'identité de l'humain à la racine de la chaîne, transportée dans la boîte de délégation.
- Routine: son `runAs`, qui est son propriétaire (décision 7), par une délégation durable (ci-dessous).

### Délégation pour les routines

**Décision de the owner, 2026-10-08 (remplace le consentement ci-dessous) :** sur un serveur d'organisation, une routine agit toujours au nom de son propriétaire. Aucun consentement, aucun interrupteur, aucune carte « reconnecter mes routines ». Sagax obtient la délégation lui-même, par le lien, avec un échange de jeton RFC 8693 du jeton d'accès de connexion de la personne (`requested_token_type` refresh token, `scope=openid profile email offline_access pulsabot:routines`, `resource` l'origine du serveur) : à chaque connexion, à chaque renouvellement de connexion tant que la personne utilise Sagax (glissement quotidien), et à une exécution qui n'en trouve pas. Une famille terminée par Perspicax est réémise ; une exécution qui ne peut pas en obtenir une est sautée, jamais suspendue. Seule une personne désactivée, supprimée ou déconnectée par Perspicax (`person_out`), ou sans `run` sur le bot (`no_right`), suspend une routine. Perspicax doit accepter cet échange (refusé jusqu'à 1.8.13) et retirer la révocation en libre-service (#166).

Historique : une routine qui tourne pendant que son propriétaire est hors ligne n'a pas de jeton d'accès vivant à échanger. Le propriétaire consent une fois (« Autoriser mes routines à agir en mon nom »): un flux d'autorisation séparé avec `scope=openid offline_access pulsabot:routines` crée une famille de refresh distincte de celle de sa session, scellée sur le serveur Pulsa Bot. Avant chaque routine: rafraîchir cette famille (vol unique par principal), échanger, exécuter, révoquer. La famille survit à la déconnexion des appareils, pas à la désactivation du compte ni à une révocation depuis Pulsa Bot ou la console Perspicax.

### Injection par engine: un pont stdio tenu par le harness

Aujourd'hui un jeton OAuth MCP part dans les en-têtes de la configuration MCP de l'engine (`engineMcpServers`, `index.ts:13977`, puis `withAuthHeaders`): il est lisible par le processus de l'engine et par un shell en accès complet. Pour Perspicax on reprend le patron de `server/connector-proxy.ts` (le pont Composio: « credentials never pass through its transcript »):

- L'engine voit un serveur MCP **stdio**, `server/perspicax-mcp-bridge.ts`, pour chaque profil du bot. Tous les engines (Claude, Codex, Pi, ACP) savent parler stdio.
- Le pont ne reçoit aucun jeton en argument ni en variable: il demande au harness, en loopback, avec la capacité du tour (même mécanique que `SAGAX_CONNECTOR_TOKEN`), un jeton pour `(tour, profil)`. Le harness fait l'échange, garde le jeton en mémoire, le rend au pont, et le révoque à la fin du tour (`revoke_access_token`, `lib.rs:1765`, fait pour ces jetons internes).
- Le pont relaie en Streamable HTTP vers `https://px.x/mcp?profile=<slug>`; `tools/list` est déjà filtré par Perspicax selon les scopes.
- Risque résiduel, écrit tel quel: pendant un tour, un shell du bot qui lit la capacité du tour peut demander le même jeton au harness. Il n'obtient que les profils de ce bot, pour la personne de ce tour, jusqu'à la fin du tour, et chaque appel est au journal de Perspicax.

## 4 bis. Bots exécutés sur le serveur

Exigence de the owner: un bot créé en mode organisation fonctionne depuis le serveur, et reste utilisable quand on le partage. Tout tour d'un bot d'organisation s'exécute dans le serveur Pulsa Bot de la compose, jamais sur le poste de qui parle.

### Engines présents dans l'image

- L'image (`Dockerfile`) installe les engines par l'argument de build `ENGINES` (`npm install -g $ENGINES`, ligne 54), vide par défaut. La `compose.yaml` solo passe `@anthropic-ai/claude-code @openai/codex`. La compose unique doit passer la même liste **explicitement**, et l'image publiée pour l'organisation est construite avec elle: sans cet argument, le serveur démarre sans aucun engine.
- L'image contient aussi `agent-browser` et Chromium (lignes 60 à 70): la navigation sans écran marche sur le serveur.
- `HOME=/data` (ligne 76): les connexions des CLI (`~/.claude`, `~/.codex`) et l'état de Pulsa Bot survivent aux redémarrages, dans le volume `pulsabot-data`.
- Au démarrage, le serveur publie dans `/api/health` (et la page Serveurs de la console) la liste des engines installés et leur version, par les sondes CLI existantes (`cliProbeEnvironment`, `index.ts:13691`). Un engine absent n'est jamais proposé.

### Où vivent les accès aux engines

Aujourd'hui les accès sont communs à tout le serveur: comptes Claude nommés (`server/engines/claude-accounts.ts`, « provider credentials are server-wide »), connexions en cours rattachées à la session admin (`server/engines/provider-auth-sessions.ts`), clés API posées dans Réglages > Connections et passées dans l'environnement de l'instance (`drivers/claude.ts:182-206`, qui retire toute clé qui ne vient pas de l'instance). En organisation:

| Accès | Où | Qui le pose | Pour quels tours |
|---|---|---|---|
Révision du 2026-10-01 (décision de the owner, remplace la décision 7 du 2026-09-28 « la clé du propriétaire sert tout le monde », l'interrupteur `memberBotsUseOrgKey` et la règle « les abonnements connectés sur ce serveur restent aux bots des admins »): **la personne qui parle paie.**

| Accès | Où | Qui le pose | Pour quels tours |
|---|---|---|---|
| Abonnement (connexion Claude ou ChatGPT) | dossier de connexion propre au principal (`/data/principals/<id>/claude`, `CLAUDE_CONFIG_DIR` et équivalent Codex), au lieu du dossier commun | la personne elle-même, depuis le poste ou le web (Réglages > Organisation > Mes engines) | tous les tours qu'elle lance, sur ses bots et sur les bots partagés avec elle; les routines des bots dont elle est propriétaire; jamais le tour d'une autre personne |
| Clé API de la personne (Anthropic, OpenAI) | coffre de Perspicax, identifiant `scope: user` lié à la personne (P10) | la personne, dans la console Perspicax | les mêmes tours que son abonnement, quand elle n'en a pas pour cet engine |
| Clé d'organisation | Réglages > Connections du serveur (existant), posée par un admin | un admin | repli automatique après l'abonnement et la clé de la personne, sur un engine à clé; plus d'interrupteur |

Ordre de résolution pour un tour (`server/engines/engine-credentials.ts`): engine absent, payeur désactivé (refus), abonnement du payeur, clé du payeur dans Perspicax (`owner-key` s'il est propriétaire du bot, sinon `speaker-key`), clé d'organisation, sinon refus avec la carte « connectez-vous avec votre abonnement ou ajoutez votre clé, ou demandez à un admin ». Le payeur est la personne qui parle; pour une routine du bot, toujours son **propriétaire**, quelle que soit la personne qui l'a créée, modifiée ou lancée (son `runAs` ne sert qu'à l'identité MCP). Les connexions et clés propres au serveur ne servent plus les bots des admins. La clé est lue au moment du tour, injectée dans l'environnement de l'instance de ce seul tour, jamais écrite dans `config.json`.

### Quand B parle au bot de A

- **Engine:** l'accès de B (son abonnement, sa clé, sinon la clé d'organisation). Jamais l'abonnement ni la clé de A. Le coût va à B ou à l'organisation; le fil indique ce qui a payé (« Votre abonnement », « Votre clé », « Clé de l'organisation », « Identifiants du propriétaire » pour une routine) et la page Utilisation le montre par personne qui parle (`access`, `payerPrincipalId`).
- **MCP:** l'identité de B (section 4). Le bot de A ne voit jamais les données ConnectWise que B ne voit pas.
- **Approbation:** A ou son `approver` (décision 5); B voit que la carte attend le propriétaire.

### Ordinateurs et VM

- Les VM locales passent par un runtime de conteneurs (`server/computer/container-computer.ts`: `docker`, `podman`, `container`). L'image du serveur n'en a pas, et on ne lui donne pas le socket Docker (document du 2026-09-28, « risque trop grand »). En organisation, les bots n'ont donc pas de VM locale dans les tranches 1 à 8; le formulaire de création ne propose que ce qui existe sur le serveur (dossier du bot, navigateur sans écran).
- Le serveur comme VM derrière `computer:use` (décision 10) et le conteneur par propriétaire (décision 8) restent des tranches ultérieures, sur un runtime séparé.
- Tant que tous les bots partagent le conteneur et l'utilisateur `maus`, un shell en accès complet pourrait lire l'environnement d'un autre tour (`/proc/<pid>/environ`) et donc une clé. En organisation, l'accès complet sans carte est refusé aux bots des membres jusqu'au conteneur par propriétaire (T15).

### Échecs visibles

Jamais un tour qui échoue en silence. Chaque cas donne une carte dans le fil, à la personne qui parle, et un avis au propriétaire:

| Cas | Ce que voit qui parle | Ce que voit le propriétaire |
|---|---|---|
| engine absent de l'image | « Ce bot utilise Codex, qui n'est pas installé sur ce serveur. » | idem, plus « demander à un admin » |
| aucun accès résolu | « Aucun accès Claude pour votre tour. » avec « Me connecter avec mon abonnement » et « Ajouter ma clé dans Perspicax », ou demander à un admin la clé de l'organisation (pour une routine: la carte va au propriétaire) | rien pour le tour d'une autre personne; pour une routine, la même carte |
| clé refusée par le fournisseur (401, quota) | « Le fournisseur a refusé la clé de ce bot. » | le message du fournisseur, caviardé (`provider-key-check.ts`) |
| profil MCP non détenu par qui parle | le bot répond sans l'outil et dit pourquoi (note système au tour) | rien |
| délégation de routine expirée (2026-10-08) | une nouvelle est émise depuis la connexion de la personne; sinon l'exécution est sautée, la routine n'est jamais suspendue | aucune carte |

Dans Mes engines et le choix d'engine, une ligne dit ce que les tours de la personne utilisent sur cet engine (« Vos tours utilisent votre abonnement », « votre clé dans Perspicax », « la clé de l'organisation », ou rien encore).

## 5. Section « Pulsa Bot » de la console Perspicax

### Pages

La barre latérale a les groupes Personnel, Équipe, Administration et Système (`console/src/components/shell.tsx:175-222`; seul l'élément choisi s'allume, jamais le groupe; le menu du compte est au pied). On ajoute un groupe `pulsabot` (« Pulsa Bot »), entre Administration et Système:

| Page | Route console | Rôle minimal | Contenu |
|---|---|---|---|
| Serveurs | `/pulsabot/servers` | admin | serveurs liés: nom, origine, version, dernier contact, santé; lier, renouveler le jeton du lien, délier |
| Bots | `/pulsabot/bots` | manager | bots de l'organisation: propriétaire, engine, profils MCP, droits (lecture); un manager ne voit que ceux de ses équipes |
| Membres | `/pulsabot/members` | manager | par personne: rôle et équipes (lecture, liens vers les pages Personnes et Équipes existantes), dernière connexion à Pulsa Bot, délégations de routines actives (révocables); un manager voit ses équipes |
| Utilisation | `/pulsabot/usage` | manager | tours, jetons de modèle et appels MCP par personne, bot et jour |
| Approbations | `/pulsabot/approvals` | employee | cartes en attente que **la personne connectée** peut trancher (décision 5), avec lien vers le fil dans Pulsa Bot |
| Audit | `/pulsabot/audit` | admin | journal d'audit de Pulsa Bot (droits, partages, propriété, lien) à côté de l'`admin_audit` de Perspicax |

Chaque page est une route paresseuse (`page(() => import(...), "Name")` dans `console/src/main.tsx`), ses styles vont dans `console/src/styles/routes.css` (l'entrée CSS est à environ 108,6 Ko sur 110), chaque route entre dans `console/e2e/routes.ts` et `docs/design/look-inventory.txt`, et marche de 360 à 430 px.

### API de Perspicax

Existant et réutilisé: utilisateurs, équipes, profils, comptes de service et rotation de leur jeton (`POST /api/v1/users/{id}/rotate-token`, `api/users.rs:178`), hôtes de redirection (`GET`/`PUT /api/v1/settings/oauth-redirect-hosts`, `api/oauth_redirect_hosts.rs`), journal filtré par `client`.

Nouveau, dans `crates/gateway/src/api/pulsabot.rs`, chaque route inscrite dans `crates/gateway/tests/route_roles.rs::DECLARED`:

| Route | Appelant | Rôle |
|---|---|---|
| `GET`, `POST /api/v1/pulsabot/servers`, `DELETE /api/v1/pulsabot/servers/{id}` | console | Admin |
| `POST /api/v1/pulsabot/servers/{id}/rotate-link` | console | Admin |
| `GET /api/v1/pulsabot/directory` (personnes, rôle, statut, équipes avec gestionnaires et membres; `ETag`) | serveur Pulsa Bot | `PulsaBotLink` |
| `GET /api/v1/pulsabot/servers/{id}/proxy/{*path}` et `POST` du même | console | Manager ou Any selon la page, puis `can()` côté Pulsa Bot |

`PulsaBotLink` est un nouvel extracteur (`api/auth.rs`): un `pxat1.` (`Via::ApiToken`) dont l'utilisateur est le compte de service d'un serveur lié, et rien d'autre. Le jeton du lien ne donne accès à aucune autre route, ni à `/mcp` hors échange de jeton.

### Console vers serveur Pulsa Bot

La console du navigateur ne parle jamais au serveur Pulsa Bot. Elle appelle le mandataire de Perspicax (même origine, cookie et CSRF double habituels). Perspicax signe une assertion ES256 de 60 s (`iss` Perspicax, `aud` origine Pulsa Bot, `sub` = la personne de la console, `act: { sub: "console" }`, `jti`) et appelle l'API d'administration du serveur Pulsa Bot (`/api/org/admin/*`, section 8) par l'URL interne du lien. Pulsa Bot vérifie avec le même JWKS que l'`id_token`, refuse un `jti` déjà vu, puis applique `can()` **au nom de la personne** de la console. Une personne en mode « voir comme » (`POST /api/v1/session/impersonate`) est refusée par le mandataire: on n'agit pas dans Pulsa Bot sous une identité empruntée.

Dans l'autre sens, le serveur Pulsa Bot appelle Perspicax avec le jeton `pxat1.` du compte de service du lien: annuaire toutes les 5 minutes (et à chaque connexion), échange de jeton.

## 6. Déploiement

### Une seule compose

Elle vit dans le dépôt privé (`<PRIVATE_REPO_NAME>/deploy/docker-compose.pulsabot.yml`, avec un `Caddyfile.pulsabot`); le dépôt Pulsa Bot la documente et garde sa propre `compose.yaml` pour le solo.

| Service | Image | Rôle |
|---|---|---|
| `perspicax` | `pulsatrix-connector:<version>` | IdP, MCP, console. `bind = "0.0.0.0:8787"`, `trusted_proxies` du réseau de la compose (`deploy/docker-compose.caddy.yml` le documente déjà) |
| `pulsabot` | `pulsa-bot-server:<version>`, construite avec `ENGINES="@anthropic-ai/claude-code @openai/codex"` (liste explicite, section 4 bis) | serveur de coordination et exécution de tous les tours; son Caddy latéral actuel (`network_mode: service:omb`, `deploy/local/Caddyfile`) reste pour garder la règle d'hôte loopback |
| `caddy` | `caddy:2.11.x` | arête: deux sites, `px.<domaine>` vers `perspicax:8787`, `bot.<domaine>` vers le Caddy de `pulsabot`. Deux noms parce que les deux produits utilisent `/api/*`. |

L'exposition réseau (DNS, Tailscale, tunnel, LAN) reste au propriétaire: la compose publie par défaut sur `127.0.0.1`, comme `compose.yaml` de Pulsa Bot (`SAGAX_BIND_ADDRESS`).

Volumes: `perspicax-config` (`gateway.db`, `state/vault.key`, `state/local_oauth/`, sauvegardes), `pulsabot-data` (`/data`: état, dossiers des bots, connexions des CLI par principal), `link` (un seul fichier, section suivante), `caddy-data`, `caddy-config`.

Variables: côté Perspicax `PXC_CONFIG_DIR`, `PXC_VAULT_KEY` ou le fichier de clé, `PXC_PULSABOT_ORIGIN=https://bot.<domaine>` et `PXC_PULSABOT_INTERNAL_URL=http://pulsabot:80` (nouveaux). Côté Pulsa Bot `SAGAX_PUBLIC_URL=https://bot.<domaine>`, `SAGAX_IDENTITY=perspicax`, `SAGAX_PERSPICAX_ISSUER=https://px.<domaine>`, `SAGAX_PERSPICAX_LINK_FILE=/link/pulsabot.json` (nouveaux), `SAGAX_IDP_VAULT_KEY_FILE` (secret Docker).

### Premier démarrage

1. `docker compose up -d`.
2. Premier admin Perspicax: `pulsatrix-connector local-auth set-password` comme aujourd'hui (`deploy/README.md`, « First run in a container »), mot de passe temporaire, changement et TOTP à la première connexion (`must_change_password`). Une amorce sans `exec` (code dans le journal, comme la tranche 1b de Pulsa Bot) est souhaitable plus tard, hors de ce document.
3. Lien automatique: au démarrage, si `PXC_PULSABOT_ORIGIN` est posé et qu'aucun serveur n'est lié à cette origine, Perspicax crée dans une transaction: le compte de service `pulsa-bot-<nom>` et son `pxat1.`, le client `pulsa-bot` avec sa redirection exacte, l'audience supplémentaire, l'hôte exact `=bot.<domaine>` dans `redirect_hosts.txt`, une ligne `admin_audit` `pulsabot.link`. Il écrit `pulsabot.json` (`issuer`, `client_id`, `server_id`, `link_token`) dans le volume `link` en `0600`.
4. Pulsa Bot lit le fichier, vérifie la découverte et le JWKS, et passe en mode organisation.
5. Pas de propriétaire d'organisation à désigner: les admins Perspicax sont les admins de l'organisation Pulsa Bot. Hors compose unique, le lien se fait depuis la console (Pulsa Bot > Serveurs > Lier), qui affiche le paquet une fois.

### Mises à jour et sauvegardes

- Perspicax d'abord, Pulsa Bot ensuite. Les changements d'IdP sont additifs (claims, routes); les migrations de Perspicax sont à sens unique (`tests/store_migrations.rs`).
- Chaque produit garde ses sauvegardes: `gateway backup` et Litestream optionnel pour Perspicax (`store/backup.rs`), l'instantané chiffré de Pulsa Bot (`server/workspace-backup.ts`). Le lien entre les deux, c'est le `sub` ULID, stable: une restauration de Perspicax plus ancienne ne réattribue pas d'identité. Un `sub` absent de l'annuaire après restauration donne un principal `disabledAt`, jamais un autre propriétaire.

### Courriel

Perspicax n'envoie aucun courriel aujourd'hui (les tables de `0023_prefs_email.sql` n'ont plus d'écrivain). Pulsa Bot n'en envoie plus en mode organisation. Un nouveau compte se crée dans Perspicax comme aujourd'hui: l'admin fixe un mot de passe temporaire, la personne le change et inscrit son second facteur à la première connexion (`must_change_password`). Aucun courriel dans Pulsa Bot.

## 7. Changements dans Perspicax

Rappels de ce dépôt: versions les plus récentes vérifiées sur crates.io au début de l'incrément, pins dans le `Cargo.toml` racine avec la date, `make ci` complet, aucun tiret long ni demi-cadratin (`make dash-check`), une ligne `route_roles` par route, `AGENTS.md` mis à jour. Ce travail inverse une partie du « Delta (MCP plane only) » de `local-oauth`: il faut l'écrire comme nouveau delta.

| # | Changement | Zones |
|---|---|---|
| P1 | Clé ES256 et JWS: génération, `kid`, signature. Crate `p256` (RustCrypto, `ecdsa`, `jwk`, `pkcs8`), cohérente avec `chacha20poly1305` et `sha2` déjà présents. | nouveau `crates/local-oauth/src/jwt.rs`; `Cargo.toml` racine; `make notices` (`legal/rust-crates.txt`) |
| P2 | Stockage de la clé: scellée par le coffre en mode gateway, fichier `0600` en mode fichier. Rotation: l'ancienne clé reste au JWKS 24 h. | migration `crates/gateway/src/store/migrations/0035_oidc_keys.sql`; `vault/rotate.rs::SEALED_COLUMNS`; `tests/vault.rs` (`every_sealed_column_of_the_migrated_schema_is_listed`); `tests/store_migrations.rs`; `store.rs` de `local-oauth` pour le mode fichier |
| P3 | `id_token` sur `authorization_code` et `refresh_token` quand `openid` est demandé: `iss`, `sub`, `aud`, `exp`, `iat`, `auth_time`, `nonce`, `amr`, `email`, `email_verified: false`, `name`, `preferred_username`, `locale`; `role` et `teams` (`[{ id, name, manager }]`), lus du modèle existant, aucun réglage nouveau. Le `nonce` et `auth_time` voyagent avec le code. | `lib.rs`: `TokenResponse` (`:2337`), `exchange_code` (`:1368`), `refresh_grant_with_client` (`:1432`), l'entrée de code de `mint_code_with_scope` (`:1268`); `routes.rs`: `authorize` et `token` |
| P4 | Source des claims: une méthode `claims(id)` sur le trait `UserStore`, implantée par la gateway (utilisateur, rôle, équipes). | `crates/local-oauth/src/store.rs`; `crates/gateway/src/oauth_store.rs` (`SqliteUserStore`, `:48`) |
| P5 | Découverte: `jwks_uri`, `id_token_signing_alg_values_supported: ["ES256"]`, `revocation_endpoint`, `backchannel_logout_supported`, le grant d'échange dans `grant_types_supported`. Nouvelles routes `/oauth/jwks` et `/oauth/revoke` (RFC 7009). | `lib.rs::Deployment::discovery_document` (`:164`); `routes.rs::router` (`:92`); `tests/branding_golden.rs` (le JSON de découverte est figé en octets) |
| P6 | Audiences supplémentaires et client premier parti: `resource` accepte `/mcp` **ou** l'origine d'un serveur lié; le client `pulsa-bot` saute le sélecteur de profil **seulement** quand sa `redirect_uri` égale exactement celle qui est enregistrée (aujourd'hui `is_first_party_console` ne regarde que `client_id`, `page.rs:1449`). | `lib.rs` (`LocalOauthRuntime`, `resolve_mint_audience_any` `:385` déjà écrit); `routes.rs` (`authorize_audience`, `resolve_linked_scope` `:346`, la vérification de `resource` au jeton `:1321`); `page.rs` |
| P7 | Échange de jeton RFC 8693 sur `/oauth/token`, client `pulsa-bot-server` authentifié par le `pxat1.` du lien, au-dessus de `mint_internal_access_token`; événement `token_exchanged` dans `auth_events`. | `routes.rs::token`; `lib.rs`; `crates/gateway/src/hooks.rs` (journal); `model/journal.rs` |
| P8 | Désactivation: `set_status(Disabled)` révoque aussi les jetons OAuth locaux (`revoke_tokens_for_identity`, `lib.rs:1777`) et déclenche la déconnexion par canal arrière vers chaque serveur lié. TODO(verify): aujourd'hui `set_status` révoque les lignes `sessions` (`model/users.rs:616`) mais ce chemin ne touche pas le document `local_oauth_tokens`, et `validate_access_token` ne relit pas le statut. | `model/users.rs::set_status`; `api/users.rs::set_status` (`:277`); nouveau `crates/gateway/src/pulsabot_push.rs` |
| P9 | Serveurs liés: table, lien automatique au démarrage, API, extracteur `PulsaBotLink`, mandataire signé vers Pulsa Bot. | migration `0036_pulsabot_servers.sql`; nouveaux `model/pulsabot.rs`, `api/pulsabot.rs`; `api/mod.rs`; `api/auth.rs`; `crates/connector/src/boot.rs` (lien automatique); `crates/gateway/openapi.json` et `console/src/api/schema.d.ts` (`make console-types`); `tests/route_roles.rs` |
| P10 | Clés de fournisseur des propriétaires de bots: un type d'identifiant « fournisseur de modèle » (`scope: user`) dans le coffre existant, et une lecture par le lien au moment d'un tour ou d'une routine (tranche 4, section 4 bis). | `model/credentials.rs`, `model/credential_slots.rs`, `api/pulsabot.rs` |
| P11 | Console: groupe `pulsabot` et ses six pages, sur la coquille existante. | `console/src/components/shell.tsx`; nouveaux `console/src/pages/pulsabot/*.tsx`; `console/src/main.tsx`; `messages.en.ts` et `messages.fr.ts` (`nav.pulsabot.*`); `console/src/styles/routes.css`; `console/e2e/routes.ts`; `docs/design/look-inventory.txt` |
| P12 | Déploiement: la compose unique et son Caddyfile, section du README. | `deploy/docker-compose.pulsabot.yml`, `deploy/Caddyfile.pulsabot`, `deploy/README.md` |

## 8. Changements dans Pulsa Bot

### Nouveau

| Module | Rôle |
|---|---|
| `server/oidc-rp.ts` | découverte, PKCE, `state` et `nonce` en mémoire (10 min, usage unique, 20 au plus comme `MAX_PENDING_FLOWS`), échange du code, vérification ES256 par `node:crypto`, cache JWKS |
| `server/idp-session.ts` | coffre des refresh Perspicax, rafraîchissement en vol unique, déconnexion par canal arrière, révocation |
| `server/perspicax-link.ts` | lecture du fichier de lien, annuaire (ETag), client d'échange de jeton |
| `server/authz.ts` | `can()` (section 3) |
| `server/perspicax-mcp-bridge.ts` | le pont stdio (section 4), sur le patron de `connector-proxy.ts` et `mcp-bridge.ts` |
| Routes | `GET /auth/oidc/start`, `GET /auth/oidc/callback`, `POST /api/auth/oidc/backchannel-logout`, `POST /api/org/import`, `/api/org/admin/*` (assertion de la console), `POST /api/org/routine-delegation` |
| `server/engines/engine-credentials.ts` | résolution de l'accès d'un tour (section 4 bis): clé de routine, `credentialRef`, abonnement du propriétaire qui lance, clé du propriétaire lue dans le coffre de Perspicax par le lien, clé d'organisation si permise |
| Connexions par principal | `server/engines/claude-accounts.ts` et `server/engines/provider-auth-sessions.ts`: en organisation, un dossier de connexion par principal sous `/data/principals/<id>/`, au lieu du dossier commun |
| Cartes d'échec | engine absent, aucun accès, clé refusée, profil non détenu, délégation expirée (section 4 bis); au lieu d'un tour vide |
| Création de bot par un membre | `POST /api/bots` et `memberBotFieldViolation` de la branche `fix/member-identity`; le formulaire ne propose que les engines installés et les options qui existent sur le serveur |
| Santé | `/api/health` liste les engines installés et leur version |
| `server/environment.ts` | `identity: { kind: "oidc", issuer }` dans le descripteur |
| Web | bouton Perspicax dans `src/pair/PairPage.tsx`; `src/components/OrganizationSettings.tsx` montre le lien, le rôle et « Gérer dans Perspicax » |
| Bureau | `electron/main.mjs` (`open-url` pour le lien `auth` de l'ancien schéma d'URL, `sagax://auth` aujourd'hui), `electron/environments.cjs` (analyse du retour), « Rejoindre un serveur Perspicax » |
| Téléphone | `ios/Sources/CompanionCore/DeepLink.swift` et l'équivalent Android pour le lien `pair?origin=…` de l'ancien schéma d'URL (`sagax://pair` aujourd'hui); `ASWebAuthenticationSession` et Custom Tabs (tranche 2) |

### Gardé, adapté, retiré

| Code intérim | Sort |
|---|---|
| `principals.ts` | gardé; `subject`, `forSubject`, `linkedSubjects`, `disabledAt` |
| `identity-migration.ts` | gardé; plus une table de réécriture explicite pour l'import solo vers organisation |
| `sessions.ts` | gardé; champ `idp`; appairage sans principal refusé en organisation |
| `request-auth.ts` | gardé; le serveur d'organisation tourne en `LoopbackTrust` `service` |
| `org-record.ts` | adapté: `identity: { kind: "perspicax", issuer, serverId }`; l'organisation naît du lien, plus de `createOrg` par formulaire; `ownerUserId`, `issueInvite` et `memberListsAfterAccept` retirés |
| `org-directory.ts` | `roleOf` remplacé par les claims; invitations retirées |
| `org-routes.ts` | `GET /api/org` et le nom gardés; liste des personnes et invitations retirées; état du lien ajouté |
| `channel-visibility.ts`, `direct-grants.ts` | absorbés par `authz.ts`, tests conservés; un droit peut viser `team:<ulid>` |
| `mcp-oauth.ts` | gardé pour les MCP tiers; coffre indexé par `(principalId, name)` en organisation; ses utilitaires servent à `oidc-rp.ts` |
| `email-otp.ts`, `mailer.ts`, `mail-config.ts`, `account-signin.ts`, `src/pair/JoinPage.tsx`, `SignInAccessCard.tsx`, `compose.mail-test.yaml` | retirés à la dernière tranche, après que plus rien ne les appelle; d'ici là refusés en organisation |
| `electron/control-plane-client.mjs` | hors sujet (le tunnel `server/tunnel.ts` l'utilise encore) |
| `server/viewer-identity.ts` (branche `fix/member-identity`) | gardé, nourri par les claims |

## 9. Revue de sécurité

| # | Menace | Mesure |
|---|---|---|
| T1 | Fuite d'un jeton vers un engine (configuration MCP, variables, transcript, `ps`) | pont stdio; aucun jeton dans la configuration de l'engine; jeton MCP de 15 min au plus, révoqué en fin de tour; caviardage existant (`redact.ts`) |
| T2 | Adjoint confus: jeton de connexion rejoué sur `/mcp`, ou jeton MCP rejoué ailleurs | audiences distinctes (origine Pulsa Bot contre `/mcp`), vérifiées par `validate_access_token`; échange limité aux profils détenus (`scopes::grant`); MCP sous l'identité de qui parle, pas du propriétaire |
| T3 | Refresh volé sur un poste | le bureau et le téléphone ne tiennent jamais de jeton Perspicax (BFF); la session Pulsa Bot est HttpOnly ou dans Keychain / Keystore, révocable; rotation et détection de réutilisation de Perspicax (famille révoquée hors des 30 s de grâce) |
| T4 | Interception sur le schéma d'URL de l'app (l'ancien schéma à l'époque, `sagax://` aujourd'hui) | il ne porte qu'un identifiant d'appairage Pulsa Bot de 2 min, usage unique, haché, verrouillé par source; le PKCE de la jambe Perspicax reste sur le serveur |
| T5 | Vol du jeton du lien (`pxat1.`) | extracteur `PulsaBotLink` borné à l'annuaire et à l'échange; fichier `0600` ou secret Docker; rotation (`rotate-link`); l'échange exige aussi un `subject_token` valide de la personne, donc le lien seul ne donne aucun accès MCP |
| T6 | Rejeu d'une assertion de la console | ES256, 60 s, `aud` exact, `jti` mémorisé jusqu'à expiration; mandataire refusé en « voir comme » |
| T7 | Pouvoir des admins Perspicax sur Pulsa Bot, et des gestionnaires sur les bots | l'admin Perspicax est la racine de confiance: il peut créer un compte, réinitialiser un second facteur, donc devenir n'importe qui. Accepté et écrit. Mesures: toute action d'identité est à l'`admin_audit` de Perspicax, toute action de droits à l'audit de Pulsa Bot, la page Audit les montre côte à côte; un admin n'obtient pas `bot.use` sur un Direct privé sans droit; un gestionnaire n'administre que les droits qui visent ses équipes; le propriétaire d'un bot ne peut rien élever dans Perspicax |
| T8 | Compte désactivé qui garde l'accès | déconnexion par canal arrière immédiate; rafraîchissement au plus tard 50 min; P8 révoque les jetons OAuth locaux à la désactivation |
| T9 | Hameçonnage par un client qui prétend être premier parti | saut du sélecteur et de l'avis de destination seulement si `client_id` **et** `redirect_uri` exacte correspondent; hôte exact dans la liste de redirection |
| T10 | Falsification d'un `id_token` | `alg` fixé à ES256, `none` refusé, `kid` connu, `iss`, `aud`, `exp`, `nonce`; JWKS en HTTPS seulement (sauf loopback de test) |
| T11 | Compromission de la clé de signature | scellée par le coffre, `kid`, rotation avec chevauchement, `gateway rotate-vault` la couvre (P2) |
| T12 | Compromission du serveur Pulsa Bot | il tient les refresh de toutes les sessions et délégations: jetons scellés, clé en secret Docker; bouton « Révoquer tous les jetons de ce serveur » dans la console (par `client_id`); jetons MCP courts |
| T13 | Shell d'un bot qui appelle le harness en loopback | risque déjà écrit dans `request-auth.ts` (`SERVICE_ALLOW`); en organisation, `LoopbackTrust` `service` partout, et la route qui donne un jeton au pont exige la capacité du tour |
| T14 | Rattachement par courriel d'un principal intérim | une seule fois, pendant la période de migration, écrit à l'audit, puis coupé |
| T15 | Clé d'un propriétaire lue par le shell d'un autre bot du même conteneur | clé injectée au seul tour qui la demande, jamais dans `config.json`; accès complet sans carte refusé aux bots des membres jusqu'au conteneur par propriétaire (décision 8) |

## 10. Tranches

Chacune se livre seule, avec ses tests, dans l'ordre. Les tranches Perspicax passent `make ci`; les tranches Pulsa Bot suivent `docs/verification/README.md` (instance isolée, jamais l'app ou les données réelles).

1. **Connexion Perspicax, bout à bout.**
   Perspicax: P1, P2, P3 (claims de base: `sub`, `email`, `name`, `preferred_username`, `role`; `teams` peut attendre la tranche 4), P5 (JWKS, découverte), P6 pour une origine donnée par `PXC_PULSABOT_ORIGIN`.
   Pulsa Bot: `oidc-rp.ts`, `/auth/oidc/start` et `/callback`, `forSubject`, session avec `principalId`, `role` vers scopes (`admin` donne `["admin", "client"]`, les autres `["client"]`), bouton sur `/pair`, descripteur `identity`, refus du courriel et des invitations quand `SAGAX_IDENTITY=perspicax`. Bureau: flux dans la fenêtre. Téléphone: QR d'appairage lié au principal (existant).
   Engine: l'image construite avec Claude Code et Codex; accès par la connexion ou la clé posée par l'admin dans Réglages > Connections (existant); A est admin dans cette tranche.
   Preuve: une compose de développement avec les deux; un compte Perspicax créé par la CLI se connecte au web de Pulsa Bot; `GET /api/auth/session` montre le principal, le courriel et le rôle; le jeton de connexion est refusé par `/mcp` (401); scénario A ci-dessous.
2. **Cycle de vie de la session.** Rafraîchissement, `/oauth/revoke`, déconnexion, canal arrière et P8, navigateur système sur le bureau, OIDC natif sur le téléphone.
3. **Lien, annuaire et premier partage.** P9, lien automatique, `perspicax-link.ts`, principals créés depuis l'annuaire, compose unique (P12), page console Serveurs. Partage minimal avec un **utilisateur**: les `directGrants` existants (`direct-grants.ts`, `canSeeDirectBot`), qui visent déjà des principals, choisis dans l'annuaire, avec retrait; création de bot par un membre (`fix/member-identity`); cartes d'échec; les tours partagés utilisent la clé d'organisation que l'admin a permise. Preuve: scénarios B et C pour un utilisateur.
4. **Droits et accès des propriétaires.** `authz.ts`, claim `teams`, droits visant une équipe Perspicax, partage administré par les gestionnaires pour leurs équipes, niveaux par bot, page Membres; clés du propriétaire dans le coffre de Perspicax (P10) et `engine-credentials.ts`, abonnements par principal. Preuve: scénarios B et C complets (utilisateur et équipe).
5. **MCP automatique.** P7, pont stdio, profils par bot, identité de qui parle, provenance au journal. Preuve: scénario E.
6. **Routines au nom du propriétaire.** Délégation, `runAs`, clé du propriétaire (P10, déjà là depuis la tranche 4), révocation depuis les deux côtés. Preuve: scénario D.
7. **Console Pulsa Bot complète.** Bots, Utilisation, Approbations, Audit, mandataire signé.
8. **Solo vers organisation et ménage.** « Rejoindre », copie des bots, réécriture des personnes, rattachement intérim; retrait du code intérim de la section 8.

Choix d'ordre: le partage avec un utilisateur avance à la tranche 3, parce qu'il réutilise les `directGrants` existants et ne dépend que de l'annuaire, livré dans la même tranche. Le partage avec une équipe et les niveaux attendent `authz.ts` (tranche 4). Les clés du propriétaire (P10) passent de la tranche 6 à la tranche 4, pour que les tours partagés ne dépendent pas de la clé d'organisation plus longtemps que nécessaire; la tranche 6 les réutilise.

### Critères d'acceptation

Scénarios de bout en bout, joués sur la compose unique de développement (instance isolée, `docs/verification/README.md`), avec des comptes Perspicax créés pour le test: A (propriétaire), B (autre utilisateur), C (membre de l'équipe T), D (hors de T, sans droit).

| # | Scénario | Attendu | Tranche |
|---|---|---|---|
| A | A se connecte par Perspicax au web, crée un bot sur le serveur, lui écrit | la réponse est produite par un engine du conteneur `pulsabot` (le journal du serveur montre le tour, aucun harness local n'est lancé); le fil est lisible depuis un autre navigateur de A | 1 |
| B | A partage le bot avec B (utilisateur) puis avec l'équipe T | B et C voient le bot dans leur liste, lui écrivent et obtiennent une réponse produite sur le serveur avec l'accès de A (ou la clé d'organisation permise); D ne le voit ni dans la liste, ni dans la recherche, ni par l'URL directe (403 ou 404), ni dans le flux SSE | 3 pour B, 4 pour T |
| C | A retire le partage de B, puis retire C de l'équipe T dans Perspicax | tout de suite: le flux SSE de B se ferme ou cesse de recevoir les trames du bot, sa requête suivante reçoit 403; C perd l'accès au prochain rafraîchissement des claims ou de l'annuaire (au plus 5 min), puis 403 | 3 pour B, 4 pour C |
| D | A crée une routine horaire, se déconnecte de tous ses appareils | la routine s'exécute sur le serveur à l'heure, avec l'accès et la délégation de A; son résultat est dans le fil au retour de A; désactiver A dans Perspicax la suspend | 6 |
| E | B écrit au bot de A, qui a un profil MCP Perspicax | les appels MCP apparaissent dans le journal de Perspicax sous l'utilisateur B, client `pulsa-bot:<server id>`, `client_name` « Pulsa Bot (<bot id>) »; si B ne détient pas le profil, l'outil est absent et le bot le dit | 5 |
| F | le bot de A utilise un engine sans accès résolu | B reçoit la carte « aucune clé » dans le fil, A reçoit l'avis; aucun tour vide | 3 |

## 11. Positions et questions pour the owner

Positions retenues (recommandation acceptée sauf avis contraire):

- **Invités:** pas de concept propre. Une personne externe est un compte Perspicax créé par un admin, dans l'équipe voulue, avec second facteur.
- **Identité du MCP quand quelqu'un parle au bot d'un autre:** celle de qui parle; celle du propriétaire seulement pour ses routines. L'inverse donnerait à tout utilisateur d'un bot l'accès ConnectWise de son propriétaire.
- **Administration de l'organisation:** les admins Perspicax. Aucun propriétaire d'organisation distinct; chaque bot garde son propriétaire humain.
- **Courriel:** aucun dans Pulsa Bot. Les comptes se créent dans Perspicax, avec son mot de passe temporaire et son premier accès existants.
- **Compose unique:** dans `<PRIVATE_REPO_NAME>/deploy/`; Pulsa Bot garde sa compose solo et pointe vers l'autre.
- **Rejoindre avec des bots locaux:** copier, puis offrir le retrait local bot par bot; fils et mémoire au choix par bot.
- **Bots sans propriétaire humain:** pas en v1; les comptes de service servent au lien.

Questions encore ouvertes:

1. **Durée d'une délégation de routines.** Recommandation: 30 jours glissants renouvelés par chaque exécution, visible et révocable des deux côtés, coupée à la désactivation. Alternative plus stricte: 90 jours fixes puis nouveau consentement.
2. **Portée d'un gestionnaire sur les bots de ses équipes.** Recommandation: il administre les droits qui visent ses équipes ou leurs membres, sans lire le Direct privé d'un bot qu'on ne lui a pas ouvert. Alternative: il obtient `use` sur tous les bots partagés avec ses équipes.
