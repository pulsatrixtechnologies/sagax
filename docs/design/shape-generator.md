# Générateur de formes de mascotte (retiré de l'UX, conservé dans le projet)

Décision de JC (2026-11-01) : le générateur de formes n'apparaît plus nulle
part dans l'app. Le moteur, le format portable et le code de génération restent
dans le repo pour produire une nouvelle forme plus facilement. Ce document dit
comment tout fonctionne et comment en ajouter une.

## Ce qui a été retiré

- Desktop et web : la carte « Objects » de l'éditeur de mascotte
  (`MascotLookEditor.tsx`) avec JSON, SVG, Share link, Import JSON et Generate
  shape. L'ancien `ShapeAvatarPanel.tsx` est supprimé (voir l'historique git
  avant le commit `feat/hide-shape-generator` si on veut recopier l'UI).
- iOS : `ShapeAvatarEditorPanel` (presets d'objets, aperçu d'humeur, export,
  partage, import, génération) retiré de `CharacterEditor`. Les huit objets
  restent choisissables dans la grille de formes.
- Outil bot `generate_shape_avatar` : retiré du catalogue agents, de la
  permission `shapes:generate` et du groupe `extras`. Aucun bot ne l'offre.
- Clés de locale `mascot.shape.{import,export,exportSvg,exportJson,shareLink,
  generate,generatePlaceholder,generateHint,importError,importOk,objects}`.

## Ce qui reste (le moteur et le chemin de génération)

| Quoi | Où |
|---|---|
| Format portable (schéma v1, validation, compile, partage) | `shared/shape-avatar-def.ts` |
| Presets d'objets (pad, cup, bulb, say, sprout, tin, tome, ship), SVG fixe | `shared/shape-avatar-presets.ts` |
| Génération (mots-clés, prompt modèle, parse, repli) | `shared/shape-avatar-generate.ts` |
| Module serveur (re-exporte la génération, définition d'outil) | `server/shape-avatar.ts` |
| Route interne de génération | `/api/internal/shape-avatar/generate` |
| Contour vivant à partir d'une définition | `shared/shape-avatar-outline.ts` |
| Géométrie partagée (64 rayons par corps, ancres de visage, yeux, peaux) | `shared/mascot-geometry.json` |
| Moteur desktop | `src/components/shape-*.ts`, `ShapeMascot.tsx` |
| Moteur iOS | `ios/Sources/CompanionCore/ShapeEngine*.swift`, `ShapeAvatar*.swift`, `ShapeMascotView.swift` |
| Données iOS générées | `ios/Sources/CompanionCore/ShapeGeometryData.swift` |
| Cuisson des objets en rayons | `scripts/bake-object-shapes.mjs` |
| Script de génération pour développeur | `scripts/generate-shape.mjs` |
| Captures et contrôles visuels | `scripts/capture-shapes.mjs`, `src/gallery/shape-set.html` |

`server/shape-avatar.ts` garde `GENERATE_SHAPE_AVATAR_TOOL` : c'est la
définition d'outil, appelable par un script, mais elle n'est plus branchée au
catalogue. Pour remettre l'outil dans les bots, recréer l'entrée dans
`server/drivers/agents-catalog.ts`, la ligne `shapes:generate` de
`server/mcp-permissions.ts`, la branche d'appel dans `agents-call.ts` (elle
appelait `runGenerateShapeAvatarAsync`), puis regénérer la politique d'outils
et les goldens (voir plus bas).

## Comment une forme est définie

### Définition portable (JSON, `schemaVersion: 1`)

Une boîte de 0 à 100 (centre 50, unité 40). Champs :

- `body` : soit des primitives (rect arrondi, ellipse, cercle) combinées, soit
  un chemin SVG `d` fermé. Les chemins sont validés (`assertSafePath` : pas de
  script, chemins fermés, limites de taille et de nombre de commandes dans
  `SHAPE_AVATAR_LIMITS`).
- `eyes` : `anchor` (point, défaut `[54, 42]`), `size {w, h}`, `shape`
  (`pill`, `round`, `arch`), `gap` optionnel. `defaultPillEyes()` donne la
  paire standard.
- `accessories` : chemins `d` en plus, avec un `role` optionnel (anse, tige).
- `id` (slug), `name`. Le schéma est `.strict()` : un champ inconnu est refusé.

La couleur ne fait jamais partie de la définition : elle reste celle du bot.
Une définition personnalisée se stocke sur `mascotLook.avatarDef`.

### Géométrie partagée

