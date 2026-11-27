/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Folio bangs: "!yt cats" opens YouTube search for "cats", "!yt" alone opens YouTube. The list is local
 * (nothing is sent to anyone to resolve a bang). Used by the address bar provider below and the new tab page.
 */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

// Well-known bangs come first in the completion list (the data has no popularity).
const POPULAR = new Set(["g", "yt", "w", "gh", "r", "a", "d", "ddg", "so", "mdn", "npm", "imdb", "tw", "x", "maps", "gm", "wiki", "wen", "ebay",
  "yahoo", "bing", "sp", "wa", "gi", "gimg", "yti", "tr", "nyt", "bbc", "cnn", "spotify", "twitch", "tiktok", "ig", "fb", "li", "pin", "gt", "gmail",
  "gdrive", "pypi", "crates", "docs", "gitlab", "hn", "stackoverflow", "reddit", "amazon", "aliexpress", "etsy", "wikipedia", "translate", "deepl",
  "chatgpt", "claude", "perplexity", "brave", "kagi", "archwiki", "aur", "arch"]);
let gIndex = null;
let gWatching = false;
let gPopularHosts = null;
function index() {
  if (!gIndex) {
    const { BANGS } = ChromeUtils.importESModule("resource:///modules/FolioBangsData.sys.mjs");
    gIndex = { rows: BANGS, byTrigger: new Map() };
    for (const row of BANGS) {
      for (const t of row[3]) gIndex.byTrigger.set(t, row);
    }
    // Your own search presets (Settings > Search > My search shortcuts): [{trigger, name, url}] where %s = what you
    // type. They win over the built-in bangs with the same name. E.g. "g2" -> Google in English only.
    try {
      for (const c of JSON.parse(Services.prefs.getStringPref("folio.bangs.custom", "[]"))) {
        const t = String(c.trigger || "").toLowerCase().replace(/^!/, "").trim();
        if (!t || !/^https?:\/\//i.test(c.url || "")) continue;
        let host = ""; try { host = new URL(String(c.url).replace(/%s/g, "x")).host; } catch (e) { continue; }
        gIndex.byTrigger.set(t, [String(c.name || t), host, String(c.url).replaceAll("%s", "{{{s}}}"), [t]]);
      }
    } catch (e) { /* bad pref: built-ins only */ }
    if (!gWatching) {
      gWatching = true;
      Services.prefs.addObserver("folio.bangs.custom", () => { gIndex = null; gPopularHosts = null; });
    }
  }
  return gIndex;
}

function buildURL(row, query) {
  if (!query) return "https://" + row[1];
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  return row[2].replaceAll("{{{s}}}", q);
}

// Warm the connection to the default engine's suggestion server, so the first suggestion doesn't pay for DNS + TCP + TLS
// (2-8 s on a slow connection, ~0.4 s once warm). It is a request built exactly like a suggestion request (same flags and
// origin attributes, so the connection is reused) but with an EMPTY query: nothing the user typed is sent. At most every 40 s.
const gWarm = new Map();
export async function prewarmSuggestions() {
  try {
    if (!Services.prefs.getBoolPref("browser.search.suggest.enabled", true)) return;
    const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
    await SearchService.init();
    const engine = await SearchService.getDefault();
    if (!engine.supportsResponseType("application/x-suggestions+json")) return;
    const now = Date.now();
    if (now - (gWarm.get(engine.id) || 0) < 40000) return;
    gWarm.set(engine.id, now);
    const uri = engine.getSubmission("", "application/x-suggestions+json").uri;
    const request = new XMLHttpRequest();
    request.responseType = "json";
    request.open("GET", uri.spec, true);
    request.channel.loadFlags |= Ci.nsIChannel.LOAD_ANONYMOUS | Ci.nsIChannel.INHIBIT_PERSISTENT_CACHING;
    request.setOriginAttributes({ userContextId: 0, privateBrowsingId: 0, firstPartyDomain: `${engine.id}.search.suggestions.mozilla` });
    request.mozBackgroundRequest = true;
    request.send();
  } catch (e) {}
}

// Bang pill (2026-11-25, Zen's site pill): "!yt" + space/Tab/Right becomes a pill in the address bar; the text after
// it is the query. The window sets the active trigger here (one address bar has focus at a time); the provider below
// puts "!trigger " back in front of what's typed.
let gPillTrigger = "";
const gIcons = new Map();

export const FolioBangs = {
  setPill(trigger) { gPillTrigger = trigger || ""; },
  // The bang site's favicon as a data: URL (the browser window's CSP doesn't allow loading web images directly; a module
  // can fetch). One request per site per session, only when its pill is shown; no cookies or referrer sent.
  iconFor(domain) {
    if (!domain) return Promise.resolve(null);
    if (!gIcons.has(domain)) {
      // The site's own favicon first; if it isn't a real image (Amazon answers bots with a redirect/HTML), DuckDuckGo's
      // icon service (it only learns the site's name, never what you search). Fetched ONCE: kept on disk in the
      // profile (folio-icons.json), so it is there instantly on every later start (Sammy, 2026-11-26).
      const get = async (url) => {
        try {
          const r = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
          if (!r.ok) return null;
          const blob = await r.blob();
          if (!/^image\//.test(blob.type) || !blob.size || blob.size > 200000) return null;
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return `data:${blob.type};base64,${btoa(bin)}`;
        } catch (e) { return null; }
      };
      gIcons.set(domain, (async () => {
        const stored = await this.storedIcon(domain);
        if (stored) return stored;
        const got = (await get("https://" + domain + "/favicon.ico")) || (await get("https://icons.duckduckgo.com/ip3/" + domain + ".ico"));
        if (got) this.storeIcon(domain, got);
        return got;
      })());
    }
    return gIcons.get(domain);
  },
  // Icon disk cache: <profile>/folio-icons.json = { key: dataURL }. Read once per session, written after a change.
  _diskIcons: null,
  _loadDisk() {
    if (!this._diskIcons) {
      this._diskIcons = (async () => {
        try { return await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "folio-icons.json")); } catch (e) { return {}; }
      })();
    }
    return this._diskIcons;
  },
  async storedIcon(key) {
    const all = await this._loadDisk();
    return (all && typeof all[key] === "string") ? all[key] : null;
  },
  async storeIcon(key, dataUrl) {
    if (!key || !/^data:image\//.test(dataUrl || "")) return;
    const all = await this._loadDisk();
    if (all[key] === dataUrl) return;
    all[key] = dataUrl;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      IOUtils.writeJSON(PathUtils.join(PathUtils.profileDir, "folio-icons.json"), all, { tmpPath: PathUtils.join(PathUtils.profileDir, "folio-icons.json.tmp") }).catch(() => {});
    }, 500);
  },
  get pill() { return gPillTrigger; },
  // The known bang for a trigger ("yt" -> { name, domain }) or null.
  lookup(trigger) {
    const row = index().byTrigger.get(String(trigger || "").toLowerCase());
    return row ? { name: row[0], domain: row[1], trigger: String(trigger).toLowerCase() } : null;
  },
  // "!yt cats", "cats !yt" or "!yt" -> { name, trigger, query, url }, or null when there is no known bang.
  parse(text) {
    if (!text || !text.includes("!")) return null;
    const words = text.trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length < 2 || w[0] !== "!") continue;
      const trigger = w.slice(1).toLowerCase();
      const row = index().byTrigger.get(trigger);
      if (!row) continue;
      const query = words.filter((_, j) => j !== i).join(" ");
      return { name: row[0], trigger, query, url: buildURL(row, query) };
    }
    return null;
  },

  // The last word is an unfinished bang ("!y"): matching bangs, best first, for the dropdown.
  complete(text, limit = 6) {
    const m = /(^|\s)!([^\s!]*)$/.exec(text || "");
    if (!m) return [];
    const part = m[2].toLowerCase();
    if (!part) return [];
    const out = [];
    for (const [trigger, row] of index().byTrigger) {
      if (trigger.startsWith(part) && trigger !== part) out.push({ name: row[0], domain: row[1], trigger, rank: row[3][0] === trigger ? 0 : 1 });
    }
    // Popular = a popular trigger, or any trigger for a popular SITE ("!yo" -> !youtube first, not !yout / !youai).
    const host = (d) => String(d || "").toLowerCase().replace(/^www\./, "");
    if (!gPopularHosts) {
      gPopularHosts = new Set();
      for (const t of POPULAR) { const r = index().byTrigger.get(t); if (r) gPopularHosts.add(host(r[1])); }
    }
    // A popular site's bang counts only when it spells the site's own name ("you"/"youtube" for youtube.com, not
    // "chapo" for a subreddit on reddit.com), and the site gets one row: the fullest spelling.
    const label = (d) => host(d).split(".")[0];
    const best = new Map();
    for (const o of out) {
      if (POPULAR.has(o.trigger)) { o.rank = -1; continue; }
      const h = host(o.domain);
      if (gPopularHosts.has(h) && label(o.domain).startsWith(o.trigger)) {
        o.rank = -1;
        const prev = best.get(h);
        if (!prev || o.trigger.length > prev.trigger.length) best.set(h, o);
      }
    }
    for (let i = out.length - 1; i >= 0; i--) {
      const o = out[i], h = host(o.domain);
      if (o.rank === -1 && !POPULAR.has(o.trigger) && best.get(h) !== o) out.splice(i, 1);
    }
    out.sort((a, b) => a.rank - b.rank || a.trigger.length - b.trigger.length || a.trigger.localeCompare(b.trigger));
    return out.slice(0, limit);
  },

  // The text with the unfinished bang replaced by the chosen one ("cats !y" + "yt" -> "cats !yt ").
  applyCompletion(text, trigger) {
    return text.replace(/(^|\s)!([^\s!]*)$/, (_, pre) => `${pre}!${trigger} `);
  },
};

