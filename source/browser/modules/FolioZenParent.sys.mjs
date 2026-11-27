/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Storage for Folio "Zen" (FolioZenChild.sys.mjs): the elements hidden on each site, as CSS selectors per host, in the
 * pref folio.zen.sites ({"www.reddit.com": ["#banner", ...]}). Private windows read it but never add to it. */

const PREF = "folio.zen.sites";
const MAX_PER_SITE = 50;

function load() {
  try { const o = JSON.parse(Services.prefs.getStringPref(PREF, "{}")); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
}
function save(o) { Services.prefs.setStringPref(PREF, JSON.stringify(o)); }

export class FolioZenParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name === "Accent") {
      const win = this.browsingContext?.topChromeWindow;
      // The accent from the window: the computed value is plain rgb() (the theme registers --folio-accent as a color);
      // the inline value is the hex the theme set. Either is safe to hand to the page.
      let v = "";
      try {
        const root = win.document.documentElement;
        v = win.getComputedStyle(root).getPropertyValue("--folio-accent").trim();
        if (!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i.test(v)) v = root.style.getPropertyValue("--folio-accent").trim();
      } catch (e) {}
      return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i.test(v) ? v : null;
    }
    if (msg.name === "Wheel") {
      const win = this.browsingContext?.topChromeWindow;
      const d = Number(msg.data?.d) || 0;
      if (d) win?.FolioZen?.wheel(Math.max(-2000, Math.min(2000, d)));
      return null;
    }
    if (msg.name === "SwitchSpace") {
      const win = this.browsingContext?.topChromeWindow;
      win?.FolioZen?.switchBy(msg.data?.dir > 0 ? 1 : -1);
      return null;
    }
    const host = String(msg.data?.host || "").toLowerCase().slice(0, 253);
    if (!host) return [];
    const all = load();
    const list = Array.isArray(all[host]) ? all[host] : [];
    if (msg.name === "Get") return list;
    const isPrivate = this.browsingContext?.usePrivateBrowsing;
    const sel = String(msg.data?.selector || "").slice(0, 500);
    if (msg.name === "Add" && sel && !list.includes(sel)) {
      if (isPrivate) return [...list, sel]; // shown for this page, not remembered
      list.push(sel);
      all[host] = list.slice(-MAX_PER_SITE);
      save(all);
      return all[host];
    }
    if (msg.name === "Remove") {
      const next = list.filter(s => s !== sel);
      if (!isPrivate) { if (next.length) all[host] = next; else delete all[host]; save(all); }
      return next;
    }
    return list;
  }
}
