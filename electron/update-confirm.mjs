// The question main asks before an update installs when the page did not
// confirm it itself. Sagax's own update dialog ("Restart to install")
// confirms in the page; an older page (an organization server that has not
// updated yet) used to install from its account menu's "Check for updates"
// with no question at all, and on Windows that quit the app and ran the
// installer silently for minutes (2026-10-19). Main now asks first. Pure, so
// the wording and the safe default are tested without Electron.

const STRINGS = {
  fr: {
    title: "Mise à jour",
    message: (app, version) => (version ? `${app} ${version} est prête à installer` : `Une mise à jour de ${app} est prête à installer`),
    detail: {
      win32: (app) => `${app} va se fermer. L'installateur affiche sa progression, puis ${app} se rouvre. Vos bots et votre travail ne bougent pas.`,
      other: (app) => `${app} va redémarrer pour installer la mise à jour. Vos bots et votre travail ne bougent pas.`,
    },
    install: "Redémarrer pour installer",
    later: "Plus tard",
    bots: (count) => (count === 1 ? "1 bot travaille et sera interrompu." : `${count} bots travaillent et seront interrompus.`),
  },
  en: {
    title: "Update",
    message: (app, version) => (version ? `${app} ${version} is ready to install` : `A ${app} update is ready to install`),
    detail: {
      win32: (app) => `${app} will close. The installer shows its progress, then ${app} opens again. Your bots and work stay as they are.`,
      other: (app) => `${app} will restart to install the update. Your bots and work stay as they are.`,
    },
    install: "Restart to install",
    later: "Later",
    bots: (count) => (count === 1 ? "1 bot is working and will be interrupted." : `${count} bots are working and will be interrupted.`),
  },
};

/** French for a French choice (fr, fr-CA), English otherwise; "" or null
 * (follow the system) reads `systemLocale`. */
export function confirmLanguage(language, systemLocale = "") {
  const tag = typeof language === "string" && language ? language : systemLocale;
  return /^fr\b/i.test(String(tag ?? "")) ? "fr" : "en";
}

/** dialog.showMessageBox options. "Later" is the default and the cancel
 * answer, so Enter or Escape never installs. */
export function updateConfirmOptions({ language = "en", platform = process.platform, version = null, appName = "Sagax", activeBots = 0 } = {}) {
  const strings = STRINGS[language] ?? STRINGS.en;
  const cleanVersion = typeof version === "string" && version.trim() ? version.trim() : null;
  return {
    type: "question",
    title: strings.title,
    message: strings.message(appName, cleanVersion),
    detail: `${activeBots > 0 ? `${strings.bots(activeBots)} ` : ""}${(platform === "win32" ? strings.detail.win32 : strings.detail.other)(appName)}`,
    buttons: [strings.install, strings.later],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
}

/** True only for the install button (index 0). */
export function confirmedInstall(result) {
  return result?.response === 0;
}
