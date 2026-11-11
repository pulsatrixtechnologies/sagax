# 6. Liste de contrôle avant de dire « c'est au niveau »

Source: docs/design/ux-reference-grokbot-cursor.md, heading "6. Liste de contrôle avant de dire « c'est au niveau »", items 1 to 17.
Surface: the reading link of a published page (capabilities bar, ask-first card, link confirmation, file handoff). PR 3647, branch feat/3574-page-files-download.

The item text below is the checklist. The next line is the verdict and the proof.

1. La surface est décrite dans ce fichier ; sinon, la section a été ajoutée dans la même PR.

yes. The published page is section 2.12 of this same file (a page covers the conversation, back to the thread, share, the rest behind the menu). The reading link is the wrapper of that page: section "Bot content has a default theme" says a reading link gets light and dark from the reader's system. This commit adds no new surface, so it adds no new section.

2. Chaque information et chaque action de l'écran d'avant a une place (liste avant et après jointe).

yes. Nothing on the screen was removed. Before (HEAD 5cbc190e): the Reads control, the list (data labels, your name and role, open links and chats, a file it hands you), the ask-first card (Decline, Always allow, Allow), the link card (host, address, show the whole address, Cancel, Always allow this site, Open), and the publication card beside the neighbour card that declares nothing. After: the same rows and the same actions. The only change is the save gate: a download is accepted when the browser sets userActivation.isActive on the message, and the page's own gesture boolean is ignored.

3. Chaque option n'existe qu'à un endroit ; les autres surfaces y mènent par un lien.

yes. One Reads button (data-reader-caps) opens the only capabilities list. Ask first and the link confirmation sit in that same popover, not on a second screen. The file row states the capability; the page's own Save button is the one control that starts a download.

4. Aucune fenêtre modale hors confirmation destructive ou exception listée (principe 5) ; le choix panneau, vue ou popover suit le tableau du principe.

yes. The list is a popover (role=dialog, class sr-popover) anchored to the bar button. Ask first and the link confirmation are role=alert inside that popover. That matches the short-choice row of the principle table. No new modal window was added.

5. Seuls les composants partagés (réglages, cartes, rangées, pilules, cartes de question, popovers) sont utilisés ; aucune couleur, aucun rayon, aucune ombre en dur.

yes. The panel uses the reader's existing classes only: sr-popover, sr-row, sr-button, sr-button-primary, sr-confirm. This commit's code (src/page-reader/capabilities.ts and scripts/capture/page-capabilities.mjs) adds no color, no radius and no shadow.

6. Une seule action principale par écran, à l'accent ; le destructif en rouge, avec sa conséquence écrite.

yes. Each card has one primary button, sr-button-primary: Allow on ask first, Open on the link card. Decline, Cancel and Always allow stay secondary. No destructive action was added, so no red button was added. The link card states the consequence (capLinkNote: the address was not in the data the page read).

7. Espacements sur l'échelle de 4, tailles de texte dans la liste fermée, casse de phrase, aucun libellé en capitales.

yes. The existing reader chrome uses the 4 scale (gap 8px and 12px, radius 8px and 12px) and the closed text sizes (12px and 15px in the popover). Labels are sentence case in both languages (Reads / Lit, Allow / Permettre, Open / Ouvrir). No label is in capitals.

8. Cartes sans ombre au repos ; ombre seulement sur ce qui flotte.

yes. The ask-first card and the link card use sr-confirm, which has a tint and no shadow. Shadow is only on what floats: sr-popover and the bar.

9. Survol, pressé, focus clavier, choisi et désactivé vérifiés ; tout se fait au clavier, Échap recule, la palette connaît l'action.

yes. reader.css already has hover, focus-visible, aria-pressed and disabled on the bar button, and disabled plus primary hover on sr-button. Escape closes the popover (keydown listener in ReaderCapabilities.tsx). The capture presses Escape before the link shot. The reading link is outside the app shell, so this action is not an app palette command.

