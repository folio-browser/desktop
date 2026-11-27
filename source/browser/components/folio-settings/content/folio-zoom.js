/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Default page size (FolioZoom). Split out of folio-sidebar.js 2026-11-26, no code change, same load order.

// Default page size. Firefox keeps the global default zoom in its content-prefs database; Folio's recommended value is 125%.
// ensureDefault() sets it ONCE for a profile that has no global value yet (never overrides a choice the user made).
const FolioZoom = {
  RECOMMENDED: 1, // 2026-11-26 (Sammy): 100% everywhere, bigger only for the sites you choose
  // Sites whose own default differs from the global one (Reset / Ctrl+0 goes back to THIS, not to the global size).
  SITE_DEFAULTS: { "web.whatsapp.com": 1.25 },
  siteDefault(host) { return this.SITE_DEFAULTS[host] ?? null; },
  // Every reset path (Ctrl+0, the zoom popup's Reset, the site panel) ends in FullZoom.reset: send sites with their own
  // default back to it (2026-11-26, Sammy: "Reset on WhatsApp gave 100, not its default 125").
  hookReset() {
    if (typeof FullZoom == "undefined" || FullZoom._folioSiteDefaults) return;
    FullZoom._folioSiteDefaults = true;
    const orig = FullZoom.reset;
    FullZoom.reset = async function (browser = gBrowser.selectedBrowser) {
      let host = "";
      try { host = browser.currentURI.host; } catch (e) {}
      const r = await orig.call(this, browser);
      const def = FolioZoom.siteDefault(host);
      if (def) {
        await FolioZoom.setSite(host, def); // the content-pref observer applies it to every tab of that site
        setTimeout(() => window.FolioZoomPopup?.show?.(browser), 50); // the badge shows the size it really landed on
      }
      return r;
    };
  },
  _cps() { return Cc["@mozilla.org/content-pref/service;1"].getService(Ci.nsIContentPrefService2); },
  _ctx() { return Cu.createLoadContext(); }, // non-private: the same value for private windows
  get() { return ChromeUtils.importESModule("resource:///modules/ZoomUI.sys.mjs").ZoomUI.getGlobalValue(); },
  set(value) {
    return new Promise((resolve, reject) => {
      this._cps().setGlobal("browser.content.full-zoom", value, this._ctx(), { handleCompletion: resolve, handleError: reject });
    });
  },
  hasValue() {
    return new Promise((resolve) => {
      let found = false;
      this._cps().getGlobal("browser.content.full-zoom", this._ctx(), {
        handleResult() { found = true; },
        handleCompletion() { resolve(found); },
        handleError() { resolve(true); }, // when unsure, leave the user's zoom alone
      });
    });
  },
  // Per-site sizes (Firefox's own site-specific zoom, the same one Ctrl + / - sets).
  listSites() {
    const cps = this._cps(), ctx = this._ctx(), out = [];
    return new Promise(res => cps.getByName("browser.content.full-zoom", ctx, {
      handleResult(p) { if (p.domain) out.push({ host: p.domain, value: Number(p.value) }); },
      handleCompletion: () => res(out.sort((a, b) => a.host.localeCompare(b.host))), handleError: () => res(out),
    }));
  },
  setSite(host, value) {
    return new Promise(res => this._cps().set(host, "browser.content.full-zoom", value, this._ctx(), { handleCompletion: res, handleError: res }));
  },
  removeSite(host) {
    return new Promise(res => this._cps().removeByDomainAndName(host, "browser.content.full-zoom", this._ctx(), { handleCompletion: res, handleError: res }));
  },
  async ensureDefault() {
    this.hookReset();
    // Once: the old 125% default becomes 100%, and WhatsApp keeps 125% as its own size.
    if (!Services.prefs.getBoolPref("folio.zoom.v2.done", false)) {
      Services.prefs.setBoolPref("folio.zoom.v2.done", true);
      try {
        if (Math.abs((await this.get()) - 1.25) < 0.001) await this.set(1);
        if (!(await this.listSites()).some(x => x.host === "web.whatsapp.com")) await this.setSite("web.whatsapp.com", 1.25);
      } catch (e) { console.warn("Folio zoom v2:", e); }
    }
    this.clearStuck100();
    if (Services.prefs.getBoolPref("folio.zoom.default.done", false)) return;
    Services.prefs.setBoolPref("folio.zoom.default.done", true); // set first: two windows must not both run this
    try { if (!(await this.hasValue())) await this.set(this.RECOMMENDED); } catch (e) { console.warn("Folio zoom:", e); }
  },
  // Once (2026-11-24, Sammy: "every website other than the new tab 125"): sites saved at exactly 100% (WhatsApp was,
  // from before the 125% default) are cleared so they follow the default. The new tab page stays 100% by code.
  async clearStuck100() {
    if (Services.prefs.getBoolPref("folio.zoom.cleared100.done", false)) return;
    Services.prefs.setBoolPref("folio.zoom.cleared100.done", true);
    const cps = this._cps(), ctx = this._ctx(), name = "browser.content.full-zoom", domains = [];
    try {
      await new Promise(res => cps.getByName(name, ctx, {
        handleResult(p) { if (p.domain && Math.abs(Number(p.value) - 1) < 0.001) domains.push(p.domain); },
        handleCompletion: res, handleError: res,
      }));
      for (const d of domains) {
        await new Promise(res => cps.removeByDomainAndName(d, name, ctx, { handleCompletion: res, handleError: res }));
      }
    } catch (e) { console.warn("Folio zoom cleanup:", e); }
  },
};
window.FolioZoom = FolioZoom;

