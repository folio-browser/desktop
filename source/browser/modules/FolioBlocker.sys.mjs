/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio's built-in ad blocker, phase 1: network blocking (2026-11-24).
 *
 * Firefox 160 already ships Brave's open-source filter engine (adblock-rust, vendored as
 * toolkit/components/content-classifier/etp_engine) inside its network layer: the ContentClassifierService
 * classifies every request in the parent process and cancels matches with the same machinery as tracking
 * protection (shield counter, per-site "turn off protection" exceptions). This module feeds it the filter lists
 * uBlock Origin uses by default, kept as local files in the profile and refreshed in the background, through the
 * service's list-URL pref (the "test_block" engine; ContentClassifierService::MaybeLoadFolioLists loads them at
 * startup). Measured on this machine: 167k rules load in ~155 ms, +12-14 MB in the main process, no extension.
 *
 * Not yet here (uBlock still covers them): hiding leftover ad boxes (cosmetic filters) and scriptlets (YouTube).
 * Off unless folio.blocker.enabled is true. */

const ENABLED_PREF = "folio.blocker.enabled";
const UPDATE_DAYS_PREF = "folio.blocker.updateDays";
const CC_ENABLED = "privacy.trackingprotection.content.protection.enabled";
const CC_ENGINES = "privacy.trackingprotection.content.protection.engines";
const CC_URLS = "privacy.trackingprotection.content.protection.test_list_urls";

