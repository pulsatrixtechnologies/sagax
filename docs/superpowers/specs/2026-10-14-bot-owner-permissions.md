# Permissions des bots : droits du propriétaire, modes et règles par personne

Date : 2026-10-14. Responsable : Owner. Statut : implanté dans
`feat/bot-owner-permissions` (Sagax). Perspicax : aucun changement serveur
requis (voir section 9).

Plainte de the owner : « un bot créé par un utilisateur doit être capable de faire
des choses ; là, TOUT ce qu'un bot fait spamme un admin d'approbations. »

## 1. État d'avant (cause du spam admin)

- Les cartes d'approbation vont déjà au **propriétaire** du bot
  (`server/approvals/approval-audience.ts` : `approvalAudience` = `ownerUserId`).
- Mais sur un serveur d'organisation, un bot dont le propriétaire n'est pas
  admin (`memberOwnedBot`) passe chaque carte par
  `memberBotAdminApproval` (`server/engine-access.ts`). Cette fonction
  marquait `adminApproval: true` **tout** sauf deux cas : un outil de
  fichier qui reste dans l'espace de travail du bot, et un outil `agents`
  de la liste revue (`server/member-tool-scope.ts`). Donc chaque outil MCP
  (ConnectWise par Perspicax, BookStack, le serveur MCP distant du
  propriétaire), chaque recherche web, etc. devenait une carte d'admin.
- Une carte `adminApproval` :
  - n'est répondue que par un admin d'organisation (`adminApprovalCheck`,
    403 `admin_approval_required` pour le propriétaire) ;
  - force le niveau `ask` (`autoVerdict(adminApproval ? "ask" : ...)`) ;
  - ignore les règles « Toujours permettre » (`ruleAllowed` exige
    `!adminApproval`), ne propose ni `allowKey` ni `allowSession`
    (`!memberAsker`) ;
  - est annoncée aux admins (`scheduleAdminApprovalsAnnounce`) et listée
    dans la file `GET /api/org/admin/approvals` de chaque admin.
- `POST /api/bots/:id/always-allow` refusait aussi tout bot d'un membre
  (`memberOwnedInOrg(bot)`), même pour une carte qui n'était pas d'admin.
- Les règles existantes : `BotRecord.alwaysAllow` (clés `mcp:<serveur>__<outil>`
  et clés entre coéquipiers), **par bot**, n'importe quels arguments,
  pour toutes les conversations du bot. La liste de commandes exactes
  (`commandAllowlist`) est par bot aussi. Rien n'est par personne.
