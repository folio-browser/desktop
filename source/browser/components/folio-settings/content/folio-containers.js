/* Folio: logins and spaces.
   1. A space can be set to "Separate logins" (space.separate, off by default): every new tab of that space opens in the space's own container, so a
      site sees a different browser there (own cookies, logins and site data). Same site in two spaces = two independent sessions.
   2. Shared tabs. Sites that allow only one open tab per login (WhatsApp Web, Telegram Web) get ONE tab that lives in every space at once: it is
      listed in each space and switching spaces keeps the same live page (chats, unread state, open conversation). Opening the site again from any
      space jumps to that tab instead of making a second one (a second tab would get WhatsApp's "open in another window" screen, and a second login
      would cost a QR scan and one of WhatsApp's 4 linked devices). A tab in a Separate-logins space has its own container and is not shared.
   A tab's container is fixed when the tab is created, so rule 1 works through gBrowser.addTab (patched below). */
(() => {
  const MAP_PREF = "folio.containers";           // { spaceId: userContextId }
  const HOSTS_PREF = "folio.singleton.hosts";      // extra hosts for rule 2 (JSON array), added to the built-in list
  const BUILT_IN = { "web.whatsapp.com": "WhatsApp", "web.telegram.org": "Telegram" };
  const { ContextualIdentityService } = ChromeUtils.importESModule("moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");

  const read = () => { try { return JSON.parse(Services.prefs.getStringPref(MAP_PREF, "{}")) || {}; } catch (e) { return {}; } };
  const write = (m) => Services.prefs.setStringPref(MAP_PREF, JSON.stringify(m));
  const hostOf = (u) => { try { return Services.io.newURI(u).host; } catch (e) { return ""; } };
  const singletons = () => {
    const out = { ...BUILT_IN };
    try { for (const h of JSON.parse(Services.prefs.getStringPref(HOSTS_PREF, "[]"))) out[h] = out[h] || h; } catch (e) { /* none */ }
    return out;
  };
  // The site a tab shows. A restored tab that hasn't loaded yet is still about:blank: read its saved address instead.
  const tabHost = (t) => {
    try {
      const h = t.linkedBrowser.currentURI.host;
      if (h) return h;
    } catch (e) { /* about: pages have no host */ }
    try { return hostOf(JSON.parse(SessionStore.getTabState(t)).entries.at(-1).url); } catch (e) { return ""; }
  };

  const FolioContainers = {
    // The container of a space (made the first time it is needed).
    idFor(space) {
      const map = read();
      const existing = map[space.id];
      if (existing && ContextualIdentityService.getPublicIdentityFromId(existing)) return existing;
      const identity = ContextualIdentityService.create(`Folio: ${space.name}`, "fingerprint", "turquoise");
      map[space.id] = identity.userContextId;
      write(map);
      return identity.userContextId;
    },
    // A space is deleted: its container and everything stored in it go too.
    release(spaceId) {
      const map = read();
      const id = map[spaceId];
      if (!id) return;
      delete map[spaceId];
      write(map);
      try { Services.clearData.deleteDataFromOriginAttributesPattern({ userContextId: id }); } catch (e) { /* nothing stored */ }
      try { ContextualIdentityService.remove(id); } catch (e) { /* already gone */ }
    },

    // Rule 2: the one shared tab of a one-tab-per-login site (default container only), or null.
    isSingleton(host) { return !!(host && singletons()[host]); },
    sharedTabFor(host) {
      const S = window.FolioSidebar;
      if (!S || !this.isSingleton(host)) return null;
      const all = gBrowser.tabs.filter((t) => !t.folioPlaceholder && !t.closing && t.userContextId === 0 && tabHost(t) === host);
      return all.find((t) => S.tabSpace(t) === S.SHARED) || all[0] || null;
    },
    // Puts a tab in every space (or takes it back into the current space when it leaves the site).
    syncTab(t) {
      const S = window.FolioSidebar;
      if (!S || !t || t.folioPlaceholder || t.closing) return;
      const shared = S.tabSpace(t) === S.SHARED;
      const host = tabHost(t);
      const want = t.userContextId === 0 && this.isSingleton(host) && this.sharedTabFor(host) === t;
      if (want === shared) return;
      if (want) { S.setTabSpace(t, S.SHARED); S.setTabFolder(t, ""); }
      else S.setTabSpace(t, S.currentSpaceId());
      S.applySpaces();
      S.renderTabs();
    },
    syncAll() { for (const t of gBrowser.tabs) this.syncTab(t); },

    decide(uri) {
      const S = window.FolioSidebar;
      if (!S) return null;
      const space = S.spaces().find((s) => s.id === S.currentSpaceId());
      if (!space) return null;
      if (space.separate) return { id: this.idFor(space) };
      const existing = this.sharedTabFor(hostOf(uri || ""));
      if (existing) return { existing };
      return null;
    },
  };
  window.FolioContainers = FolioContainers;

  // Patch gBrowser.addTab once the tabbrowser exists, and keep shared tabs in step with what each tab shows.
  const patch = () => {
    if (typeof gBrowser == "undefined" || !gBrowser.addTab || !window.FolioSidebar) { setTimeout(patch, 100); return; }
    if (gBrowser._folioContainers) return;
    gBrowser._folioContainers = true;
    const orig = gBrowser.addTab.bind(gBrowser);
    gBrowser.addTab = function (uri, params) {
      let p = params;
      try {
        if (!p || (p.userContextId == null && !p.openerBrowser && !p.ownerTab && !p.pinned)) {
          const d = FolioContainers.decide(typeof uri === "string" ? uri : uri?.spec);
          // Already open: go to the shared tab instead of making a second one.
          if (d?.existing) {
            FolioContainers.syncTab(d.existing);
            if (!p?.inBackground) gBrowser.selectedTab = d.existing;
            return d.existing;
          }
          if (d) p = { ...(p || {}), userContextId: d.id };
        }
      } catch (e) { console.warn("Folio containers:", e); p = params; }
      return orig(uri, p);
    };
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, webProgress, request, location) {
        if (!webProgress.isTopLevel) return;
        try { FolioContainers.syncTab(gBrowser.getTabForBrowser(browser)); } catch (e) { console.warn("Folio shared tab:", e); }
      },
    });
    // Restored tabs: shared ones come back as shared (the space is saved with the session), and a WhatsApp tab from before this
    // feature becomes shared. Session restore can still be adding tabs right now, so check again a little later.
    FolioContainers.syncAll();
    setTimeout(() => FolioContainers.syncAll(), 2000);
  };
  patch();
})();
