/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio space routing (2026-11-25, Zen's "Space routing" from Sammy's reference video): a site can belong to a space.
 * When a NEW tab's first page matches a route that points to another space, the tab moves there and Folio switches to
 * that space with it (e.g. open reddit.com from Personal -> it lands in the YouTube space). Only a fresh tab's first
 * page counts, so following links inside a page never moves you, and tabs restored at startup are never routed.
 * Rules (pref folio.routes, JSON [{match, value, space}]): "contains" (URL contains the text), "exactly" (same URL,
 * ignoring the scheme, "www." and a trailing slash) or "regex". Added from the tab menu: "Add route...". */

var FolioRouting = {
  PREF: "folio.routes",
  routes() {
    try { const a = JSON.parse(Services.prefs.getStringPref(this.PREF, "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  },
  setRoutes(list) { Services.prefs.setStringPref(this.PREF, JSON.stringify(list)); },
  _norm(u) { return String(u).replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").toLowerCase(); },
  matches(rule, url) {
    try {
      if (rule.match === "regex") return new RegExp(rule.value, "i").test(url);
      if (rule.match === "exactly") return this._norm(url) === this._norm(rule.value);
      return url.toLowerCase().includes(String(rule.value).toLowerCase());
    } catch (e) { return false; } // a broken regex never matches
  },
  routeFor(url) {
    const spaces = window.FolioSidebar?.spaces() || [];
    return this.routes().find(r => r.value && spaces.some(s => s.id === r.space) && this.matches(r, url)) || null;
  },

  init() {
    if (typeof gBrowser == "undefined" || !window.FolioSidebar) { setTimeout(() => this.init(), 300); return; }
    // Only tabs opened after the session is restored are "fresh".
    const start = () => {
      gBrowser.tabContainer.addEventListener("TabOpen", e => {
        e.target.folioRouteFresh = true;
        // Links opened from other apps land in the chosen space (Settings > Tab Management > Space routing), unless a
        // route sends that site somewhere else (routes win: checked when its first page loads).
        if (e.detail?.fromExternal) e.target.folioExternal = true;
      });
      gBrowser.addTabsProgressListener(this);
    };
    try { SessionStore.promiseAllWindowsRestored.then(start, start); } catch (e) { start(); }
  },

  // Tabs progress listener
  onLocationChange(browser, webProgress, request, location, flags) {
    if (!webProgress?.isTopLevel || (flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT)) return;
    const url = location?.spec || "";
    if (!/^https?:/i.test(url)) return;
    const tab = gBrowser.getTabForBrowser(browser);
    if (!tab || !tab.folioRouteFresh) return;
    tab.folioRouteFresh = false; // its first real page decides; later navigations never route
    const r = this.routeFor(url);
    if (r) this.moveTo(tab, r.space);
    else if (tab.folioExternal) {
      const sp = Services.prefs.getStringPref("folio.routes.external", "");
      if (sp && window.FolioSidebar.spaces().some(s => s.id === sp)) this.moveTo(tab, sp);
    }
    tab.folioExternal = false;
  },

  moveTo(tab, spaceId) {
    const S = window.FolioSidebar;
    const cur = S.tabSpace(tab);
    if (cur === spaceId || cur === S.SHARED) return;
    S.setTabSpace(tab, spaceId);
    const name = S.spaces().find(s => s.id === spaceId)?.name || "its space";
    if (tab.selected) {
      tab.folioLast = Date.now(); // switchSpace selects the most recently used tab of the space: this one
      S.switchSpace(spaceId);
      if (!tab.selected) gBrowser.selectedTab = tab;
    } else {
      S.applySpaces?.();
      S.renderTabs?.();
    }
    window.FolioToast?.show(`Opened in ${name}`);
  },

  // Zen-style "Edit route" card: match type (Contains / Is exactly / RegEx), the text, and the space.
  editor(tab, existing = null) {
    document.getElementById("folio-route-card")?.remove();
    const S = window.FolioSidebar;
    const url = tab?.linkedBrowser?.currentURI?.spec || "";
    let host = "";
    try { host = new URL(url).host; } catch (e) {}
    const NS = "http://www.w3.org/1999/xhtml";
    const el = (tag, attrs = {}, ...kids) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
      }
      n.append(...kids);
      return n;
    };
    let match = existing?.match || "contains";
    const seg = el("div", { class: "folio-route-seg", role: "radiogroup", "aria-label": "Match" });
    const opts = [["contains", "Contains"], ["exactly", "Is exactly"], ["regex", "RegEx"]];
    const segBtns = opts.map(([v, label]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(v === match), onclick: () => {
        match = v; for (const x of segBtns) x.setAttribute("aria-checked", String(x === b));
      } }, label);
      return b;
    });
    seg.append(...segBtns);
    const input = el("input", { type: "text", class: "folio-route-input", value: existing?.value || host || url, spellcheck: "false", "aria-label": "Link" });
    const select = el("select", { class: "folio-route-select", "aria-label": "Open it in" });
    const target = existing?.space || S.currentSpaceId();
    for (const s of S.spaces()) {
      const o = el("option", { value: s.id }, s.name);
      if (s.id === target) o.selected = true;
      select.append(o);
    }
    const close = () => { card.remove(); window.removeEventListener("keydown", keys, true); };
    const save = () => {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      if (match === "regex") { try { new RegExp(value); } catch (e) { input.setAttribute("aria-invalid", "true"); input.focus(); return; } }
      const list = this.routes().filter(r => r !== existing && !(r.value === existing?.value && r.match === existing?.match));
      list.push({ match, value, space: select.value });
      this.setRoutes(list);
      close();
      const name = S.spaces().find(s => s.id === select.value)?.name || "";
      window.FolioToast?.show(`Route saved: ${name}`);
    };
    const card = el("div", { id: "folio-route-card", role: "dialog", "aria-label": "Edit route" },
      el("div", { class: "folio-route-title" }, "Edit route"),
      el("div", { class: "folio-route-label" }, "When the link"),
      seg,
      input,
      el("div", { class: "folio-route-label" }, "Open it in"),
      select,
      el("div", { class: "folio-route-actions" },
        el("button", { type: "button", class: "folio-route-cancel", onclick: close }, "Cancel"),
        el("button", { type: "button", class: "folio-route-save", onclick: save }, "Save route")));
    const keys = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "Enter" && card.contains(e.target) && e.target.tagName !== "BUTTON") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", keys, true);
    document.body.append(card);
    input.focus();
    input.select();
  },
};
window.FolioRouting = FolioRouting;
FolioRouting.init();