- Perspicax : le proxy `api/pulsabot_proxy` relaie seulement les décisions
  de Sagax (file `approvals`, réponse console). `writeApprovals` (#309) est
  une politique optionnelle par **compte MCP dédié** (fichier
  `write_approvals.yaml`), pas par bot Sagax : un bot Sagax appelle
  Perspicax avec les jetons de la personne (conversation) ou du propriétaire
  (routine). Ce n'est pas la source du spam.

## 2. Modèle de droits

Un bot agit avec les droits de son propriétaire. Une action est de l'une de
deux sortes :

- **Dans les droits du propriétaire** (route `owner`) : elle passe par
  l'identité du propriétaire ailleurs, qui garde ses propres limites
  (Perspicax applique DAP #288, les holds de profil `needs_confirmation`,
  les jetons de la personne). C'est :
  - un outil MCP d'un serveur **distant** monté pour ce bot ou d'une
    connexion personnelle du propriétaire (sur un serveur d'organisation,
    un serveur MCP commande n'est jamais monté, `withoutHostCommands` ; une
    connexion personnelle commande tourne dans l'environnement de la
    personne) ;
  - un outil `agents` de la liste revue (inchangé) ;
  - un outil de fichier dans l'espace de travail du bot (inchangé) ;
  - une recherche web (`WebSearch`), la liste de tâches (`TodoWrite`).
- **Au delà des droits du propriétaire** (route `admin`) : ce qui touche
  l'hôte partagé (un conteneur, un utilisateur, un HOME pour tous les bots
  jusqu'aux conteneurs par propriétaire) :
  - une commande sur le serveur (`Bash`, `shell`, `exec`...) ;
  - un fichier hors de l'espace de travail ou dans un dossier point ;
  - un outil `agents` de niveau hôte (`act`, `add_mcp_server`,
    `attach_file`, `vm_exec`, ...) ;
  - un outil MCP d'un serveur intégré de niveau hôte (`computer`,
    `sagax-computer`, `sagax-desktop`, `browser`, `shell`, `files`) ou d'un
    serveur inconnu ;
  - tout outil non classé (`other`, `WebFetch` qui sort du réseau de
    l'hôte, etc.). On ferme par défaut.

Seule la route `admin` donne une carte `adminApproval`. Un bot dont le
propriétaire est admin n'a jamais de route `admin` : l'admin propriétaire
est un propriétaire comme un autre (section 8).

## 3. Routage des approbations

| Situation | Qui reçoit la carte | Règles, modes |
|---|---|---|
| Route `owner` (tout serveur) | Le propriétaire | Ses règles et le mode du bot s'appliquent |
| Route `admin` (membre, serveur d'org) | Les admins d'org | Aucune règle, aucun mode : une fois, par un admin |
| Hold de sécurité (`safetyHold`, #365) | Le propriétaire | Jamais répondu par une règle ni un mode |
| Élargissement du bac à sable du fournisseur | Le propriétaire | Seul Full (bot d'admin) le répond |
| Question du bot | La personne | Jamais répondue pour elle |
| Tour piloté par un invité (Cloud) | Le propriétaire | Ask, aucune règle |

Les holds de Perspicax (DAP, `needs_confirmation`, `writeApprovals`) restent
appliqués **par Perspicax** après la décision de Sagax : aucune règle ni
aucun mode de Sagax ne les répond.

## 4. Modes par bot (choisis par le propriétaire)

Stockés hors du bot dans `owner-approvals.json` (`modes[botId]`), avec le
propriétaire qui les a choisis : si le bot change de propriétaire, le mode
retombe à **Approbation**.

- **Approbation** (`approval`, défaut) : une règle « Toujours permettre »
  approuve, une règle « Refuser » refuse, tout le reste fait une carte au
  propriétaire.
- **Approbation automatique** (`auto`) : applique les règles, puis approuve
  automatiquement ce qui n'a **aucune règle** et n'est pas destructif. Une
  règle « Demander chaque fois » fait encore une carte. Une action
  destructive sans règle « Toujours » explicite fait encore une carte. Le
  journal (`decisions`) garde chaque approbation (`source: owner-auto`).
- **Bypass** (`bypass`, opt-in explicite) : aucune carte pour les actions de
  la route `owner`, même avec une règle « Demander chaque fois » ; seul le
  journal (`source: owner-bypass`). Une règle « Refuser » refuse encore (le
  refus gagne toujours, comme Grok). Les actions destructives exigent encore
  une règle « Toujours » explicite. L'activer exige `confirmBypass: true`
  (avertissement à l'écran), la permission `bots.fullAccess` et la politique
  d'organisation qui permet l'accès complet ; le changement est audité
  (`bot.permission-mode`). Si la politique d'organisation tombe ou si le
  propriétaire perd `bots.fullAccess`, le bot repasse en Approbation au
  moment de la décision (`effectivePermissionMode`).

Aucun mode ne contourne : la route `admin`, les holds de sécurité, DAP et
les holds de profil de Perspicax, les droits du propriétaire (ses jetons),
les questions, l'élargissement du bac à sable, un tour d'invité.

Les niveaux du fournisseur (`approvalMode` : Ask, Auto, Full, Custom)
restent ce qu'ils sont : ils décident ce que le moteur laisse à Sagax. Le
mode du propriétaire décide ensuite ce que Sagax fait d'une carte de la
route `owner`.

## 5. Règles par personne

Comme the reference design : on commence ultra restrictif, chaque carte propose
**Refuser**, **Toujours refuser**, **Toujours permettre**, **Permettre une
fois**, et les règles rendent le bot plus permissif au fil du temps.

```ts
interface OwnerRule {
  id: string;
  ownerId: string;          // la personne qui l'a créée (le propriétaire)
  botId: string | null;     // null = tous mes bots
  tool: string;             // outil normalisé : "perspicax__cw_psa_write", "WebSearch"
  scope: Record<string, string>; // portée : cible tirée des arguments
  destructive?: "delete" | "bulk" | "external-message";
  behavior: "allow" | "ask" | "deny";
  description: string;      // langage clair, éditable
  createdAt: number; updatedAt: number;
}
```

- **Granularité** : l'outil plus une portée tirée des arguments, jamais
  « tout cet outil » par défaut. Clés de portée retenues (dans l'ordre,
  4 au plus) : `api`, `resource` (sans l'id final : `service/tickets/123`
  devient `service/tickets`), `operation` / `method`, `verb` / `action`,
  `repo`, `server`, `domain`, hôte d'une `url`, `board`, `channel`, `to`.
  `api`, `resource` et `verb` sont les trois parties de la clé par ressource
  du registre MCP de la PR #508 (`cw:ticket.update`) : une règle faite sur
  une carte `api_write` de la passerelle vise la même clé (section 11). Une portée vide veut dire
  « n'importe quelle cible » ; le propriétaire peut l'élargir en éditant.
- **Appariement** : même propriétaire, même bot (ou `botId: null`), même
  outil, et chaque clé de la portée de la règle égale (sans casse) à celle
  de l'appel. Le refus gagne sur « Demander », qui gagne sur « Permettre ».
- **Destructif** : suppression (risque `destructive` de
  `describeApproval`), lot (2 ids ou plus, ou un outil `bulk`/`batch`),
  courriel ou SMS externe (`isOutboundTool`). Une règle « Permettre » ne
  couvre une action destructive que si elle a été créée pour **ce type**
  (`destructive` égal). Jamais implicite, dans aucun mode.
- **Retenues par personne** : stockées par `ownerId`. Une règle d'Alice ne
  répond jamais pour un bot de Bob, même pour le même outil. Un membre avec
  qui le bot est partagé ne crée pas de règle : seul le propriétaire répond
  aux cartes et donc crée les règles.
- **Stockage** : `owner-approvals.json` (mode 0600) dans le dossier de
  données, `{ version: 1, rules: OwnerRule[], modes: {...} }`, 2 000 règles
  au plus par personne.
- **Description** : générée au « Toujours » avec les mots de la carte
  (`approvalAction` de `shared/approval-describe.ts`) plus la portée, ex.
  « Mettre à jour des billets dans ConnectWise PSA (service/tickets, update) ».

## 6. Migration des règles existantes

- `BotRecord.alwaysAllow` reste lu tel quel (barrière Grok, revue entre
  coéquipiers, cartes de barrière) : rien ne régresse.
- La page des règles montre ces clés comme règles « migrées » du
  propriétaire du bot (`legacy: true`, portée vide, « Permettre
  automatiquement »). Supprimer une règle migrée retire la clé du bot et de
  ses conversations ; la modifier la convertit en règle par personne et
  retire la clé.

## 7. Interface

- **Carte d'approbation** (compositeur, `PendingApprovalActions`) : quand
  la carte porte `ownerRule` (route `owner`, pas une proposition), boutons
  Refuser, Toujours refuser, Toujours permettre, Permettre une fois. Le reçu
  dit « Ajouté à vos règles ». Une carte d'admin garde son attente.
- **Permissions du bot** (`PermissionsSection`) : sélecteur Approbation /
  Approbation automatique / Bypass, avec boîte d'avertissement avant Bypass ;
  visible au propriétaire, même sans `bots.approvalLevel`.
- **Règles** (même section) : tableau à deux colonnes **Action** /
  **Comportement**, comme la référence. L'action est la description en langage
  clair (« Afficher plus » au delà de deux lignes) ; le comportement :
  Permettre automatiquement, Demander chaque fois, Refuser. À droite :
  modifier (crayon : description, comportement, ce bot ou tous mes bots,
  n'importe quelle cible) et supprimer (corbeille).
- Routes : `GET /api/approval-rules?botId=`, `PATCH /api/approval-rules/:id`,
  `DELETE /api/approval-rules/:id`, `GET|PUT /api/bots/:id/permission-mode`.
  Toutes : le propriétaire seulement (session ou opérateur local, jamais un
  service local ni un jeton de tour).

## 8. Sécurité

- Un jeton interne de tour ne crée, ne modifie ni ne supprime une règle et
  ne change pas le mode : les routes exigent la personne propriétaire. La
  copie de session d'un `act` (« Bot act », `isBotActSession`) agit comme la
  personne ailleurs, mais n'est jamais la personne ici (`ruleManager`) : un
  bot ne sauve pas de règle en répondant à sa propre carte.
- Bypass : opt-in explicite, avertissement, permission `bots.fullAccess` et
  politique d'org ; chaque approbation est journalisée ; retombe à
  Approbation au changement de propriétaire.
- Bots qui créent des bots : profondeur max 1 (Perspicax #321) ; un bot créé
  par un bot appartient à la même personne et part en mode Approbation, sans
  règle propre ; les règles de la personne avec `botId: null` s'y
  appliquent, celles d'un autre bot non.
- Journal : chaque décision par règle ou par mode est une ligne `decisions`
  (`owner-rule`, `owner-rule-deny`, `owner-auto`, `owner-bypass`) avec la
  règle (`rule: <id>`).
- **Admin propriétaire** : ses bots n'ont jamais de route `admin` ; il est
  sollicité comme propriétaire, avec ses règles et son mode, et comme admin
  seulement pour la route `admin` des bots des membres.

## 9. Perspicax

Aucun changement serveur requis : la file console relaie `kind`
(`owner`/`admin`) calculé par Sagax, qui ne marque plus `admin` que la route
`admin`. `writeApprovals` reste une politique de compte MCP dédié. Suite
possible (hors de ce chantier) : un approbateur `bot_owner` dans
`write_approvals.yaml` quand un bot aura son propre compte MCP.

## 10. Tests

`server/approvals/owner-approval.test.ts` (pur) et `server/engine-access.test.ts` :
Toujours / Une fois / Refuser, retenu par personne, pas partagé entre
personnes, destructif exige une règle explicite, mode auto, mode bypass
journalisé, rien ne contourne la route admin ni les holds, admin sollicité
seulement au delà des droits, mode qui retombe au changement de
propriétaire.

## 11. Recouvrement avec la PR #508 (registre MCP `resource:verb`)

La PR #508 (`feat/mcp-permissions-coverage`, ouverte le 2026-10-14, mode
shadow) ajoute `server/mcp/mcp-permissions.ts` : une permission par outil
Sagax (`memory:save`, `api:write`), des rôles (viewer, member, operator,
admin, service), des portées self/team/org, une liste de refus
`SAGAX_MCP_DENY` par clé de ressource (`cw:ticket.*`) et un audit par appel.

Ce ne sont pas deux systèmes concurrents, ce sont deux couches dans l'ordre :

1. **#508, garde de rôle** (qui peut appeler quel outil, à quelle portée) :
   décide avant tout. Un refus en mode enforce n'atteint jamais une carte.
2. **Ce chantier, approbation** (ce qui passe la garde : qui répond à la
   carte, et les règles et le mode du propriétaire qui la répondent
   d'avance).

Alignements faits ici : la portée d'une règle lit `api`, `resource` et
`verb` / `action` comme `resourceKeyForCall`, donc une règle « Toujours »
et une clé de refus de #508 nomment la même cible. À faire après la fusion
de #508 (pas dans cette branche, pour ne pas dépendre d'une PR ouverte) :

- calculer la cible d'une règle avec `resourceKeyForCall` quand l'outil est
  `api_query` / `api_write` / `api_action`, et afficher la clé dans la page
  des règles ;
- qu'un refus `SAGAX_MCP_DENY` (organisation) gagne sur une règle
  « Toujours permettre » de personne, comme le refus gagne déjà ici ;
- l'audit : #508 écrit `mcp.call` / `mcp.deny` (catégorie `security`), ce
  chantier écrit `approval.rule.*` et `bot.permission-mode` (catégorie
  `approval`) et les lignes `decisions` (`owner-rule`, `owner-auto`,
  `owner-bypass`, `owner-rule-deny`) : garder les deux, sans fusionner les
  catégories ;
- la permission `approvals:answer` (outil `answer_approval` de #508, route
  `/api/threads/:id/respond`) passe par les mêmes contrôles que l'humain :
  un jeton de tour n'est jamais le propriétaire (`ruleManager`), donc un bot
  ne peut ni créer de règle ni changer son mode.