// uBlock Origin's default lists (same sources it downloads). Ids are file names in <profile>/folio-blocker/.
export const LISTS = [
  { id: "easylist", url: "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt" },
  { id: "easyprivacy", url: "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt" },
  { id: "ublock-filters", url: "https://ublockorigin.github.io/uAssets/filters/filters.txt" },
  { id: "ublock-privacy", url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt" },
  { id: "ublock-badware", url: "https://ublockorigin.github.io/uAssets/filters/badware.txt" },
  { id: "ublock-quick-fixes", url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt" },
  { id: "ublock-unbreak", url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt" },
  { id: "peter-lowe", url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext" },
  // Phase 3: scriptlet resources (YouTube / anti-adblock fixes) in adblock-rust's format, from Brave's
  // adblock-resources (MPL-2.0; bundles uBlock's GPL scriptlets, used here as data, like uBlock itself).
  { id: "resources", file: "brave-resources.json", url: "https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json" },
];
const fileOf = l => l.file || l.id + ".txt";

const lazy = {};
ChromeUtils.defineLazyGetter(lazy, "dir", () => PathUtils.join(PathUtils.profileDir, "folio-blocker"));

let started = false;
let updating = null;

export const FolioBlocker = {
  get enabled() {
    return Services.prefs.getBoolPref(ENABLED_PREF, false);
  },

  // Once per app, from the first browser window.
  init() {
    if (started) return;
    started = true;
    // Phase 2: hides leftover ad boxes in pages (FolioCosmeticChild/Parent). Registered always; it checks the pref.
    try {
      ChromeUtils.registerWindowActor("FolioCosmetic", {
        parent: { esModuleURI: "resource:///modules/FolioCosmeticParent.sys.mjs" },
        child: {
          esModuleURI: "resource:///modules/FolioCosmeticChild.sys.mjs",
          events: { DOMDocElementInserted: { capture: true }, DOMContentLoaded: {}, pageshow: {} },
        },
        allFrames: true,
        matches: ["http://*/*", "https://*/*"],
        // Runs inside website processes (without this, Firefox refuses it there and ad boxes were never hidden).
        // FolioCosmeticParent only reads: it returns hide selectors for the page's URL, nothing else.
        safeForUntrustedWebProcess: true,
      });
    } catch (e) {
      console.warn("FolioBlocker: cosmetic actor", e);
    }
    Services.prefs.addObserver(ENABLED_PREF, () => this.apply());
    this.apply();
  },

  // The native blocker replaces uBlock (its ~50 MB extension process): uBlock is switched off while the native one
  // is on, and back on if the native one is turned off. Never uninstalled.
  async syncUBlock(nativeOn) {
    try {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const ub = await AddonManager.getAddonByID("uBlock0@raymondhill.net");
      if (!ub) return;
      if (nativeOn && !ub.userDisabled) await ub.disable();
      else if (!nativeOn && ub.userDisabled && Services.prefs.getBoolPref("folio.blocker.disabledUBlock", false)) await ub.enable();
      Services.prefs.setBoolPref("folio.blocker.disabledUBlock", nativeOn);
    } catch (e) {
      console.warn("FolioBlocker: uBlock switch", e);
    }
  },

  async apply() {
    if (!this.enabled) {
      Services.prefs.setBoolPref(CC_ENABLED, false);
      this.syncUBlock(false);
      return;
    }
    this.syncUBlock(true);
    await this.migrate();
    Services.prefs.setStringPref(CC_ENGINES, "test_block");
    const have = await this.cachedUrls();
    if (have.length) this.point(have);
    Services.prefs.setBoolPref(CC_ENABLED, true);
    // Wake the service now so the lists are built before the first page asks (it otherwise starts on first use).
    try {
      Cc["@mozilla.org/content-classifier-service;1"].getService(Ci.nsIContentClassifierService);
    } catch (e) {
      console.warn("FolioBlocker: content classifier unavailable", e);
    }
    const stale = !have.length || Date.now() - Services.prefs.getIntPref("folio.blocker.lastUpdate", 0) * 1000 >
      Services.prefs.getIntPref(UPDATE_DAYS_PREF, 4) * 86400000;
    if (stale) {
      // First run: now. Otherwise when the browser is idle, so startup isn't slowed.
      if (!have.length) this.update();
      else ChromeUtils.idleDispatch(() => this.update(), { timeout: 60000 });
    }
  },

  async cachedUrls() {
    const urls = [];
    for (const l of LISTS) {
      if (l.id === "resources") continue;
      const p = PathUtils.join(lazy.dir, fileOf(l));
      if (await IOUtils.exists(p)) urls.push(PathUtils.toFileURI(p));
    }
    if (!urls.length) return urls;
    // Scriptlet resources = uBlock's own scriptlets (shipped inside Folio, blocker/ublock-scriptlets.json) + Brave's
    // extras (downloaded; optional). The engine builder (ContentClassifierService.cpp BuildEngineFromRules) reads the
    // marker's comment line and loads the merged file itself, on its build thread; the marker also makes the engine
    // treat these lists as trusted (content_classifier_engine_from_rules).
    try {
      const merged = await this.mergeResources();
      const marker = PathUtils.join(lazy.dir, "resources-marker.txt");
      await IOUtils.writeUTF8(marker, "! folio-resources-file: " + merged + "\n");
      urls.push(PathUtils.toFileURI(marker));
    } catch (e) {
      console.warn("FolioBlocker: scriptlet resources unavailable", e);
    }
    return urls;
  },

  async mergeResources() {
    const ub = await (await fetch("chrome://browser/content/folio-settings/blocker/ublock-scriptlets.json")).json();
    const byName = new Map();
    try {
      for (const r of await IOUtils.readJSON(PathUtils.join(lazy.dir, "brave-resources.json"))) byName.set(r.name, r);
    } catch (e) {}
    for (const r of ub) byName.set(r.name, r); // uBlock's version wins on a name clash
    const out = PathUtils.join(lazy.dir, "resources.json");
    await IOUtils.writeJSON(out, [...byName.values()]);
    return out;
  },

  // Changing the pref makes the service rebuild the engine (off the main thread). `v` makes a refresh with the same
  // file names still count as a change.
  point(urls) {
    const v = Services.prefs.getIntPref("folio.blocker.lastUpdate", 0);
    Services.prefs.setStringPref(CC_URLS, urls.map(u => u + "#v" + v).join("|"));
  },

  // Download changed lists (conditional requests); keep the old copy if a download fails.
  // uBlock's lists contain `!#if cond` / `!#else` / `!#endif` blocks (rules for uBlock Lite, Chromium, engines with or
  // without HTML filtering...). adblock-rust treats those lines as comments and so applied BOTH branches: on YouTube
  // that ran Chromium-only response-rewriting rules on top of the others (suspected cause of missing captions,
  // 2026-11-25). We resolve the blocks the way uBlock for Firefox would, minus HTML filtering (adblock-rust has no
  // `replace=`), before the engine ever sees the list.
  ENV: { env_firefox: true, env_gecko: true, env_chromium: false, env_edge: false, env_safari: false, env_mobile: false,
    env_mv3: false, ext_ubol: false, ext_devbuild: false, cap_html_filtering: false, cap_user_stylesheet: true,
    cap_ipaddress: true, adguard: false, adguard_app_windows: false, adguard_ext_chromium: false, false: false, true: true },
  preprocess(text) {
    if (!text.includes("!#if")) return text;
    const ENV = this.ENV;
    const evalCond = (expr) => {
      // tokens: names, !, &&, ||, ( ). Unknown names are false (like uBlock).
      const toks = expr.match(/!|&&|\|\||\(|\)|[A-Za-z_][\w]*/g) || [];
      let i = 0;
      const or = () => { let v = and(); while (toks[i] === "||") { i++; v = and() || v; } return v; };
      const and = () => { let v = not(); while (toks[i] === "&&") { i++; v = not() && v; } return v; };
      const not = () => { if (toks[i] === "!") { i++; return !not(); } if (toks[i] === "(") { i++; const v = or(); i++; return v; } return !!ENV[toks[i++]]; };
      try { return or(); } catch (e) { return false; }
    };
    const out = [];
    const stack = []; // each: { take: bool (this branch active), parent: bool }
    const active = () => stack.every(f => f.take);
    for (const line of text.split("\n")) {
      if (line.startsWith("!#if ")) { stack.push({ take: evalCond(line.slice(5)) }); continue; }
      if (line.startsWith("!#else")) { if (stack.length) stack.at(-1).take = !stack.at(-1).take; continue; }
      if (line.startsWith("!#endif")) { stack.pop(); continue; }
      if (active()) out.push(line);
    }
    return out.join("\n");
  },

  // Lists saved before the preprocessor existed: resolve their !#if blocks once, BEFORE the engine reads them.
  async migrate() {
    const metaPath = PathUtils.join(lazy.dir, "lists.json");
    let meta;
    try { meta = await IOUtils.readJSON(metaPath); } catch (e) { return; }
    if (meta.pp === 1) return;
    for (const l of LISTS) {
      if (l.id === "resources") continue;
      const f = PathUtils.join(lazy.dir, fileOf(l));
      try { const t = await IOUtils.readUTF8(f); const p = this.preprocess(t); if (p !== t) await IOUtils.writeUTF8(f, p); } catch (e) {}
    }
    meta.pp = 1;
    await IOUtils.writeJSON(metaPath, meta);
  },

  update() {
    if (updating) return updating;
    updating = (async () => {
      await IOUtils.makeDirectory(lazy.dir, { ignoreExisting: true });
      let meta = {};
      const metaPath = PathUtils.join(lazy.dir, "lists.json");
      try { meta = await IOUtils.readJSON(metaPath); } catch (e) {}
      let changed = 0;
      for (const l of LISTS) {
        const m = meta[l.id] || {};
        const headers = {};
        if (m.etag) headers["If-None-Match"] = m.etag;
        if (m.modified) headers["If-Modified-Since"] = m.modified;
        try {
          const r = await fetch(l.url, { headers, cache: "no-store", credentials: "omit" });
          if (r.status === 304) continue;
          if (!r.ok) throw new Error("HTTP " + r.status);
          let text = await r.text();
          if (l.id === "resources") {
            if (!Array.isArray(JSON.parse(text))) throw new Error("not a resources array");
          } else if (!/^\s*(\[Adblock|!|\|\||#|[\w.-]+\s*$)/m.test(text.slice(0, 2000))) {
            throw new Error("not a filter list");
          }
          if (l.id !== "resources") text = this.preprocess(text);
          await IOUtils.writeUTF8(PathUtils.join(lazy.dir, fileOf(l)), text, { tmpPath: PathUtils.join(lazy.dir, l.id + ".tmp") });
          meta[l.id] = { etag: r.headers.get("etag") || "", modified: r.headers.get("last-modified") || "", fetched: Date.now() };
          changed++;
        } catch (e) {
          console.warn("FolioBlocker: list update failed", l.id, e);
        }
      }
      meta.pp = 1;
      await IOUtils.writeJSON(metaPath, meta);
      Services.prefs.setIntPref("folio.blocker.lastUpdate", Math.floor(Date.now() / 1000));
      if (changed || !Services.prefs.getStringPref(CC_URLS, "")) {
        const urls = await this.cachedUrls();
        if (urls.length && this.enabled) this.point(urls);
      }
      return changed;
    })().finally(() => { updating = null; });
    return updating;
  },
};
