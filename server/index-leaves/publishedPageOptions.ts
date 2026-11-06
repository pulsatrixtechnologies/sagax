// @ts-nocheck
/** publishedPageOptions (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPublishedPageOptions(getHost: () => Host): any {
function publishedPageOptions() {
  const host = getHost();
  const { personDisplayName } = host;

  return {
    pages: host.publishedPages,
    viewer: host.publishedPageViewer,
    names: (page) => {
      const botName = host.store.bot(page.botId)?.name?.trim() || "un bot";
      const person = page.ownerId ? host.principals.byId(page.ownerId) : null;
      const personName = (person ? personDisplayName(person) : host.cfg.profile?.name?.trim()) || "Sagax";
      return { botName, personName };
    },
    // nothing of a disabled or deleted person is served
    ownerActive: (page) => {
      if (host.IDENTITY.kind !== "perspicax" || !page.ownerId) return true;
      const person = host.principals.byId(page.ownerId);
      return Boolean(person && person.disabledAt === undefined && !person.consoleDisabled);
    },
    viewerActive: (viewer) => {
      if (host.IDENTITY.kind !== "perspicax" || !viewer?.principalId) return true;
      const person = host.principals.byId(viewer.principalId);
      return Boolean(person && person.kind === "human" && person.disabledAt === undefined && !person.consoleDisabled);
    },
    // a page shared with a team reads for that team's people (Share)
    teamsOf: (principalId) => host.IDENTITY.kind === "perspicax" ? (host.principals.byId(principalId)?.teams ?? []).map((team) => team.id) : [],
    // the reader's bar around a reading link: this server's built script
    readerAssets: () => readerAssetsFrom(host.STATIC_DIR),
    // its byline draws the publishing bot's mascot (2026-10-29)
    bot: (page) => {
      const bot = host.store.bot(page.botId);
      return bot ? { color: bot.color, ...(bot.mascotLook ? { look: bot.mascotLook } : {}) } : null;
    },
    // #1486: a reader who is not signed in signs in and lands back on the link
    signInPath: (viewPath) => host.IDENTITY.kind === "perspicax" ? `${OIDC_START_PATH}?client=web&return=${encodeURIComponent(viewPath)}` : undefined,
    personName: (principalId) => {
      const person = host.principals.byId(principalId);
      return person ? personDisplayName(person) : "";
    },
    // a reader not signed in changed a page's shared state (2026-10-29)
    stateChanged: (pageId) => host.pageLive.stateChanged(pageId),
    pagesHost: host.PAGES_ORIGIN?.host ?? null,
    appOrigin: (() => {
      try {
        const known = (host.IDENTITY.kind === "perspicax" ? host.IDENTITY.publicOrigin : null) ?? host.publicUrl();
        return known ? new URL(known) : null;
      } catch {
        return null;
      }
    })(),
    separate: host.pagesSeparation()
  };

}
  return publishedPageOptions;
}