`shared/mascot-geometry.json` est l'unique source pour le web et le téléphone.
Chaque corps y a 64 rayons (angle 0 vers le haut, sens horaire, en unités R du
cercle) et une ancre de visage `face`. Les yeux (capsule, écart, regard, tête)
et les seize expressions y sont aussi. Les objets sont cuits depuis leurs
silhouettes par `scripts/bake-object-shapes.mjs` (corps dodus, rayon minimal
bien au-dessus de 0,5 pour que les tranches de volume ne sortent pas).

### Moteurs

Desktop : `shape-engine.ts` (regard, tête), `shape-volume.ts` (extrusion en
tranches), `shape-moves.ts` (quatorze mouvements), `ShapeMascot.tsx`. iOS :
`ShapeEngine.swift`, `ShapeVolume.swift`, `ShapeMotion.swift`,
`ShapeMascotView.swift`. Les deux dessinent pareil : contour plié par la pose
au repos seulement, yeux dans le groupe du visage, tranches qui touchent le
visage.

## Générer une nouvelle forme

1. Générer et valider une définition :
   ```
   node scripts/generate-shape.mjs "a friendly coffee mug" --out artifacts/shape-gen
   ```
   Sans modèle, la description tombe sur le preset le plus proche
   (`matchObjectShapePreset`). Écrit `<id>.json` et `<id>.svg`. Pour une forme
   faite par un modèle ou à la main, produire le JSON puis :
   ```
   node scripts/generate-shape.mjs --def ma-forme.json --name mug
   ```
   Le prompt pour un modèle est `shapeAvatarGenerationPrompt()` ; la réponse se
   lit avec `parseShapeAvatarModelText()` puis `validateShapeAvatarDef()`. Le
   plus simple est de passer la réponse à `--def`.
2. Ouvrir le SVG et corriger le chemin jusqu'à ce que la silhouette soit
   propre : une seule forme fermée, plump, sans attache fine.

## Ajouter la forme au jeu

1. Desktop : ajouter la définition dans `shared/shape-avatar-presets.ts`
   (à côté de `pad`, `cup`...), l'ajouter à `OBJECT_SHAPE_PRESETS`, puis
   l'identifiant à `MASCOT_SHAPES` et `OBJECT_MASCOT_SHAPES` dans
   `shared/mascot-look.ts`. Ajouter les mots-clés dans `HINTS`
   (`shared/shape-avatar-generate.ts`) et le libellé `mascot.shape.<id>` dans
   `src/locales/en.json` (et la source-hash via `node scripts/generate-locale.mjs`).
2. Cuire les rayons : ajouter la silhouette `inside` dans
   `scripts/bake-object-shapes.mjs`, puis `node scripts/bake-object-shapes.mjs`
   (met à jour `shared/mascot-geometry.json`).
3. Données iOS : regénérer
   `UPDATE_IOS_MASCOT=1 pnpm vitest run src/components/ios-mascot-export.test.ts`
   (réécrit `ShapeGeometryData.swift`, ne pas l'éditer à la main). Ajouter le cas
   à `MascotShape` et à `ShapeAvatarPresets.objectIds` côté Swift
   (`ios/Sources/CompanionCore/`) avec sa définition.
4. Si l'outil bot est remis : regénérer `node scripts/tool-policy/generate.ts`,
   les goldens (`UPDATE_AGENTS_CATALOG_GOLDENS=1 npx vitest run
   server/drivers/agents-proxy.test.ts`), la liste épinglée de
   `server/drivers/agents-proxy.test.ts` et `pnpm gen:self-knowledge`.

## Contrôles visuels (obligatoires)

- `node scripts/capture-shapes.mjs` (headless, rien ne s'ouvre à l'écran) :
  captures de chaque forme au repos, par peau, par humeur et à mi-mouvement,
  plus les contrôles sur la mise en page réelle du navigateur. Première fois
  pour une nouvelle forme : `--update` pour écrire ses références, puis
  regarder les images dans `docs/screenshots/shapes`.
- Yeux : les deux dans le visage, la paire égale et de niveau, ancre `face`
  cohérente avec la silhouette (pas sur une anse ou un bord).
- Aucune pièce détachée : chaque tranche chevauche le visage, la tige tient
  dans le corps, un seul contour fermé. Une mascotte démontée a été signalée
  plusieurs fois : jamais de fusion sans la capture.
- Tests : `src/components/shape-set.regression.test.ts`,
  `shared/shape-avatar-def.test.ts`, `shared/shape-avatar-presets.test.ts`,
  `shared/mascot-geometry.test.ts` ; iOS `ShapeSetRegressionTests`,
  `ShapeAvatarDefTests`.