/**
 * Address bar: a bang in what you type becomes the first result ("Search YouTube for cats").
 */
export class FolioBangsProvider extends UrlbarProvider {
  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.HEURISTIC;
  }

  getPriority() {
    return 10;
  }

  async isActive(queryContext) {
    const text = gPillTrigger ? `!${gPillTrigger} ${queryContext.searchString}` : queryContext.searchString;
    return !!text?.includes("!") && (!!FolioBangs.parse(text) || FolioBangs.complete(text).length > 0);
  }

  async startQuery(queryContext, addCallback) {
    const text = gPillTrigger ? `!${gPillTrigger} ${queryContext.searchString}` : queryContext.searchString;
    const bang = FolioBangs.parse(text);
    if (bang) {
      addCallback(this, new lazy.UrlbarResult({
        type: lazy.UrlbarShared.RESULT_TYPE.URL,
        source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
        heuristic: true,
        payload: {
          url: bang.url,
          title: bang.query ? `Search ${bang.name} for "${bang.query}"` : `Open ${bang.name}`,
        },
      }));
    }
    // Unfinished bang ("!y"): matching bangs, picking one fills the input (see UrlbarInputBase.pickResult).
    for (const c of FolioBangs.complete(text, 5)) {
      addCallback(this, new lazy.UrlbarResult({
        type: lazy.UrlbarShared.RESULT_TYPE.URL,
        source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
        payload: {
          url: "https://" + c.domain,
          title: `!${c.trigger} · ${c.name}`,
          folioFill: FolioBangs.applyCompletion(text, c.trigger),
        },
      }));
    }
  }
}