10. États vide, chargement, erreur et hors ligne dessinés ; une section vide disparaît.

yes. A page that declares nothing draws no control (pageCapabilitiesAny is false, the component returns null), so an empty section is absent. The file row is absent unless files includes download. The blocked read is the ask-first card, captured as reader-ask-first, reader-700-ask-first, reader-narrow-ask-first, reader-fr-ask-first, reader-iphone-ask-first and reader-ipad-ask-first, light and dark. This wrapper does not add a separate loading or offline screen: the frame is the page itself.

11. Aucun UUID, nom d'outil, chemin interne ni cron à l'écran ; textes en français et en anglais, sans tiret cadratin ni demi-cadratin (`node scripts/generate-locale.mjs --check`).

yes. Product strings go through readerText, English and French (capReads through capLinkLess in shared/page-reader.ts). The capabilities chrome shows labels, not a page id, a tool name, an internal path or a cron line. No em dash and no en dash in those strings or in the two files this commit edits. Locale check: `node scripts/generate-locale.mjs --check` exit 0 (locale catalogs valid, 10 languages, 14780 English strings, fr.json 100%).

12. Contraste mesuré (`pnpm check:contrast` si une valeur de palette a bougé).

n/a. No palette value changed. The diff is the download gate, the headless capture script, these screenshots and this checklist. pnpm check:contrast was not required.

13. Captures headless, jamais de fenêtre visible sur le poste du propriétaire : bureau large, 700 px et 390 px ; clair et sombre ; français et anglais ; iPhone au simulateur si l'écran existe sur iOS. Comparées à une page voisine existante (mêmes marges, mêmes alignements).

yes. 78 PNGs already on disk under docs/screenshots/page-capabilities, from scripts/capture/page-capabilities.mjs (chromium headless: true, no window). Reader: 1100 CSS px (2200x1280 at 2x), 700 CSS px (1400x1800), 390 CSS px (780x1520), light and dark hashes differ, English and French, iPhone 14 (1170x1992) and iPad gen 7 (1620x2160). Neighbour cards are card-neighbour next to card-declares at the same sizes. The publication card element shot under skin=pulsatrix is byte-identical in light and dark (the card node did not restyle); the reader chrome did. There is no native iOS screen for this wrapper, so the iOS simulator was not used; iPhone and iPad are device captures of the same web wrapper.

14. Le parcours principal a été essayé pour vrai (pas seulement les tests unitaires).

yes. CAPTURE_PROBE_ONLY=1 node scripts/capture/page-capabilities.mjs clicked Save note.txt in the headless reader. The browser download name was note.txt and the page reported saved note.txt. The broker records userActivation.isActive when the message arrives, before the capabilities load. Unit tests refuse the same call when that activation is already inactive, including when the page sets gesture true.

15. iPhone et iPad suivent le même rangement, ou l'écart est écrit dans la PR.

yes. iPhone 14 and iPad (gen 7) use the same ReaderCapabilities component as the wide window: same popover, same ask-first card, same link card. Captures: reader-iphone-reads, reader-iphone-ask-first, reader-iphone-link-confirm, reader-ipad-reads, reader-ipad-ask-first, reader-ipad-link-confirm, light and dark, plus reader-iphone-fr for French. No second layout.

16. Aucun élément ajouté réservé à un admin pour ce qui reste dans l'environnement de la personne.

yes. No admin-only control was added. The new check is the browser user activation on the reader's own message. Allow, decline and the file save stay actions of the person who has the page open.

17. Tests des fichiers touchés seulement ; la passe complète attend la coupe de version.

yes. Touched tests only, not the full suite. `pnpm exec vitest run src/page-reader/capabilities.test.ts` passed, 58 tests. They save on a live userActivation, refuse when that activation is inactive even if gesture is true, and keep a click that ends while capabilities load.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
