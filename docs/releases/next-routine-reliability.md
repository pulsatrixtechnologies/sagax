# Routine reliability

## English

- Routines check their engine account, skills, connected apps, Perspicax profile and required computer before starting a model turn. Use Check routine to see what is ready and what needs attention.
- Missing requirements block a run with an action to take, without charging for a model turn or counting toward the routine's automatic pause.
- Restarts and skipped admissions no longer count toward automatic pauses. A run waiting for an engine reconnect keeps waiting through a restart.
- Sagax remembers provider refusals by engine account: credit refusals for 30 minutes, usage limits until their reset, and sign-outs until reconnect. A successful turn clears the refusal.

## Français

- Les routines vérifient leur compte d’engine, leurs skills, leurs apps connectées, leur profil Perspicax et l’ordinateur requis avant de lancer un turn du modèle. Vérifier la routine montre ce qui est prêt et ce qui demande une intervention.
- Un prérequis manquant bloque le run avec une action à prendre, sans payer un turn du modèle ni augmenter le compteur de pause automatique.
- Les restarts et les admissions sautées ne comptent plus dans les pauses automatiques. Un run en attente de reconnexion à son engine reste en attente après un restart.
- Sagax retient les refus du fournisseur par compte d’engine : 30 minutes pour les crédits, jusqu’au reset pour une limite d’utilisation et jusqu’à la reconnexion pour une déconnexion. Un turn réussi efface le refus.

## Issues

- Issue #1945: readiness before the first turn, Check routine, remote Flow skills, probe errors, local times and one owner notice per bot and cause.
- Issue #1946: engine refusal memory and refusals excluded from the automatic pause.
- Issue #1947: restarts excluded from the automatic pause, reconnect waits preserved.
- Issue #1948: temporary organization admission skips are blocked, without a failed run.
