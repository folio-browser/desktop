/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Folio sidebar: our own sidebar, the only one. Markup: #folio-sidebar in browser-box.inc.xhtml.
// It draws its own tab list from gBrowser; Firefox's vertical-tabs sidebar is hidden (browser-shared.css).
// Ctrl+S (command Folio:ToggleSidebar) shows or hides it; the choice is kept in folio.sidebar.hidden.
var FolioSidebar = {
  PREF: "folio.sidebar.hidden",

  WIDTH_PREF: "folio.sidebar.width",
  MIN_WIDTH: 180,
  MAX_WIDTH: 480,

  // Icons only (Brave's collapsed vertical tabs; a Reddit request): a narrow sidebar of favicons. Drag the edge
  // narrow to switch it on (or Settings > Look and Feel > Sidebar), drag it wide again to switch it off.
  ICONS_PREF: "folio.sidebar.icons",
  ICON_WIDTH: 56,
  ICON_SNAP: 130,

  apply() {
    const hidden = Services.prefs.getBoolPref(this.PREF, false);
    const icons = Services.prefs.getBoolPref(this.ICONS_PREF, false);
    const side = document.getElementById("folio-sidebar");
    if (side) side.style.width = (icons ? this.ICON_WIDTH : Services.prefs.getIntPref(this.WIDTH_PREF, 260)) + "px";
    document.documentElement.toggleAttribute("folio-sidebar-icons", icons);
    if (this._hidden === undefined) {
      // First call (window opening): no animation.
      this._hidden = hidden;
      document.documentElement.toggleAttribute("folio-sidebar-hidden", hidden);
    } else if (!this._anim && hidden !== this._hidden) {
      this.setHidden(hidden); // changed from elsewhere (settings page, layout choice): slide too
    }
  },

  // Slide the sidebar open or closed (about 190 ms, fast start and soft landing). The state lives in memory, so a key
  // press is never lost: pressing again while it moves reverses it from wherever it is. The pref is written when the
  // move is settled (on opening: at once, so the toolbar over the sidebar slides in with it).
  setHidden(hide) {
    const side = document.getElementById("folio-sidebar");
    const root = document.documentElement;
    this._hidden = hide;
    if (!side) {
      this._commit(hide);
      return;
    }
    const snap = () => {
      const cs = getComputedStyle(side);
      return {
        w: parseFloat(cs.width) || 0, ps: parseFloat(cs.paddingInlineStart) || 0, pe: parseFloat(cs.paddingInlineEnd) || 0,
        b: parseFloat(cs.borderInlineEndWidth) || 0, o: parseFloat(cs.opacity),
      };
    };
    let from = null;
    if (this._anim) {
      from = snap(); // where it is right now
      this._anim.onfinish = null;
      this._anim.cancel();
      this._anim = null;
    }
    root.removeAttribute("folio-sidebar-hidden"); // shown (full size) from here on; the animation shrinks it
    const full = snap();
    full.o = 1;
    root.style.setProperty("--folio-sidebar-inner", Math.round(side.getBoundingClientRect().width) + "px");
    root.setAttribute("folio-sidebar-animating", "");
    const zero = { w: 0, ps: 0, pe: 0, b: 0, o: 0 };
    if (!from) from = hide ? full : zero;
    const to = hide ? zero : full;
    if (!hide) this._commit(false);
    const kf = (s) => ({
      width: s.w + "px", paddingInlineStart: s.ps + "px", paddingInlineEnd: s.pe + "px",
      borderInlineEndWidth: s.b + "px", opacity: s.o,
    });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anim = side.animate([kf(from), kf(to)], {
      duration: reduced ? 1 : 190, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards",
    });
    this._anim = anim;
    anim.onfinish = () => {
      if (this._anim !== anim) return;
      this._anim = null;
      root.toggleAttribute("folio-sidebar-hidden", hide);
      anim.cancel();
      root.removeAttribute("folio-sidebar-animating");
      if (hide) this._commit(true);
      window.dispatchEvent(new Event("resize")); // the address bar measures itself again
    };
  },

  _commit(hidden) {
    if (Services.prefs.getBoolPref(this.PREF, false) !== hidden) Services.prefs.setBoolPref(this.PREF, hidden);
  },

  // Drag the right edge to resize; the width is saved when the drag ends.
  setupResizer() {
    const handle = document.getElementById("folio-sidebar-resizer");
    const side = document.getElementById("folio-sidebar");
    if (!handle || !side) return;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = side.getBoundingClientRect().width;
      let iconZone = Services.prefs.getBoolPref(this.ICONS_PREF, false);
      const move = (ev) => {
        // Sidebar on the right (folio.sidebar.right): dragging left makes it wider.
        const dir = Services.prefs.getBoolPref("folio.sidebar.right", false) ? -1 : 1;
        const raw = Math.round(startW + dir * (ev.clientX - startX));
        // Narrower than the snap point = icons only (shown at once, so you see what you'll get).
        iconZone = raw < this.ICON_SNAP;
        document.documentElement.toggleAttribute("folio-sidebar-icons", iconZone);
        const w = iconZone ? this.ICON_WIDTH : Math.min(this.MAX_WIDTH, Math.max(this.MIN_WIDTH, raw));
        side.style.width = w + "px";
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (!iconZone) Services.prefs.setIntPref(this.WIDTH_PREF, Math.round(side.getBoundingClientRect().width));
        Services.prefs.setBoolPref(this.ICONS_PREF, iconZone);
        window.dispatchEvent(new Event("resize"));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  },

  toggle() {
    this.setHidden(!this._hidden);
  },

  // Essentials: launchers. Each entry is { url, color }, saved in folio.essentials.urls (JSON).
  // The color is taken from the site's icon when it's added, so tiles keep it with no tab open.
  // Clicking one always opens a new tab of its URL. Middle-click a tile to remove it; middle-click a tab (or "Pin to Essentials" in its menu) adds one.
  essEntries() {
    let raw = [];
    try { raw = JSON.parse(Services.prefs.getStringPref("folio.essentials.urls", "[]")); } catch (e) {}
    return raw.map(e => typeof e === "string" ? { url: e, color: null } : e).filter(e => e && e.url);
  },
  setEssEntries(entries) {
    Services.prefs.setStringPref("folio.essentials.urls", JSON.stringify(entries));
  },
  hostOf(url) {
    try { return new URL(url).host; } catch (e) { return ""; }
  },
  tabHost(tab) {
    return this.hostOf(tab.linkedBrowser?.currentURI?.spec || "");
  },
  isEssentialHost(host) {
    return this.essEntries().some(e => this.hostOf(e.url) === host);
  },
  // A short note in the sidebar, for things the user can't do (like adding a 13th essential).
  flashNote(text) {
    const list = document.getElementById("folio-sidebar-tabs");
    if (!list) return;
    list.querySelector(".folio-note")?.remove();
    const note = this.el("div", { class: "folio-note" }, text);
    list.prepend(note);
    setTimeout(() => note.remove(), 1600);
  },

  // Closing the last real tab must not close the window. Firefox can't show zero tabs, so that tab
  // stays as a placeholder (blank, not in the list) and the empty state covers the page.
  closeTabSafely(tab) {
    if (tab.folioPlaceholder) return;
    if (this.liveTabs(this.currentSpaceId()).length <= 1) {
      tab.folioPlaceholder = true;
      Services.prefs.setBoolPref("folio.emptyState", true);
      tab.linkedBrowser.loadURI(Services.io.newURI("about:blank"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      this.syncEmpty();
      return;
    }
    gBrowser.removeTab(tab);
  },
  openMainMenu(x, y) {
    const ffMenu = document.getElementById("PanelUI-menu-button");
    {
      const I = (n) => ({ icon: "global/skin/icons/" + n });
      const B = (n) => ({ icon: "browser/skin/" + n });
      this.showMenu(x, y, [
        ["New window", () => OpenBrowserWindow(), B("window.svg")],
        ["New private window", () => OpenBrowserWindow({ private: true }), B("privateBrowsing.svg")],
        "-",
        ["Downloads", () => this.toggleView("downloads"), B("downloads/downloads.svg")],
        ["History", () => this.toggleView("history"), B("history.svg")],
        ["Bookmarks", () => openTrustedLinkIn("about:bookmarks", "tab"), B("bookmark-hollow.svg")],
        ["Passwords", () => openTrustedLinkIn("about:logins", "tab"), B("login.svg")],
        ["Add-ons and themes", () => BrowserAddonUI.openAddonsMgr(), { icon: "mozapps/skin/extensions/kit-addons.svg" }],
        "-",
        ["Print", () => PrintUtils.startPrintWindow(gBrowser.selectedBrowser.browsingContext), I("print.svg")],
        ["Find in page", () => gLazyFindCommand("onFindCommand"), I("search-glass.svg")],
        ["More tools…", () => { ffMenu?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, altKey: true })); PanelUI.show(); }, I("more.svg")],
      ]);
    }
  },
  // Split view (Firefox's own, 2 tabs side by side): split `tab` with the current tab, or undo the split it's in.
  // Up to 4 tabs: Alt+click adds a tab to the split you're in; Alt+click a tab that's in it takes it out.
  toggleSplit(tab) {
    try {
      const sv = tab.splitview;
      if (sv) {
        if (sv.tabs.length <= 2) sv.unsplitTabs("menu_separate");
        // 3-4 tabs: only this one steps out, right after the split (the way Firefox moves tabs out when unsplitting).
        else {
          // 3-4 tabs: Firefox keeps its own list of the split's tabs, so a tab can't just step out. Undo the split, then
          // regroup the others once the old one is gone.
          const rest = [...sv.tabs].filter(t => t !== tab);
          const keep = gBrowser.selectedTab === tab ? rest[0] : gBrowser.selectedTab;
          sv.unsplitTabs("menu_separate");
          let tries = 0;
          const regroup = () => {
            if (rest.some(t => t.splitview) && tries++ < 40) { setTimeout(regroup, 25); return; }
            try { gBrowser.addTabSplitView(rest, { trigger: "folio" }); gBrowser.selectedTab = keep; } catch (e) { console.warn("Folio split regroup:", e); }
            this.renderTabs();
          };
          regroup();
        }
      } else if (tab !== gBrowser.selectedTab) {
        const cur = gBrowser.selectedTab;
        const group = cur.splitview ? [...cur.splitview.tabs] : [cur];
        if (group.length >= 4) { window.FolioToast?.show("Split view holds up to 4 tabs"); return; }
        if (cur.splitview) cur.splitview.addTabs([tab]);
        else gBrowser.addTabSplitView([cur, tab], { trigger: "folio" });
        gBrowser.selectedTab = cur;
      }
    } catch (e) { console.warn("Folio split view:", e); }
    this.renderTabs();
  },
  // Split layout (folio.split.layout): columns / rows / grid, shown as an attribute the CSS reads.
  watchSplitLayout() {
    const apply = () => document.getElementById("tabbrowser-tabpanels")?.setAttribute("folio-split", Services.prefs.getStringPref("folio.split.layout", "columns"));
    Services.prefs.addObserver("folio.split.layout", apply);
    window.addEventListener("unload", () => Services.prefs.removeObserver("folio.split.layout", apply), { once: true });
    apply();
  },
  realTabs() {
    return gBrowser.tabs.filter(t => !t.folioPlaceholder);
  },
  // Keeps the placeholder in step: removed once a real tab exists, and the empty state shown while it's selected.
  syncEmpty() {
    if (typeof gBrowser == "undefined" || !gBrowser.tabContainer) return;
    // Removed a moment later: a tab that is still opening can't be removed yet.
    // Armed ONLY while a placeholder exists. Arming it on every call made it re-arm itself forever
    // (20 wakeups a second at idle: the main cause of Folio's idle CPU; fixed 2026-11-24).
    const hasPlaceholder = gBrowser.tabs.some(t => t.folioPlaceholder);
    if (hasPlaceholder && !this._phTimer && this.liveTabs(this.currentSpaceId()).length) {
      this._phTimer = setTimeout(() => {
        this._phTimer = null;
        if (!this.liveTabs(this.currentSpaceId()).length) return;
        let left = false;
        for (const t of gBrowser.tabs.filter(t => t.folioPlaceholder)) {
          if (t.parentNode && t.linkedBrowser?.webProgress) gBrowser.removeTab(t);
          else left = true;
        }
        if (!left) Services.prefs.setBoolPref("folio.emptyState", false);
        this.syncEmpty();
      }, 50);
    }
    document.documentElement.toggleAttribute("folio-empty", !!gBrowser.selectedTab?.folioPlaceholder);
  },
  buildEmptyState() {
    // In the tab box, over the page card: inside <tabpanels> it was never painted (tabpanels only draws its
    // selected panel). No instruction line (Folio's rule: no guide text in the UI).
    const panels = document.getElementById("tabbrowser-tabbox");
    if (!panels || document.getElementById("folio-empty")) return;
    const box = this.el("div", { id: "folio-empty", class: "folio-empty" },
      this.el("div", { class: "folio-empty-mark" }),
      this.el("div", { class: "folio-empty-title" }, "No tabs open"),
      this.el("button", { class: "folio-dl-btn", onclick: () => { gBrowser.selectedTab = gBrowser.addTrustedTab(Services.prefs.getStringPref("browser.newtab.url", "about:folio-newtab")); } }, "New tab"));
    panels.append(box);
  },
  MAX_ESSENTIALS: 12,
  // Adds the page (with its color), or removes the essential for that site if it's already there.
  toggleEssentialFor(url, color, icon) {
    const entries = this.essEntries();
    const host = this.hostOf(url);
    if (!host) return;
    const idx = entries.findIndex(e => this.hostOf(e.url) === host);
    if (idx >= 0) { entries.splice(idx, 1); this.setEssEntries(entries); return; }
    if (entries.length >= this.MAX_ESSENTIALS) { this.flashNote("Essentials are full (12)"); return; }
    this.setEssEntries([...entries, { url, color: color || null, icon: icon || null }]);
  },

  // Dominant color of a favicon. Fetched by chrome code (no CORS), drawn at 32px and bucketed.
  // Colorful buckets beat white/gray; if nothing is colorful (X's black icon) the main color wins.
  colorCache: new Map(),
  // Reads the dominant color of an image element that's already loaded. Throws if the image isn't readable.
  dominantColor(img) {
    const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    const px = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
    // Colorful pixels decide the brand color. Hue is averaged on a circle, so reds stay reds.
    const colorful = px.filter(([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 40 && (mx - mn) / mx > 0.3; });
    if (colorful.length >= 8) {
      const hue = ([r, g, b]) => {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
      };
      let sx = 0, sy = 0;
      for (const p of colorful) { const rad = hue(p) * Math.PI / 180; sx += Math.cos(rad); sy += Math.sin(rad); }
      const mean = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
      const group = colorful.filter(p => { const d = Math.abs(hue(p) - mean); return Math.min(d, 360 - d) < 30; });
      if (group.length) {
        const avg = [0, 1, 2].map(k => Math.round(group.reduce((s, p) => s + p[k], 0) / group.length));
        return avg;
      }
    }
    // Nothing colorful (X's black mark): the dark main color.
    const dark = px.filter(([r, g, b]) => Math.max(r, g, b) < 90);
    if (dark.length > px.length / 2) return [0, 0, 0];
    const avgAll = [0, 1, 2].map(k => Math.round(px.reduce((s, p) => s + p[k], 0) / Math.max(1, px.length)));
    return avgAll;
  },

  // Dominant color of a favicon URL. Fetched by chrome code (no CORS), drawn through an <img>.
  brandColor(iconUrl) {
    if (!iconUrl) return Promise.resolve(null);
    if (this.colorCache.has(iconUrl)) return this.colorCache.get(iconUrl);
    const p = (async () => {
      const blob = await (await fetch(iconUrl)).blob();
      const objUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.src = objUrl;
      await img.decode();
      const rgb = this.dominantColor(img);
      URL.revokeObjectURL(objUrl);
      return rgb;
    })().catch(() => null);
    this.colorCache.set(iconUrl, p);
    return p;
  },

  // A favicon as a data: URL, so the essential can show it later with no network request.
  iconDataUrl(iconUrl) {
    if (!iconUrl) return Promise.resolve(null);
    if (iconUrl.startsWith("data:")) return Promise.resolve(iconUrl);
    return (async () => {
      const blob = await (await fetch(iconUrl)).blob();
      return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    })().catch(() => null);
  },

  // Unread badges on Essentials (Arc-style, night shift 2026-11-24): an open tab of the same site whose title carries a
  // count, "(3) WhatsApp" / "Inbox (12) - Gmail", puts that number on the tile. Runs on every tab update (titles change
  // there); the tiles themselves are only rebuilt when the saved list changes.
  unreadCount(title) {
    const m = /\((\d{1,4})\+?\)/.exec(title || "");
    return m ? parseInt(m[1], 10) : 0;
  },
  updateEssBadges(list, entries) {
    const tiles = list.querySelectorAll(".folio-ess-grid > .folio-ess-tile");
    if (!tiles.length) return;
    entries.forEach((entry, i) => {
      const tile = tiles[i];
      if (!tile) return;
      const host = this.hostOf(entry.url);
      let n = 0;
      for (const t of gBrowser.tabs) if (!t.folioPlaceholder && this.tabHost(t) === host) n = Math.max(n, this.unreadCount(t.label));
      const text = n > 99 ? "99+" : n ? String(n) : "";
      let badge = tile.querySelector(".folio-ess-badge");
      if (!text) { badge?.remove(); return; }
      if (!badge) { badge = this.el("span", { class: "folio-ess-badge" }); tile.append(badge); }
      if (badge.textContent !== text) badge.textContent = text;
    });
  },

  essentialTile(entry, tab) {
    const url = entry.url;
    const host = this.hostOf(url);
    const tile = document.createElementNS(this.HTML_NS, "div");
    tile.className = "folio-ess-tile";
    tile.title = url;
    if (entry.color) tile.style.setProperty("--folio-ess-color", `rgb(${entry.color.join(",")})`);
    const letter = this.el("span", { class: "folio-ess-letter" }, host.replace(/^www\./, "").charAt(0).toUpperCase());
    const src = entry.icon || tab?.getAttribute("image") || "";
    if (src) {
      const img = this.el("img", { class: "folio-ess-icon", src, alt: "" });
      img.addEventListener("error", () => img.replaceWith(letter));
      // Older essentials were saved without a color: read it from the icon once, and keep it.
      img.addEventListener("load", () => {
        if (entry.color) return;
        try {
          const rgb = this.dominantColor(img);
          if (!rgb) return;
          this.setEssEntries(this.essEntries().map(x => x.url === url ? { ...x, color: rgb } : x));
        } catch (e) { /* not readable: the color stays unset */ }
      });
      tile.append(img);
    } else {
      tile.append(letter);
    }
    // Always a new tab of this URL (the user knows what an essential does).
    tile.addEventListener("click", (e) => {
      if (e.target.closest(".folio-ess-remove") || e.button !== 0) return;
      openTrustedLinkIn(url, "tab");
    });
    // Middle-click removes it.
    tile.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.toggleEssentialFor(url);
    });
    tile.append(this.el("button", {
      class: "folio-ess-remove", title: "Remove from Essentials",
      onclick: (e) => { e.stopPropagation(); this.setEssEntries(this.essEntries().filter(x => x.url !== url)); },
    }));
    return tile;
  },

  // Rows are kept and updated in place. Rebuilding them on every tab change replaced the rows under the
  // mouse between press and release, so clicks on × landed on the wrong row.
  makeRow(tab) {
    const row = document.createXULElement("hbox");
    row.className = "folio-side-tab folio-enter";
    row.addEventListener("animationend", () => row.classList.remove("folio-enter"), { once: true });
    this._rowTabs.set(row, tab);
    const icon = document.createXULElement("image");
    icon.className = "folio-side-tab-icon";
    const title = document.createXULElement("label");
    title.className = "folio-side-tab-title";
    title.setAttribute("crop", "end");
    title.setAttribute("flex", "1");
    row.setAttribute("role", "tab");
    const close = document.createXULElement("toolbarbutton");
    close.className = "folio-side-tab-close";
    close.setAttribute("tooltiptext", "Close tab");
    close.setAttribute("aria-label", "Close tab");
    close.setAttribute("tabindex", "-1"); // the row's Delete key closes it; the × stays out of the Tab order
    // A × closes only when this same × got the press and then the click. Keyboard activation (detail 0)
    // still closes.
    close.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this._pressedClose = close;
    });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      const pressed = this._pressedClose === close;
      this._pressedClose = null;
      if (e.detail !== 0 && !pressed) return;
      this._closedAt = e.timeStamp;
      this.closeTabSafely(tab);
    });
    const closeIcon = this._makeIcon?.("x", { size: 13, strokeWidth: 2.4, trigger: close });
    if (closeIcon) { close.append(closeIcon); close.setAttribute("folio-pulso", ""); }
    // Loading: a spinner takes the favicon's place (Firefox's own tab throbber lives in the hidden tab strip).
    const spinner = document.createXULElement("box");
    spinner.className = "folio-side-tab-spinner";
    // Sound: a speaker shows while the tab plays audio (click = mute/unmute); a play icon when Folio held back
    // autoplay (click = let it play). Hidden otherwise.
    const audio = document.createXULElement("toolbarbutton");
    audio.className = "folio-side-tab-audio";
    audio.setAttribute("tabindex", "-1");
    audio.addEventListener("mousedown", (e) => e.stopPropagation());
    audio.addEventListener("click", (e) => {
      e.stopPropagation();
      this._closedAt = e.timeStamp; // the row's own click must not also select the tab
      if (tab.activeMediaBlocked) tab.resumeDelayedMedia?.(); else tab.toggleMuteAudio();
    });
    row.append(icon, spinner, title, audio, close);
    row.addEventListener("click", (e) => {
      if (this._justDragged) return; // a drag ends with a click: not a select
      if (e.timeStamp - (this._closedAt || -1000) < 500) return; // ignore clicks right after a close
      // Alt+click: split view with the current tab (Zen's shortcut), or unsplit if it's already in one.
      if (e.altKey && !e.ctrlKey && !e.shiftKey) { this.toggleSplit(tab); return; }
      gBrowser.selectedTab = tab;
    });
    // Middle-click pins the page to Essentials (Sammy's choice, 2026-11-26; a middle-click on a pinned site's tab
    // unpins it). The tab stays open. Closing is the x, Ctrl+W or the menu.
    row.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll from a row
    row.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleEssentialFromTab(tab);
    });
    row.addEventListener("contextmenu", (e) => { e.preventDefault(); this.tabMenu(tab, row, e.clientX, e.clientY); });
    this.attachDrag(row, tab);
    window.FolioTabs?.attachTip(row, tab);  // memory / CPU card on hover
    return row;
  },

  updateRow(row, tab) {
    if (tab.selected) row.setAttribute("selected", "true"); else row.removeAttribute("selected");
    // Split view pair: joined rows (first/second) so you can see which two tabs are side by side.
    const sv = tab.splitview;
    const pos = sv ? [...(sv.tabs || [])].indexOf(tab) : -1;
    row.toggleAttribute("split-first", pos === 0);
    row.toggleAttribute("split-second", pos > 0);
    if (tab.pinned) row.setAttribute("pinned", "true"); else row.removeAttribute("pinned");
    // A hibernated tab is dimmed (its page is not loaded and costs no memory).
    if (window.FolioTabs?.isHibernated(tab)) row.setAttribute("hibernated", "true"); else row.removeAttribute("hibernated");
    // busy = the tab is loading; progress = bytes are arriving (before that it is still connecting).
    row.toggleAttribute("busy", tab.hasAttribute("busy"));
    row.toggleAttribute("progress", tab.hasAttribute("progress"));
    row.toggleAttribute("soundplaying", tab.hasAttribute("soundplaying"));
    row.toggleAttribute("muted", tab.hasAttribute("muted"));
    row.toggleAttribute("activemedia-blocked", tab.hasAttribute("activemedia-blocked"));
    const audioBtn = row.querySelector(".folio-side-tab-audio");
    if (audioBtn) {
      const tip = tab.hasAttribute("activemedia-blocked") ? "Play tab" : tab.hasAttribute("muted") ? "Unmute tab" : "Mute tab";
      if (audioBtn.getAttribute("tooltiptext") !== tip) { audioBtn.setAttribute("tooltiptext", tip); audioBtn.setAttribute("aria-label", tip); }
    }

    const icon = row.querySelector(".folio-side-tab-icon");
    const favicon = tab.getAttribute("image") || "";
    if (favicon) { if (icon.getAttribute("src") !== favicon) icon.setAttribute("src", favicon); }
    // A page without a favicon gets Firefox's generic globe (an empty gap looked like a missing row icon).
    else if (tab.linkedBrowser?.currentURI?.schemeIs?.("http") || tab.linkedBrowser?.currentURI?.schemeIs?.("https")) {
      icon.setAttribute("src", "chrome://global/skin/icons/defaultFavicon.svg");
    } else icon.removeAttribute("src");
    icon.toggleAttribute("default-favicon", !favicon && icon.hasAttribute("src"));

    // Folio's own F (new tab page) is drawn in the accent color instead of white.
    if (/folio-mark\.svg$/.test(favicon)) icon.setAttribute("folio-mark", ""); else icon.removeAttribute("folio-mark");
    const title = row.querySelector(".folio-side-tab-title");
    const label = tab.label || "New Tab";
    if (title.getAttribute("value") !== label) title.setAttribute("value", label);
    // Keyboard + screen readers: a tab in a vertical tablist; only the selected row is in the Tab order (roving focus).
    if (row.getAttribute("aria-label") !== label) row.setAttribute("aria-label", label);
    row.setAttribute("aria-selected", String(!!tab.selected));
    row.tabIndex = tab.selected ? 0 : -1;
  },

  // ---- Spaces and folders ----
  // A space is a set of tabs with its own folders; the switcher is at the bottom. Folders are groups of
  // tabs in one space. Both live in prefs (folio.spaces, folio.folders, folio.space.current). Each tab's
  // space and folder are also saved with its session (SessionStore custom values), so they survive a restart.
  spaces() {
    let a = [];
    try { a = JSON.parse(Services.prefs.getStringPref("folio.spaces", "[]")); } catch (e) {}
    return a.length ? a : [{ id: "s0", name: "Personal", color: "#9d8cff" }];
  },
  setSpaces(list) {
    Services.prefs.setStringPref("folio.spaces", JSON.stringify(list));
  },
  folders() {
    try { return JSON.parse(Services.prefs.getStringPref("folio.folders", "[]")); } catch (e) { return []; }
  },
  setFolders(list) {
    Services.prefs.setStringPref("folio.folders", JSON.stringify(list));
  },
  SPACE_COLORS: ["#7aa2f7", "#f7a27a", "#7af7b2", "#f77ab8", "#f7e27a", "#b07af7", "#7af7ef", "#f77a7a"],
  currentSpaceId() {
    const list = this.spaces();
    const id = Services.prefs.getStringPref("folio.space.current", list[0].id);
    return list.some(s => s.id === id) ? id : list[0].id;
  },
  tabSpace(tab) {
    // The saved value wins over the cached one: session restore creates tabs (TabOpen stamps the current space on them)
    // and only then hands them their saved space (2026-11-26: relaunching moved every tab into the current space).
    let v = "";
    try { v = SessionStore.getCustomTabValue(tab, "folioSpace"); } catch (e) {}
    if (v) tab.folioSpace = v;
    // A new tab's first attribute events come before its open event: it joins the current space.
    if (!tab.folioSpace) tab.folioSpace = this.currentSpaceId();
    return tab.folioSpace;
  },
  setTabSpace(tab, id) {
    tab.folioSpace = id;
    try { SessionStore.setCustomTabValue(tab, "folioSpace", id); } catch (e) {}
  },
  // A shared tab (one WhatsApp for all spaces, see folio-containers.js) belongs to every space at once.
  SHARED: "*",
  inSpace(tab, id) {
    const sp = this.tabSpace(tab);
    return sp === id || sp === this.SHARED;
  },
  tabFolder(tab) {
    let v;
    try { v = SessionStore.getCustomTabValue(tab, "folioFolder"); } catch (e) {}
    if (v !== undefined && v !== null && (v !== "" || tab.folioFolder === undefined)) tab.folioFolder = v || "";
    if (tab.folioFolder === undefined) tab.folioFolder = "";
    return tab.folioFolder;
  },
  setTabFolder(tab, id) {
    tab.folioFolder = id || "";
    try { SessionStore.setCustomTabValue(tab, "folioFolder", id || ""); } catch (e) {}
  },
  tabKey(tab) {
    if (!this._keys) this._keys = new WeakMap();
    if (!this._keys.has(tab)) this._keys.set(tab, Math.random().toString(36).slice(2, 9));
    return this._keys.get(tab);
  },
  liveTabs(spaceId) {
    return gBrowser.tabs.filter(t => !t.folioPlaceholder && !t.closing && (spaceId === undefined || this.inSpace(t, spaceId)));
  },

  // Hidden tabs (other spaces) can't be selected, so the selected tab is always one of this space's.
  applySpaces() {
    if (typeof gBrowser == "undefined" || !gBrowser.tabContainer) return;
    // Opening a tab fires events that come back here before the selection has moved: never re-enter.
    if (this._applying || this._switching) return;
    this._applying = true;
    try { this._applySpacesNow(); } finally { this._applying = false; }
  },
  _applySpacesNow() {
    const cur = this.currentSpaceId();
    const sel = gBrowser.selectedTab;
    if (sel && !sel.folioPlaceholder && !this.inSpace(sel, cur)) {
      const inCur = this.liveTabs(cur);
      if (inCur.length) gBrowser.selectedTab = inCur[inCur.length - 1];
      else { const fresh = gBrowser.addTrustedTab(Services.prefs.getStringPref("browser.newtab.url", "about:folio-newtab")); this.setTabSpace(fresh, cur); gBrowser.selectedTab = fresh; }
    }
    for (const t of gBrowser.tabs) {
      const want = t.folioPlaceholder || this.inSpace(t, cur);
      if (want && t.hidden) gBrowser.showTab(t);
      if (!want && !t.hidden && !t.selected) gBrowser.hideTab(t);
    }
  },

  // Each space has its own accent: its color drives --folio-accent while the space is active.
  applyAccent() {
    // With a wallpaper theme (or the desktop's, in see-through) the accent comes from the image, not from the space.
    if (document.documentElement.hasAttribute("folio-wallpaper") || document.documentElement.hasAttribute("folio-desktop-palette")) return;
    // A cached wallpaper palette is showing while the image loads (FolioTheme.applyCached): keep its accent.
    if (window.FolioTheme?._holdAccent) return;
    const s = this.spaces().find(x => x.id === this.currentSpaceId());
    const color = s?.color || "#9d8cff";
    document.documentElement.style.setProperty("--folio-accent", color);
    document.getElementById("folio-sidebar")?.style.setProperty("--folio-tint", color + "26");
  },

  setSpaceColor(id, color) {
    this.setSpaces(this.spaces().map(s => s.id === id ? { ...s, color } : s));
    if (id === this.currentSpaceId()) this.applyAccent();
    this._spaceSig = null;
    this.renderSpaces();
  },

  // ---- Each space has its own wallpaper and see-through setting ----
  // The prefs folio.theme.wallpaper.path and folio.seethrough always hold the CURRENT space's values, so everything
  // else (new tab page, site themes, the settings page) keeps reading them; switching spaces swaps the values in.
  applySpaceTheme(space) {
    this._themeSyncing = true;
    try {
      const w = space?.wallpaper || "";
      if (Services.prefs.getStringPref(FolioTheme.PREF, "") !== w) {
        if (w) Services.prefs.setStringPref(FolioTheme.PREF, w); else Services.prefs.clearUserPref(FolioTheme.PREF);
      }
      const st = !!space?.seethrough;
      if (Services.prefs.getBoolPref("folio.seethrough", false) !== st) Services.prefs.setBoolPref("folio.seethrough", st);
    } finally { this._themeSyncing = false; }
  },
  // The settings page changed the wallpaper / see-through: remember it on the current space.
  syncCurrentSpaceFromPrefs() {
    if (this._themeSyncing || this._switching) return;
    const id = this.currentSpaceId();
    const wp = Services.prefs.getStringPref(FolioTheme.PREF, "") || undefined;
    const st = Services.prefs.getBoolPref("folio.seethrough", false) || undefined;
    const list = this.spaces();
    const cur = list.find(x => x.id === id);
    if (!cur || ((cur.wallpaper || undefined) === wp && (cur.seethrough || undefined) === st)) return;
    this.setSpaces(list.map(x => x.id === id ? { ...x, wallpaper: wp, seethrough: st } : x));
  },
  // Delete wallpaper files that no space uses any more (copying a wallpaper shares the file).
  gcWallpapers(paths) {
    const used = new Set(this.spaces().map(s => s.wallpaper).filter(Boolean));
    used.add(Services.prefs.getStringPref(FolioTheme.PREF, ""));
    for (const p of new Set(paths)) if (p && !used.has(p)) IOUtils.remove(p, { ignoreAbsent: true }).catch(() => {});
  },
  // Once: spaces made before this existed all get the wallpaper / see-through that was global then.
  migrateSpaceThemes() {
    if (Services.prefs.getBoolPref("folio.spaces.themed", false)) return;
    Services.prefs.setBoolPref("folio.spaces.themed", true);
    const wp = Services.prefs.getStringPref(FolioTheme.PREF, "") || undefined;
    const st = Services.prefs.getBoolPref("folio.seethrough", false) || undefined;
    if (!wp && !st) return;
    this.setSpaces(this.spaces().map(s => ({ ...s, wallpaper: s.wallpaper || wp, seethrough: s.seethrough ?? st })));
  },

  // Entering a space: the old wallpaper dissolves and drifts away over the new one, the page card slides in from the
  // side it came from, and the space's icon and name appear for a moment. All of it is cosmetic (nothing waits for it).
  enterSpaceEffect(space, dir, oldWall) {
    this._enterFx?.forEach(a => { try { a.cancel(); } catch (e) {} });
    document.getElementById("folio-space-veil")?.remove();
    document.getElementById("folio-space-badge")?.remove();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const fx = [];
    const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
    if (oldWall) {
      const veil = this.el("div", { id: "folio-space-veil" });
      veil.style.backgroundImage = oldWall;
      root.setAttribute("folio-entering", "");
      document.getElementById("browser")?.prepend(veil);
      const a = veil.animate([
        { opacity: 1, transform: "translateX(0) scale(1)" },
        { opacity: 0, transform: `translateX(${-dir * 2.5}%) scale(1.09)` },
      ], { duration: 640, easing: ease, fill: "forwards" });
      a.onfinish = a.oncancel = () => { veil.remove(); root.removeAttribute("folio-entering"); };
      fx.push(a);
    }
    const card = document.getElementById("tabbrowser-tabbox");
    if (card) {
      fx.push(card.animate([
        { opacity: 0.35, transform: `translateX(${dir * 34}px) scale(0.985)` },
        { opacity: 1, transform: "none" },
      ], { duration: 520, easing: ease }));
    }
    const badge = this.el("div", { id: "folio-space-badge" }, this.spaceIconNode(space.icon, "folio-badge-icon"), this.el("span", {}, space.name));
    root.append(badge);
    const b = badge.animate([
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.86)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.22 },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.68 },
      { opacity: 0, transform: "translate(-50%, -50%) scale(1.05)" },
    ], { duration: 950, easing: "ease-out" });
    b.onfinish = b.oncancel = () => badge.remove();
    fx.push(b);
    this._enterFx = fx;
  },

  // A row of color swatches in a small popover (uses the menu's look and placement).
  colorPopover(space, x, y) {
    document.querySelector(".folio-menu")?.remove();
    const row = this.el("div", { class: "folio-swatch-row" },
      ...this.SPACE_COLORS.map(c => this.el("button", {
        class: "folio-swatch" + (c === space.color ? " selected" : ""), style: `--sw: ${c}`, title: c,
        onclick: () => { this.setSpaceColor(space.id, c); this.closeMenu(pop); },
      })));
    const pop = this.el("div", { class: "folio-menu folio-color-pop", style: `left:${x}px; top:${y}px` }, row);
    document.documentElement.append(pop);
    const r = pop.getBoundingClientRect();
    if (y + r.height > window.innerHeight - 8) pop.style.top = Math.max(8, y - r.height) + "px";
    if (x + r.width > window.innerWidth - 8) pop.style.left = Math.max(8, x - r.width) + "px";
    const off = (e) => { if (!pop.contains(e.target)) { this.closeMenu(pop); window.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => window.addEventListener("pointerdown", off, true), 0);
  },

  switchSpace(id) {
    if (id === this.currentSpaceId() || this._switching) return;
    this._prevSpace = this.currentSpaceId();
    window.FolioTabs?.spaceLeft(this._prevSpace);
    window.FolioTabs?.spaceEntered(id);
    this._switching = true;
    try { this._switchSpaceNow(id); } finally { this._switching = false; }
    // Only now, after the switch, fix hidden tabs and the list (the space check skips itself while switching).
    this.applySpaces();
    this.renderTabs();
  },
  _switchSpaceNow(id) {
    Services.prefs.setStringPref("folio.space.current", id);
    const inSpace = this.liveTabs(id);
    for (const t of inSpace) if (t.hidden) gBrowser.showTab(t);
    let target = inSpace.slice().sort((a, b) => (b.folioLast || 0) - (a.folioLast || 0))[0];
    if (!target) { target = gBrowser.addTrustedTab(Services.prefs.getStringPref("browser.newtab.url", "about:folio-newtab")); this.setTabSpace(target, id); }
    gBrowser.selectedTab = target;
    // Direction: forward (+1) or back (-1), going the shorter way round when wrapping (Zen does the same).
    const order = this.spaces();
    const from = order.findIndex(s => s.id === this._prevSpace);
    const to = order.findIndex(s => s.id === id);
    let diff = to - from;
    if (from >= 0) {
      if (diff > order.length / 2) diff -= order.length;
      else if (diff < -order.length / 2) diff += order.length;
    }
    const dir = diff < 0 ? -1 : 1;
    const list = document.getElementById("folio-sidebar-tabs");
    const side = document.getElementById("folio-sidebar");
    const space = order.find(s => s.id === id);
    this.applyAccent();
    const root = document.documentElement;
    const oldWall = root.hasAttribute("folio-wallpaper") ? root.style.getPropertyValue("--folio-wallpaper") : "";
    this.applySpaceTheme(space);
    this.enterSpaceEffect(space, dir, oldWall);
    if (list) {
      list.style.setProperty("--folio-slide-dir", String(dir));
      list.classList.remove("folio-switching"); void list.offsetWidth; list.classList.add("folio-switching");
    }
  },

  // Animated icons (Pulsoicon's, played by folio-icons.mjs): the bottom buttons, the space "+" and the tab close ×.
  // They move only when you hover them or when something happens (a download starts). Without the module, the old static icons stay.
  setupIcons() {
    let mod;
    try { mod = ChromeUtils.importESModule("chrome://browser/content/folio-settings/folio-icons.mjs"); } catch (e) { console.warn("Folio icons:", e); return; }
    this._makeIcon = (name, opts) => { try { return mod.makeIcon(document, name, opts); } catch (e) { return null; } };
    const names = { gear: "settings", download: "download", clock: "clock" };
    for (const b of document.querySelectorAll(".folio-side-button[data-folio-icon]")) {
      const n = names[b.getAttribute("data-folio-icon")];
      if (!n || b.querySelector(".folio-pulso")) continue;
      const svg = this._makeIcon(n, { size: 18, trigger: b });
      if (!svg) continue;
      b.append(svg);
      b.setAttribute("folio-pulso", "");
      if (n === "download") {
        // The arrow plays when a download starts.
        try {
          const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
          Downloads.getList(Downloads.ALL) // ALL is a key string, not 0 (getList(0) returned nothing: the arrow never played)
            .then((list) => FolioSidebar.watchDownloads(list, b, svg)).catch((e) => console.warn("Folio downloads:", e));

        } catch (e) { /* no downloads module: hover still works */ }
      }
    }
  },

  // Download feedback (night shift 2026-11-24). Before, a download only wiggled the sidebar arrow once: no progress,
  // no sign it finished. Now the Downloads button carries a progress ring while anything downloads (a spinning arc
  // when the size is unknown), and a notice says when a file is done (with "Show in folder") or failed.
  // Downloads that were already finished when the window opened are ignored.
  watchDownloads(list, button, svg) {
    const active = new Set();
    const announced = new WeakSet();
    const update = () => {
      let cur = 0, total = 0, unknown = false;
      for (const d of active) {
        if (d.hasProgress && d.totalBytes > 0) { cur += d.currentBytes; total += d.totalBytes; } else unknown = true;
      }
      button.toggleAttribute("folio-dl-active", active.size > 0);
      button.toggleAttribute("folio-dl-unknown", active.size > 0 && !total);
      button.style.setProperty("--folio-dl-progress", total ? Math.round((cur / total) * 100) + "%" : "25%");
      const n = active.size;
      button.setAttribute("tooltiptext", n ? `Downloads (${n} in progress${total ? ", " + Math.round((cur / total) * 100) + "%" : ""})` : "Downloads");
    };
    const isMine = () => Services.wm.getMostRecentWindow("navigator:browser") === window;
    const name = (d) => PathUtils.filename(d.target?.path || "") || "file";
    const settle = (d) => {
      if (!active.has(d) || !d.stopped) return;
      active.delete(d);
      if (announced.has(d)) return;
      announced.add(d);
      if (!isMine()) return;
      if (d.succeeded) {
        window.FolioToast?.show(["Downloaded ", name(d)], {
          timeout: 5000,
          action: { label: "Show in folder", run: () => { try { const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile); f.initWithPath(d.target.path); f.reveal(); } catch (e) { this.toggleView?.("downloads"); } } },
        });
      } else if (d.error) {
        window.FolioToast?.show(["Download failed: ", name(d)], { timeout: 5000, action: { label: "Downloads", run: () => this.toggleView?.("downloads") } });
      }
    };
    list.addView({
      onDownloadAdded: (d) => {
        if (d.stopped) return; // old entries from history
        active.add(d);
        svg?.folioPlay?.();
        update();
      },
      onDownloadChanged: (d) => {
        if (!d.stopped && !active.has(d) && !announced.has(d)) active.add(d); // a retried/resumed download
        settle(d);
        update();
      },
      onDownloadRemoved: (d) => { active.delete(d); update(); },
    });
  },

  // Space shortcuts: next / previous wrap around; "go to space N" does nothing when there is no space N.

  switchSpaceBy(delta) {
    const list = this.spaces();
    if (list.length < 2) return;
    const i = list.findIndex(s => s.id === this.currentSpaceId());
    this.switchSpace(list[(i + delta + list.length) % list.length].id);
  },
  switchSpaceNumber(n) {
    const s = this.spaces()[n - 1];
    if (s) this.switchSpace(s.id);
  },

  newSpace() {
    const list = this.spaces();
    const id = "s" + Date.now().toString(36);
    const color = this.SPACE_COLORS[list.length % this.SPACE_COLORS.length];
    this.setSpaces([...list, { id, name: "Space " + (list.length + 1), color }]);
    this.switchSpace(id);
  },

  renameSpace(id, name) {
    const clean = (name || "").trim();
    if (!clean) return;
    this.setSpaces(this.spaces().map(s => s.id === id ? { ...s, name: clean } : s));
    this._spaceSig = null;
    this.renderSpaces();
  },

  // ---- Space switcher, Create a Space form, icon picker: built to match Zen's (studied from its source) ----
  // Icon set and emoji data are Zen's (MPL-2.0), in folio-settings/content/space-icons and folio-emojis.js.
  SPACE_ICONS: [
    "airplane.svg", "american-football.svg", "baseball.svg", "basket.svg",
    "bed.svg", "bell.svg", "bookmark.svg", "book.svg",
    "briefcase.svg", "brush.svg", "bug.svg", "build.svg",
    "cafe.svg", "call.svg", "card.svg", "chat.svg",
    "checkbox.svg", "circle.svg", "cloud.svg", "code.svg",
    "coins.svg", "construct.svg", "cutlery.svg", "egg.svg",
    "extension-puzzle.svg", "eye.svg", "fast-food.svg", "fish.svg",
    "flag.svg", "flame.svg", "flask.svg", "folder.svg",
    "game-controller.svg", "globe-1.svg", "globe.svg", "grid-2x2.svg",
    "grid-3x3.svg", "heart.svg", "ice-cream.svg", "image.svg",
    "inbox.svg", "key.svg", "layers.svg", "leaf.svg",
    "lightning.svg", "location.svg", "lock-closed.svg", "logo-rss.svg",
    "logo-usd.svg", "mail.svg", "map.svg", "megaphone.svg",
    "moon.svg", "music.svg", "navigate.svg", "nuclear.svg",
    "page.svg", "palette.svg", "paw.svg", "people.svg",
    "pizza.svg", "planet.svg", "present.svg", "rocket.svg",
    "school.svg", "shapes.svg", "shirt.svg", "skull.svg",
    "squares.svg", "square.svg", "star-1.svg", "star.svg",
    "stats-chart.svg", "sun.svg", "tada.svg", "terminal.svg",
    "ticket.svg", "time.svg", "trash.svg", "triangle.svg",
    "video.svg", "volume-high.svg", "wallet.svg", "warning.svg",
    "water.svg", "weight.svg",
  ],
  iconURL(name) {
    return "chrome://browser/content/folio-settings/space-icons/" + name;
  },
  // A space icon is an emoji (text) or "svg:<file>" from the set above. Nothing set = a small dot.
  spaceIconNode(icon, cls) {
    if (icon && icon.startsWith("svg:")) {
      return this.el("img", { class: cls + " folio-icon-svg", src: this.iconURL(icon.slice(4)), alt: "" });
    }
    if (icon) return this.el("span", { class: cls + " folio-icon-emoji" }, icon);
    return this.el("span", { class: cls + " folio-icon-none" });
  },

  // Bottom bar: one small button per space (dot, emoji or icon), centered; "+" on the right.
  // Inactive spaces are grayscale at 70% opacity; the active one, or a hovered one, is full color.
  _addButton() {
    const add = this.el("button", { class: "folio-space-add", title: "Create a Space", onclick: () => this.openSpaceCreation() }, "+");
    const ic = this._makeIcon?.("plus", { size: 14, strokeWidth: 2.4, trigger: add });
    if (ic) add.replaceChildren(ic);
    return add;
  },
  renderSpaces() {
    const bar = document.getElementById("folio-spaces");
    if (!bar || typeof gBrowser == "undefined") return;
    const list = this.spaces();
    const cur = this.currentSpaceId();
    const sig = JSON.stringify(list) + "|" + cur;
    if (this._spaceSig === sig) return;
    this._spaceSig = sig;
    this.applyAccent(); // the space list or the active space changed: keep the accent in step
    const buttons = list.map(s => {
      const btn = this.el("button", {
        class: "folio-space" + (s.id === cur ? " active" : ""), title: s.name,
        onclick: () => this.switchSpace(s.id),
        oncontextmenu: (e) => { e.preventDefault(); this.spaceMenu(s, e.clientX, e.clientY, btn); },
      }, this.spaceIconNode(s.icon, "folio-space-icon"));
      return btn;
    });
    bar.replaceChildren(
      this.el("span", { class: "folio-spaces-balance" }),
      this.el("div", { class: "folio-spaces-list" }, ...buttons),
      this._addButton());
    // The current space's name above the tabs (Zen's sidebar shows it): slides in from the side you moved toward.
    // Zen layout (2026-11-26, Sammy): the space switcher lives in the bottom bar, right side; the current space's
    // name stays above the tabs.
    const bottom = document.getElementById("folio-sidebar-bottom");
    if (bottom && bar.parentNode !== bottom) bottom.append(bar);
    let label = document.getElementById("folio-space-name");
    if (!label) {
      label = this.el("div", { id: "folio-space-name" });
      bar.after(label);
    }
    // Right under the Essentials (they share the tab list's container), above folders and tabs.
    const tabsList = document.getElementById("folio-sidebar-tabs");
    let ess = tabsList?.querySelector(".folio-ess-grid");
    while (ess && ess.parentNode && ess.parentNode !== tabsList && ess.parentNode !== tabsList.parentNode) ess = ess.parentNode;
    if (ess && ess.nextElementSibling !== label) ess.after(label);
    else if (!ess && tabsList && label.nextElementSibling !== tabsList) tabsList.before(label);
    const space = list.find(s => s.id === cur);
    const name = space?.name || "";
    if (label.textContent !== name) {
      const from = list.findIndex(s => s.name === label.textContent), to = list.findIndex(s => s.id === cur);
      label.replaceChildren(this.spaceIconNode(space?.icon, "folio-space-name-icon") || "", this.el("span", {}, name));
      label.hidden = list.length < 2 || !name;
      if (from >= 0 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const dx = to > from ? 14 : -14;
        label.animate([{ opacity: 0, transform: `translateX(${dx}px)` }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,0,0,1)" });
      }
    }
  },

  spaceMenu(space, x, y, anchor) {
    const items = [["Edit space…", () => this.openSpaceForm(space)], ["Rename", () => this.renameSpacePrompt(space)], ["Change icon", () => {
      this.openIconPicker(anchor, { closeOnSelect: true, allowNone: true, onSelect: (icon) => {
        this.setSpaces(this.spaces().map(s => s.id === space.id ? { ...s, icon: icon || undefined } : s));
        this._spaceSig = null; this.renderSpaces();
      } });
    }]];
    items.push(["Change color", () => this.colorPopover(space, x, y)]);
    if (this.spaces().length > 1) items.push(["Delete space", () => this.deleteSpace(space.id), { danger: true }]);
    this.showMenu(x, y, items);
  },

  // Rename in place: the space's button turns into a small text field.
  renameSpacePrompt(space) {
    const btn = [...document.querySelectorAll(".folio-space")][this.spaces().findIndex(s => s.id === space.id)];
    if (!btn) return;
    const input = this.el("input", { class: "folio-space-input", type: "text", value: space.name });
    const done = (save) => { if (save) this.renameSpace(space.id, input.value); else { this._spaceSig = null; this.renderSpaces(); } };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true));
    btn.replaceWith(input);
    input.focus(); input.select();
  },

  // ---- Create / edit a Space: fills the sidebar, like Zen's. Entrance: each part rises 20px, fades in and
  // un-blurs (2px) over 0.3s, 30ms apart (Zen's values); leaving plays it back in reverse. Editing shows the
  // same form with the space's values, plus its look: copy a wallpaper from another space, a new wallpaper, see-through. ----
  openSpaceCreation() { this.openSpaceForm(null); },
  openSpaceForm(space) {
    const editing = !!space;
    this.closeView();
    this.current = "create";
    document.getElementById("folio-sidebar-tabs").hidden = true;
    const view = document.getElementById("folio-sidebar-view");
    view.hidden = false;
    const order = this.spaces();
    const draft = {
      icon: space?.icon || null,
      color: space?.color || this.SPACE_COLORS[order.length % this.SPACE_COLORS.length],
      wallpaper: space?.wallpaper,
      seethrough: !!space?.seethrough,
      separate: !!space?.separate,
    };
    const made = []; // wallpaper files made in this form: deleted again if it is cancelled

    const iconSlot = this.el("button", { class: "folio-create-icon", title: "Choose an icon" });
    const setIcon = (v) => { draft.icon = v; iconSlot.replaceChildren(...(v ? [this.spaceIconNode(v, "folio-create-icon-inner")] : [])); iconSlot.toggleAttribute("has-icon", !!v); };
    setIcon(draft.icon);
    iconSlot.addEventListener("click", () => this.openIconPicker(iconSlot, { closeOnSelect: false, allowNone: true, onSelect: setIcon }));
    const name = this.el("input", { class: "folio-create-name", type: "text", placeholder: "Space name", value: space?.name || "" });
    const create = this.el("button", { class: "folio-create-primary", disabled: editing ? undefined : "true" }, editing ? "Save" : "Create Space");
    if (editing) create.removeAttribute("disabled");
    name.addEventListener("input", () => { if (name.value.trim()) create.removeAttribute("disabled"); else create.setAttribute("disabled", "true"); });
    const swatches = this.el("div", { class: "folio-create-swatches", hidden: "true" },
      ...this.SPACE_COLORS.map(c => {
        const sw = this.el("button", { class: "folio-swatch" + (c === draft.color ? " selected" : ""), style: `--sw: ${c}`, title: c,
          onclick: () => { draft.color = c; for (const o of swatches.children) o.classList.toggle("selected", o === sw); } });
        return sw;
      }));
    const theme = this.el("button", { class: "folio-create-theme", onclick: () => swatches.toggleAttribute("hidden") }, "Color…");
    const look = this.spaceLookSection(draft, space?.id, made);
    const cancel = this.el("button", { class: "folio-create-secondary" }, "Cancel");

    const title = this.el("h1", { class: "folio-create-title" }, editing ? "Edit Space" : "Create a Space");
    const sub = this.el("p", { class: "folio-create-sub" }, editing ? "Name, icon, color and look of this space." : "Spaces are used to organize your tabs and sessions.");
    const nameRow = this.el("div", { class: "folio-create-name-row" }, iconSlot, name);
    const createWrap = this.el("div", {}, create);
    const parts = [title, sub, nameRow, theme, swatches, look.node, createWrap, cancel];
    const form = this.el("div", { class: "folio-create" },
      this.el("div", { class: "folio-create-head" }, title, sub),
      this.el("div", { class: "folio-create-form" }, nameRow, theme, swatches, look.node),
      this.el("div", { class: "folio-create-buttons" }, createWrap, cancel));
    view.replaceChildren(form);
    parts.forEach((p, i) => { p.style.animationDelay = (i * 30) + "ms"; p.classList.add("folio-rise-in"); });
    name.focus();

    const leave = (then) => {
      [...parts].reverse().forEach((p, i) => { p.classList.remove("folio-rise-in"); p.style.animationDelay = (i * 30) + "ms"; p.classList.add("folio-rise-out"); });
      setTimeout(() => { look.dispose(); this.closeView(); then?.(); }, 300 + parts.length * 30);
    };
    cancel.addEventListener("click", () => { leave(); this.gcWallpapers(made); });
    const submit = () => {
      const label = name.value.trim();
      if (!label) return;
      if (editing) {
        const next = { ...space, name: label, color: draft.color, icon: draft.icon || undefined, wallpaper: draft.wallpaper || undefined, seethrough: draft.seethrough || undefined, separate: draft.separate || undefined };
        this.setSpaces(this.spaces().map(s => s.id === space.id ? next : s));
        if (space.id === this.currentSpaceId()) this.applySpaceTheme(next);
        this.gcWallpapers([space.wallpaper, ...made]);
        this._spaceSig = null;
        this.renderSpaces();
        leave();
      } else {
        const id = "s" + Date.now().toString(36);
        this.setSpaces([...this.spaces(), { id, name: label, color: draft.color, icon: draft.icon || undefined, wallpaper: draft.wallpaper || undefined, seethrough: draft.seethrough || undefined, separate: draft.separate || undefined }]);
        leave(() => this.switchSpace(id));
      }
    };
    create.addEventListener("click", submit);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { leave(); this.gcWallpapers(made); } });
  },

  // The look of one space: its wallpaper (copy from another space, or a new image) and see-through.
  spaceLookSection(draft, selfId, made) {
    const urls = new Map();
    const urlOf = async (path) => {
      if (!path) return "";
      if (!urls.has(path)) urls.set(path, await FolioTheme.urlFor(path));
      return urls.get(path);
    };
    const preview = this.el("div", { class: "folio-look-preview" });
    const others = this.spaces().filter(s => s.id !== selfId);
    const cards = [];
    const paint = async () => {
      const url = await urlOf(draft.wallpaper);
      preview.style.backgroundImage = url ? `url("${url}")` : "none";
      preview.toggleAttribute("empty", !url);
      preview.textContent = url ? "" : "No wallpaper";
      for (const [s, card] of cards) card.toggleAttribute("selected", !!draft.wallpaper && s.wallpaper === draft.wallpaper);
      removeBtn.hidden = !draft.wallpaper;
    };
    const removeBtn = this.el("button", { class: "folio-look-btn", onclick: () => { draft.wallpaper = undefined; paint(); } }, "No wallpaper");
    const newBtn = this.el("button", { class: "folio-look-btn primary", onclick: async () => {
      const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
      fp.init(window.browsingContext, "Choose a wallpaper", Ci.nsIFilePicker.modeOpen);
      fp.appendFilters(Ci.nsIFilePicker.filterImages);
      const res = await new Promise(r => fp.open(r));
      if (res !== Ci.nsIFilePicker.returnOK) return;
      try {
        const path = await FolioTheme.newWallpaperFile(new Blob([await IOUtils.read(fp.file.path)]));
        made.push(path);
        draft.wallpaper = path;
        paint();
      } catch (e) { console.warn("Folio: wallpaper could not be read", e); }
    } }, "New wallpaper…");
    const kids = [this.el("div", { class: "folio-look-label" }, "Wallpaper"), preview, this.el("div", { class: "folio-look-actions" }, newBtn, removeBtn)];
    if (others.length) {
      const strip = this.el("div", { class: "folio-look-strip" });
      for (const s of others) {
        const thumb = this.el("div", { class: "folio-look-thumb" });
        const card = this.el("button", {
          class: "folio-look-card", title: s.wallpaper ? `Copy the wallpaper from ${s.name}` : `${s.name} has no wallpaper`,
          onclick: () => { if (s.wallpaper) { draft.wallpaper = s.wallpaper; paint(); } },
        }, thumb, this.el("span", { class: "folio-look-name" }, s.name));
        card.toggleAttribute("nowall", !s.wallpaper);
        cards.push([s, card]);
        strip.append(card);
        urlOf(s.wallpaper).then(u => { thumb.style.backgroundImage = u ? `url("${u}")` : "none"; });
      }
      kids.push(this.el("div", { class: "folio-look-label" }, "Copy wallpaper from"), strip);
    }
    const sw = this.el("button", { class: "folio-look-switch", role: "switch", "aria-checked": String(draft.seethrough), onclick: () => {
      draft.seethrough = !draft.seethrough;
      sw.setAttribute("aria-checked", String(draft.seethrough));
    } }, this.el("span", { class: "folio-look-knob" }));
    kids.push(this.el("div", { class: "folio-look-row" }, this.el("span", {}, "See-through"), sw));
    const sep = this.el("button", { class: "folio-look-switch", role: "switch", "aria-checked": String(draft.separate), onclick: () => {
      draft.separate = !draft.separate;
      sep.setAttribute("aria-checked", String(draft.separate));
    } }, this.el("span", { class: "folio-look-knob" }));
    kids.push(this.el("div", { class: "folio-look-row", title: "New tabs in this space get their own logins and site data, so the same site can be signed in differently here." }, this.el("span", {}, "Separate logins"), sep));
    paint();
    return { node: this.el("div", { class: "folio-look" }, ...kids), dispose: () => { for (const u of urls.values()) if (u) URL.revokeObjectURL(u); } };
  },

  // ---- Icon picker: Zen's layout. Header: [Emojis | Icons] tabs and a trash ("no icon") button.
  // Two pages side by side that slide; emojis have a tag search. 250px wide. ----
  openIconPicker(anchor, { onSelect, closeOnSelect = true, allowNone = true } = {}) {
    let panel = document.getElementById("folio-icon-picker");
    if (!panel) {
      panel = document.createXULElement("panel");
      panel.id = "folio-icon-picker";
      panel.setAttribute("type", "arrow");
      panel.className = "folio-picker";
      (document.getElementById("mainPopupSet") || document.documentElement).append(panel);
      panel.addEventListener("popuphidden", () => { panel.replaceChildren(); });
    }
    if (!this._emojis) {
      const scope = {};
      Services.scriptloader.loadSubScript("chrome://browser/content/folio-settings/folio-emojis.js", scope);
      this._emojis = scope.ZenEmojisData || [];
    }
    const pick = (value) => { onSelect?.(value); if (closeOnSelect) panel.hidePopup(); };
    const tabEmoji = this.el("button", { class: "folio-picker-tab selected" }, "Emojis");
    const tabIcons = this.el("button", { class: "folio-picker-tab" }, "Icons");
    const none = this.el("button", { class: "folio-picker-none", title: "No icon", onclick: () => pick(null) },
      this.el("img", { class: "folio-icon-svg", src: this.iconURL("trash.svg"), alt: "" }));
    if (!allowNone) none.style.visibility = "hidden";
    const header = this.el("div", { class: "folio-picker-header" }, this.el("span", { class: "folio-picker-balance" }),
      this.el("div", { class: "folio-picker-tabs" }, tabEmoji, tabIcons), none);
    const search = this.el("input", { class: "folio-picker-search", type: "search", placeholder: "Search emojis" });
    const emojiGrid = this.el("div", { class: "folio-picker-grid" });
    const frag = document.createDocumentFragment();
    for (const e of this._emojis) frag.append(this.el("button", { class: "folio-picker-emoji", onclick: () => pick(e.emoji) }, e.emoji));
    emojiGrid.append(frag);
    search.addEventListener("input", () => {
      const v = search.value.trim().toLowerCase();
      const kids = emojiGrid.children;
      for (let i = 0; i < kids.length; i++) kids[i].hidden = !!v && !this._emojis[i].tags.some(t => t.toLowerCase().includes(v));
    });
    const iconGrid = this.el("div", { class: "folio-picker-grid" },
      ...this.SPACE_ICONS.map(n => this.el("button", { class: "folio-picker-svg", onclick: () => pick("svg:" + n) },
        this.el("img", { class: "folio-icon-svg", src: this.iconURL(n), alt: "" }))));
    const pageEmoji = this.el("div", { class: "folio-picker-page" }, search, emojiGrid);
    const pageIcons = this.el("div", { class: "folio-picker-page" }, iconGrid);
    const pages = this.el("div", { class: "folio-picker-pages" }, pageEmoji, pageIcons);
    const show = (icons) => {
      pages.scrollTo({ left: icons ? pageIcons.offsetLeft : 0, behavior: "smooth" });
      tabEmoji.classList.toggle("selected", !icons);
      tabIcons.classList.toggle("selected", icons);
    };
    tabEmoji.addEventListener("click", () => show(false));
    tabIcons.addEventListener("click", () => show(true));
    panel.replaceChildren(this.el("div", { class: "folio-picker-body" }, header, pages));
    panel.openPopup(anchor, "after_start", 0, 4, false, false);
    setTimeout(() => search.focus({ preventScroll: true }), 50);
  },

  // ---- Folders ----
  folderEl(f) {
    let e = this._folderEls.get(f.id);
    if (!e) {
      const el = document.createXULElement("vbox");
      el.className = "folio-folder";
      const head = document.createXULElement("hbox");
      head.className = "folio-folder-head";
      head.setAttribute("folio-folder-id", f.id);
      const name = document.createXULElement("label");
      name.className = "folio-folder-name";
      name.setAttribute("crop", "end");
      name.setAttribute("flex", "1");
      const iconClosed = document.createXULElement("hbox");
      iconClosed.className = "folio-folder-icon folio-folder-icon-closed";
      const iconOpen = document.createXULElement("hbox");
      iconOpen.className = "folio-folder-icon folio-folder-icon-open";
      const count = document.createXULElement("label");
      count.className = "folio-folder-count";
      head.append(iconClosed, iconOpen, name, count);
      // Primary button toggles. Right-click opens the folder menu (Gecko also sends `click` for it).
      head.addEventListener("click", (e) => { if (e.button === 0) this.toggleFolder(f.id); });
      head.addEventListener("contextmenu", (e) => { e.preventDefault(); this.folderMenu(f.id, e.clientX, e.clientY); });
      const body = document.createXULElement("vbox");
      body.className = "folio-folder-body";
      const inner = document.createXULElement("vbox");
      inner.className = "folio-folder-inner";
      body.append(inner);
      el.append(head, body);
      e = { el, head, name, count, inner, body, open: !!f.open, anim: null };
      el.classList.toggle("collapsed", !f.open);
      body.style.height = f.open ? "" : "0px";
      this._folderEls.set(f.id, e);
    } else if (e.open !== !!f.open) {
      e.open = !!f.open;
      this.animateFolder(e, e.open);
    }
    if (e.name.getAttribute("value") !== f.name) e.name.setAttribute("value", f.name);
    return e;
  },

  // Zen's timing: open ~200 ms ease-out, close ~170 ms. XUL boxes can't animate grid rows, so the
  // body's height is animated directly with the Web Animations API.
  animateFolder(e, open) {
    e.el.classList.toggle("collapsed", !open);
    e.anim?.cancel();
    e.anim = null;
    const body = e.body;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!body.animate || reduce) { body.style.height = open ? "" : "0px"; return; }
    const from = body.getBoundingClientRect().height;
    const to = open ? e.inner.getBoundingClientRect().height : 0;
    const anim = body.animate(
      [{ height: from + "px", opacity: open ? 0 : 1 }, { height: to + "px", opacity: open ? 1 : 0 }],
      { duration: open ? 200 : 170, easing: open ? "cubic-bezier(0, 0, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)" }
    );
    e.anim = anim;
    anim.onfinish = () => {
      if (e.anim !== anim) return;
      e.anim = null;
      body.style.height = open ? "" : "0px";
    };
  },

  toggleFolder(id) {
    this.setFolders(this.folders().map(f => f.id === id ? { ...f, open: !f.open } : f));
    this.renderTabs();
  },

  folderMenu(id, x, y) {
    const f = this.folders().find(x2 => x2.id === id);
    if (!f) return;
    this.showMenu(x, y, [
      ["Rename", () => this.renameFolderPrompt(id)],
      [f.open ? "Collapse" : "Expand", () => this.toggleFolder(id)],
      ["Delete folder, keep tabs", () => this.deleteFolder(id, false)],
      ["Delete folder and close its tabs", () => this.deleteFolder(id, true), { danger: true }],
    ]);
  },

  // Inline rename in the folder header, like the space rename.
  renameFolderPrompt(id) {
    const e = this._folderEls.get(id);
    const f = this.folders().find(x => x.id === id);
    if (!e || !f) return;
    const input = this.el("input", { class: "folio-folder-input", type: "text", value: f.name });
    let closed = false;
    const done = (save) => {
      if (closed) return;
      closed = true;
      const v = input.value.trim();
      input.remove();
      e.name.hidden = false;
      if (save && v) this.setFolders(this.folders().map(x => x.id === id ? { ...x, name: v } : x));
      this.renderTabs();
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") done(true); if (ev.key === "Escape") done(false); });
    input.addEventListener("blur", () => done(true));
    e.name.hidden = true;
    e.head.insertBefore(input, e.name);
    input.focus(); input.select();
  },

  // Delete a folder. Its tabs either stay in the space (loose) or close with it.
  deleteFolder(id, closeTabs) {
    const members = gBrowser.tabs.filter(t => !t.folioPlaceholder && !t.closing && this.tabFolder(t) === id);
    for (const t of members) {
      if (closeTabs) this.closeTabSafely(t);
      else this.setTabFolder(t, "");
    }
    this.setFolders(this.folders().filter(f => f.id !== id));
    // The folder's element animates out in renderTabs (closeFolderEl), like a closing tab.
    this.renderTabs();
  },

  // A folder that goes away collapses and fades out in place, like a closing tab row. The element is
  // removed after the animation, then the layout is re-rendered.
  closeFolderEl(id) {
    const fe = this._folderEls.get(id);
    this._folderEls.delete(id);
    if (!fe || !fe.el.parentNode || fe.el.classList.contains("folio-closing")) { fe?.el.remove(); return; }
    const el = fe.el;
    el.classList.add("folio-closing");
    el.style.overflow = "hidden";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Same timing as the closing row inside it (0.18 s ease), so the two shrink together.
    if (el.animate && !reduce) {
      const h = this._foldH?.get(id) || el.getBoundingClientRect().height;
      el.animate(
        [{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
        { duration: 180, easing: "ease", fill: "forwards" }  // hold the final frame until it's removed
      );
    }
    setTimeout(() => { el.remove(); this.renderTabs(); }, reduce ? 0 : 190);
  },

  newFolderFrom(a, b) {
    const cur = this.currentSpaceId();
    const folders = this.folders();
    const id = "f" + Date.now().toString(36);
    const count = folders.filter(f => f.spaceId === cur).length + 1;
    this.setFolders([...folders, { id, name: "Folder " + count, spaceId: cur, open: true }]);
    this.setTabFolder(a, id);
    this.setTabFolder(b, id);
    this.pruneFolders();
  },

  moveToFolder(tab, folderId) {
    if (this.tabFolder(tab) === folderId) return;
    this.setTabFolder(tab, folderId);
    if (folderId) {
      this.setFolders(this.folders().map(f => f.id === folderId ? { ...f, open: true } : f));
    }
    this.pruneFolders();
  },

  // A folder with no tabs left goes away.
  pruneFolders() {
    const all = this.folders();
    const live = all.filter(f => gBrowser.tabs.some(t => !t.folioPlaceholder && !t.closing && this.tabFolder(t) === f.id));
    if (live.length !== all.length) this.setFolders(live);
  },

  // A small menu at the pointer. Clicking anywhere else closes it.
  // A small menu at the pointer. It flips up (or left) when it wouldn't fit in the window.
  // Items: [label, action, { danger }]. Clicking anywhere else closes it.
  // Menus leave the way they came in: a quick fade and shrink toward where they opened (130 ms), then removed.
  // A closing menu takes no clicks and doesn't count as open (FolioPeek checks for open menus).
  closeMenu(menu) {
    if (!menu?.isConnected || menu.classList.contains("folio-menu-closing")) return;
    menu.classList.add("folio-menu-closing");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { menu.remove(); return; }
    menu.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.95) translateY(-4px)" }],
      { duration: 130, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }).finished.then(() => menu.remove(), () => menu.remove());
  },

  showMenu(x, y, items) {
    document.querySelector(".folio-menu")?.remove();
    // "-" between items draws a separator (leading, trailing and doubled ones are dropped).
    items = items.filter((it, i, a) => it !== "-" || (i > 0 && i < a.length - 1 && a[i - 1] !== "-"));
    const menu = this.el("div", { class: "folio-menu", style: `left:${x}px; top:${y}px` },
      ...items.map((it) => it === "-" ? this.el("div", { class: "folio-menu-sep" }) : this.el("button", {
        class: "folio-menu-item" + (it[2]?.danger ? " folio-menu-danger" : ""),
        onclick: () => { this.closeMenu(menu); it[1](); },
      }, ...(it[2]?.icon ? [this.el("span", { class: "folio-menu-icon", style: `--icon:url("chrome://${it[2].icon}")` })] : []), it[0])));
    document.documentElement.append(menu);
    const r = menu.getBoundingClientRect();
    const pad = 8;
    let top = y, left = x, originY = "top", originX = "left";
    if (y + r.height > window.innerHeight - pad) { top = Math.max(pad, y - r.height); originY = "bottom"; }
    if (x + r.width > window.innerWidth - pad) { left = Math.max(pad, x - r.width); originX = "right"; }
    menu.style.top = top + "px";
    menu.style.left = left + "px";
    menu.style.transformOrigin = originY + " " + originX;
    const close = () => { this.closeMenu(menu); window.removeEventListener("pointerdown", off, true); window.removeEventListener("keydown", esc, true); };
    const off = (e) => { if (!menu.contains(e.target)) close(); };
    const back = document.activeElement;
    const esc = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); if (back?.isConnected) back.focus(); return; }
      // Arrow keys walk the items (keyboard use: the menu opens with its first item focused).
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...menu.querySelectorAll(".folio-menu-item")];
        const i = items.indexOf(document.activeElement);
        const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[n]?.focus();
        e.preventDefault(); e.stopPropagation();
      }
    };
    menu.querySelector(".folio-menu-item")?.focus({ focusVisible: false });
    setTimeout(() => { window.addEventListener("pointerdown", off, true); window.addEventListener("keydown", esc, true); }, 0);
  },

  // Adds the tab's page to Essentials (its color and icon read now; the tab stays open), or removes its site.
  async toggleEssentialFromTab(tab) {
    const url = tab.linkedBrowser?.currentURI?.spec;
    if (!url) return;
    const host = this.hostOf(url);
    if (this.isEssentialHost(host)) { this.toggleEssentialFor(url); return; }
    const color = await this.brandColor(tab.getAttribute("image"));
    const icon = await this.iconDataUrl(tab.getAttribute("image"));
    if (this.isEssentialHost(host) || !tab.parentNode) return;
    this.toggleEssentialFor(url, color, icon);
  },

  tabMenu(tab, row, x, y) {
    const url = tab.linkedBrowser?.currentURI?.spec || "";
    const ess = this.isEssentialHost(this.hostOf(url));
    const inFolder = !!this.tabFolder(tab) && this.folders().some(f => f.id === this.tabFolder(tab));
    const items = [];
    // The basics Firefox's tab menu had (Folio's menu replaced it).
    items.push(["Reload", () => gBrowser.reloadTab(tab)]);
    items.push(["Duplicate", () => { gBrowser.selectedTab = gBrowser.duplicateTab(tab); }]);
    if (/^https?:/.test(url)) items.push(["Copy link", () => {
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(url);
      window.FolioToast?.show("Copied link!");
    }]);
    if (tab.soundPlaying || tab.muted) items.push([tab.muted ? "Unmute tab" : "Mute tab", () => tab.toggleMuteAudio()]);
    items.push("-");
    items.push([tab.pinned ? "Unpin tab" : "Pin tab", () => { tab.pinned ? gBrowser.unpinTab(tab) : gBrowser.pinTab(tab); this.renderTabs(); }]);
    items.push([ess ? "Remove from Essentials" : "Pin to Essentials", () => this.toggleEssentialFromTab(tab)]);
    if (inFolder) items.push(["Take out of folder", () => { this.moveToFolder(tab, ""); this.renderTabs(); }]);
    else items.push(["Move to new folder", () => { this.newFolderFrom(tab, tab); this.renderTabs(); }]);
    // Space routing (folio-routing.js): this site always opens in a chosen space.
    if (window.FolioRouting && /^https?:/.test(url)) {
      const r = window.FolioRouting.routeFor(url);
      items.push([r ? "Edit route..." : "Add route...", () => window.FolioRouting.editor(tab, r)]);
      if (r) items.push(["Remove route", () => window.FolioRouting.setRoutes(window.FolioRouting.routes().filter(x => x !== r && !(x.value === r.value && x.match === r.match && x.space === r.space)))]);
      items.push(["Zen this page", () => { gBrowser.selectedTab = tab; window.FolioZen?.start(tab.linkedBrowser); }]);
    }
    if (tab.splitview) {
      const L = { columns: "Side by side", rows: "Stacked", grid: "Grid" };
      const cur = Services.prefs.getStringPref("folio.split.layout", "columns");
      const next = { columns: "rows", rows: "grid", grid: "columns" }[cur] || "rows";
      items.push([`Split layout: ${L[next]}`, () => Services.prefs.setStringPref("folio.split.layout", next)]);
      items.push(["Close split view", () => this.toggleSplit(tab)]);
    }
    else if (tab !== gBrowser.selectedTab && gBrowser.addTabSplitView) items.push(["Split with this tab", () => this.toggleSplit(tab)]);
    if (/^https?:/.test(url)) {
      items.push(["Share...", () => window.FolioShare?.open(tab)]);
      items.push(["Copy link as Markdown", () => { gBrowser.selectedTab = tab; window.FolioActions?.copyURL(true); }]);
    }
    items.push("-");
    if (window.FolioTabs) items.push([window.FolioTabs.keepsAwake(tab) ? "Let this tab sleep" : "Keep this tab awake", () => window.FolioTabs.setKeepAwake(tab, !window.FolioTabs.keepsAwake(tab))]);
    if (window.FolioTabs && !window.FolioTabs.isHibernated(tab) && !tab.selected) items.push(["Hibernate tab", () => { window.FolioTabs.hibernate(tab, true); this.renderTabs(); }]);
    if (window.FolioTabs && gBrowser.tabs.length > 1) items.push(["Hibernate other tabs", () => { window.FolioTabs.hibernateOthers(tab); this.renderTabs(); }]);
    items.push("-");
    // Close other tabs: the other unpinned tabs of this space (shared tabs and Essentials stay), with Undo.
    const others = this.realTabs().filter(t => t !== tab && !t.pinned && !t.closing && this.tabSpace(t) === this.tabSpace(tab));
    if (others.length) items.push(["Close other tabs", () => {
      gBrowser.removeTabs(others, { animate: true });
      const n = others.length;
      window.FolioToast?.show(n === 1 ? "Tab closed!" : `${n} tabs closed!`, {
        timeout: 5000,
        action: { label: "Undo", run: () => { for (let i = 0; i < n; i++) { try { SessionStore.undoCloseTab(window, 0); } catch (e) { break; } } } },
      });
    }]);
    items.push(["Close tab", () => this.closeTabSafely(tab)]);
    this.showMenu(x, y, items);
  },

  startRename() {
    const s = this.spaces().find(x => x.id === this.currentSpaceId());
    if (s) this.renameSpacePrompt(s);
  },

  // Deletes a space and the tabs in it. Its folders go too; Essentials stay.
  deleteSpace(id) {
    const list = this.spaces();
    if (list.length <= 1) return;
    const others = list.filter(s => s.id !== id);
    const gone = list.find(s => s.id === id);
    if (this.currentSpaceId() === id) this.switchSpace(others[0].id);
    for (const t of gBrowser.tabs.filter(t => !t.folioPlaceholder && !t.closing && this.tabSpace(t) === id)) gBrowser.removeTab(t);
    this.setSpaces(others);
    this.gcWallpapers([gone?.wallpaper]);
    window.FolioContainers?.release(id);
    this.setFolders(this.folders().filter(f => f.spaceId !== id));
    this._spaceSig = null;
    this.renderSpaces();
    this.renderTabs();
  },

  // Drag a row: drop on a folder to join it, on another loose row to make a new folder with both,
  // on a row that's in a folder to join that folder, on the empty list to take it out of its folder.
  attachDrag(row, tab) {
    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".folio-side-tab-close")) return;
      const start = { x: e.clientX, y: e.clientY };
      const move = (ev) => {
        if (!this._drag) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
          this._drag = { tab, row, over: null };
          row.classList.add("folio-dragging");
          row.style.pointerEvents = "none";
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const head = el?.closest?.("[folio-folder-id]");
        const other = el?.closest?.(".folio-side-tab");
        let over = null;
        if (head) over = { kind: "folder", id: head.getAttribute("folio-folder-id"), node: head };
        else if (other && other !== row) {
          // Near a row's top or bottom edge = put the tab there (reorder); its middle = make a folder with it.
          const r = other.getBoundingClientRect();
          const f = (ev.clientY - r.top) / Math.max(1, r.height);
          over = { kind: f < 0.3 ? "before" : f > 0.7 ? "after" : "row", tab: this._rowTabs.get(other), node: other };
        }
        else if (el?.closest?.("#folio-sidebar-tabs")) over = { kind: "list", node: null };
        const cls = (o) => o?.kind === "before" ? "folio-drop-before" : o?.kind === "after" ? "folio-drop-after" : "folio-drop";
        const prev = this._drag.over;
        if (prev?.node !== (over?.node ?? null) || cls(prev) !== cls(over)) {
          prev?.node?.classList.remove("folio-drop", "folio-drop-before", "folio-drop-after");
          over?.node?.classList.add(cls(over));
        }
        this._drag.over = over;
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        const d = this._drag;
        this._drag = null;
        if (!d) return;
        // Alt held when dropping: a COPY of the tab goes there, the original stays (Zen's Alt+drag).
        if (ev?.altKey) {
          try {
            const copy = gBrowser.duplicateTab(d.tab, false);
            this.setTabSpace?.(copy, this.tabSpace(d.tab));
            d.tab = copy;
            window.FolioToast?.show("Tab duplicated");
          } catch (e) { console.warn("Folio duplicate:", e); }
        }
        d.row.classList.remove("folio-dragging");
        d.row.style.pointerEvents = "";
        d.over?.node?.classList.remove("folio-drop", "folio-drop-before", "folio-drop-after");
        this._justDragged = true;
        setTimeout(() => { this._justDragged = false; }, 200);
        const o = d.over;
        if ((o?.kind === "before" || o?.kind === "after") && o.tab && o.tab !== d.tab) {
          if (o.kind === "before") gBrowser.moveTabBefore(d.tab, o.tab);
          else gBrowser.moveTabAfter(d.tab, o.tab);
          // It joins the folder of the row it was dropped next to (or leaves its folder beside a loose row).
          const fid = this.tabFolder(o.tab);
          const inFolder = fid && this.folders().some(f => f.id === fid);
          if ((this.tabFolder(d.tab) || "") !== (inFolder ? fid : "")) this.moveToFolder(d.tab, inFolder ? fid : "");
        } else if (o?.kind === "folder") this.moveToFolder(d.tab, o.id);
        else if (o?.kind === "row" && o.tab) {
          const fid = this.tabFolder(o.tab);
          if (fid && this.folders().some(f => f.id === fid)) this.moveToFolder(d.tab, fid);
          else this.newFolderFrom(o.tab, d.tab);
        } else if (o?.kind === "list") this.moveToFolder(d.tab, "");
        this.renderTabs();
        if (this._pendingRender) { this._pendingRender = false; this.renderTabs(); }
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    });
  },

  rowFor(tab) {
    let row = this._rows.get(tab);
    if (!row) { row = this.makeRow(tab); this._rows.set(tab, row); }
    return row;
  },

  renderTabs() {
    const list = document.getElementById("folio-sidebar-tabs");
    if (!list || typeof gBrowser == "undefined") return;
    if (this._drag) { this._pendingRender = true; return; }
    this._rows = this._rows || new Map();
    this._folderEls = this._folderEls || new Map();
    this.applySpaces();
    this.renderSpaces();
    this.pruneFolders();
    // Heights before this render changes anything: a folder that closes starts from its real height,
    // not from the already-shrinking row.
    this._foldH = new Map([...(this._folderEls || new Map()).entries()].map(([id, fe]) => [id, fe.el.getBoundingClientRect().height]));

    // Essentials grid: rebuilt only when the saved list changes.
    const entries = this.essEntries();
    const key = JSON.stringify(entries);
    if (this._essKey !== key) {
      this._essKey = key;
      list.querySelector(".folio-ess-grid")?.remove();
      if (entries.length) {
        const grid = document.createElementNS(this.HTML_NS, "div");
        grid.className = "folio-ess-grid" + (entries.length > 6 ? " folio-ess-compact" : "");
        for (const entry of entries) {
          const tab = gBrowser.tabs.find(t => this.tabHost(t) === this.hostOf(entry.url));
          grid.append(this.essentialTile(entry, tab));
        }
        list.prepend(grid);
      }
    }
    // The space's name sits right under the Essentials (Zen's layout).
    const spaceName = document.getElementById("folio-space-name");
    if (spaceName) {
      const grid = list.querySelector(":scope > .folio-ess-grid");
      if (grid ? grid.nextElementSibling !== spaceName : list.firstElementChild !== spaceName) { if (grid) grid.after(spaceName); else list.prepend(spaceName); }
    }
    this.updateEssBadges(list, entries);

    // Rows of tabs that closed animate out, in place.
    for (const [tab, row] of [...this._rows]) {
      if (!gBrowser.tabs.includes(tab) || tab.closing) {
        this._rows.delete(tab);
        if (!row.classList.contains("folio-closing")) {
          row.classList.add("folio-closing");
          setTimeout(() => row.remove(), 220);
        }
      }
    }

    // The layout (rows, folders, order) changes only when its structure changes. Titles and icons
    // update in place, so rows never move under the pointer for a title change.
    const cur = this.currentSpaceId();
    const tabs = this.liveTabs(cur);
    const folders = this.folders().filter(f => f.spaceId === cur);
    const items = [];
    const seen = new Set();
    for (const tab of tabs) {
      const fid = this.tabFolder(tab);
      const f = folders.find(x => x.id === fid);
      if (f) { if (!seen.has(f.id)) { seen.add(f.id); items.push({ type: "folder", folder: f }); } }
      else if (tab.splitview && tab.splitview.tabs?.length > 1) {
        // Split view, Zen-style (2026-11-26): the split's tabs share ONE row, a segment each.
        const sv = tab.splitview;
        if (!seen.has(sv)) { seen.add(sv); items.push({ type: "split", sv, tabs: [...sv.tabs].filter(t => tabs.includes(t)) }); }
      }
      else items.push({ type: "row", tab });
    }
    for (const f of folders) if (!seen.has(f.id)) items.push({ type: "folder", folder: f });
    const sig = cur + "|" + items.map(i => i.type === "row"
      ? "r" + this.tabKey(i.tab)
      : i.type === "split" ? "s" + i.tabs.map(t => this.tabKey(t)).join(",")
      : "f" + i.folder.id + i.folder.name + tabs.filter(t => this.tabFolder(t) === i.folder.id).map(t => this.tabKey(t)).join(",")
    ).join("|");
    // Folders that are gone animate out first (they stay in place until then).
    const liveIds = new Set(items.filter(i => i.type === "folder").map(i => i.folder.id));
    for (const id of [...this._folderEls.keys()]) if (!liveIds.has(id)) this.closeFolderEl(id);
    // While a closing row or folder is still animating, keep the layout as it is: rebuilding a folder
    // would pull the row out of it mid-animation. The re-render after the close applies the new layout.
    if (sig !== this._layoutSig && !list.querySelector(".folio-closing")) {
      this._layoutSig = sig;
      for (const row of this._rows.values()) if (!row.classList.contains("folio-closing")) row.remove();
      for (const fe of this._folderEls.values()) fe.el.remove();
      for (const b of list.querySelectorAll(":scope > .folio-split-row")) b.remove();
      for (const item of items) {
        if (item.type === "row") {
          list.append(this.rowFor(item.tab));
        } else if (item.type === "split") {
          this._splitRows ??= new WeakMap();
          let box = this._splitRows.get(item.sv);
          const before = box ? box.children.length : 0;
          if (!box) { box = document.createXULElement("hbox"); box.className = "folio-split-row"; this._splitRows.set(item.sv, box); }
          box.replaceChildren(...item.tabs.map(t => this.rowFor(t)));
          // a tab that just joined grows into the row
          if (before && item.tabs.length > before && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
            box.lastElementChild?.animate([{ flexGrow: 0, opacity: 0 }, { flexGrow: 1, opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)" });
          }
          list.append(box);
        } else {
          const fe = this.folderEl(item.folder);
          const members = tabs.filter(t => this.tabFolder(t) === item.folder.id);
          fe.count.setAttribute("value", String(members.length));
          fe.inner.replaceChildren(...members.map(t => this.rowFor(t)));
          list.append(fe.el);
        }
      }
    }
    // Open/closed state is synced on every render (it animates; it doesn't rebuild the folder).
    for (const item of items) if (item.type === "folder") this.folderEl(item.folder);
    for (const tab of tabs) this.updateRow(this.rowFor(tab), tab);
  },
  // Engines Folio adds by policy (policies.json) get no icon from Firefox: Brave, the No AI variants, Mojeek, Kagi, and
  // Startpage/Ecosia/Qwant where Firefox doesn't ship them for the region. Each gets the icon the welcome tour ships.
  ENGINE_ICONS: {
    "Brave Search": "chrome://browser/content/folio-welcome/brave.png",
    "DuckDuckGo No AI": "chrome://browser/content/folio-welcome/engines/duckduckgo.svg",
    "Google No AI": "chrome://browser/content/folio-welcome/engines/google.png",
    "Mojeek": "chrome://browser/content/folio-welcome/engines/mojeek.png",
    "Kagi": "chrome://browser/content/folio-welcome/engines/kagi.png",
    "Startpage": "chrome://browser/content/folio-welcome/engines/startpage.svg",
    "Ecosia": "chrome://browser/content/folio-welcome/engines/ecosia.svg",
    "Qwant": "chrome://browser/content/folio-welcome/engines/qwant.svg",
  },
  async ensureBraveIcon() {
    // The engine store caches each engine's icon (including "no icon") until the engine changes, and the
    // idle switcher reads it once at startup. So after the icons are in place, drop the cache and refresh the
    // switcher, on every start (a profile that already has the icon also needs the refresh).
    const names = Object.keys(this.ENGINE_ICONS);
    const refresh = () => {
      try {
        for (const n of names) gURLBar?.controller?.engineStore?.getEngineByName?.(n)?.invalidateIcon?.();
        gURLBar?.searchModeSwitcher?.updateSearchIcon();
      } catch (e) {}
    };
    try {
      const S = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService;
      for (const engine of await S.getVisibleEngines()) {
        const src = this.ENGINE_ICONS[engine.name];
        // Only our policy engines: a built-in Startpage/Ecosia/Qwant keeps Firefox's own icon.
        if (!src || !String(engine._loadPath || "").startsWith("[policy]")) continue;
        try {
          // Google No AI wears the exact icon of Firefox's own Google engine, so the two match in the address bar
          // (Sammy, 2026-11-26). Done once per profile (folio.engines.googleMatch).
          if (engine.name === "Google No AI" && !Services.prefs.getBoolPref("folio.engines.googleMatch", false)) {
            const g = await S.getEngineByName("Google");
            const gu = g && await g.getIconURL(32);
            if (gu) {
              const gb = await (await fetch(gu)).blob();
              if (/^image\//.test(gb.type)) {
                const gd = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(gb); });
                await engine._setIcon(gd, { override: true });
                Services.prefs.setBoolPref("folio.engines.googleMatch", true);
                continue;
              }
            }
          }
          // Keep a local icon (data: or chrome:). A remote icon can fail offline and leave a blank.
          const cur = await engine.getIconURL(16);
          if (cur && /^(data|chrome):/.test(cur)) continue;
          // The search service refuses chrome: icon URLs ("URL scheme chrome is not allowed"), so hand it the
          // shipped file as a data: URL.
          const blob = await (await fetch(src)).blob();
          const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(blob);
          });
          await engine._setIcon(dataUrl);
        } catch (e) { console.warn("Folio: icon not set for " + engine.name + ":", e); }
      }
    } catch (e) { console.warn("Folio: engine icons not set:", e); }
    refresh();
    setTimeout(refresh, 1500);
  },


  // This script loads before browser.js creates gBrowser, so wait for it.
  init() {
    if (typeof gBrowser == "undefined" || !gBrowser?.tabContainer) {
      setTimeout(() => this.init(), 100);
      return;
    }
    const set = document.getElementById("mainCommandSet") || document.documentElement;
    if (!document.getElementById("Folio:ToggleSidebar")) {
      const cmd = document.createXULElement("command");
      cmd.id = "Folio:ToggleSidebar";
      cmd.addEventListener("command", () => FolioSidebar.toggle());
      set.append(cmd);
    }
    // Space shortcuts (Zen's): next / previous (wrapping), go to space N, create a space.
    const mkCmd = (id, fn) => {
      if (document.getElementById(id)) return;
      const c = document.createXULElement("command");
      c.id = id;
      c.addEventListener("command", fn);
      set.append(c);
    };
    mkCmd("Folio:SpaceNext", () => FolioSidebar.switchSpaceBy(1));
    mkCmd("Folio:SpacePrev", () => FolioSidebar.switchSpaceBy(-1));
    for (let n = 1; n <= 10; n++) mkCmd("Folio:Space" + n, () => FolioSidebar.switchSpaceNumber(n));
    mkCmd("Folio:NewSpace", () => FolioSidebar.openSpaceCreation());
    // Publish the current colors (wallpaper palette or space color) for the settings page; one debounced watcher.
    const publishUi = () => {
      const r = document.documentElement;
      const accent = r.style.getPropertyValue("--folio-accent").trim();
      const base = r.hasAttribute("folio-wallpaper") ? r.style.getPropertyValue("--folio-sidebar-bg").trim() : "";
      const json = JSON.stringify({ accent, base });
      if (Services.prefs.getStringPref("folio.ui.palette", "") !== json) Services.prefs.setStringPref("folio.ui.palette", json);
    };
    let uiTimer = null;
    new MutationObserver(() => { clearTimeout(uiTimer); uiTimer = setTimeout(publishUi, 120); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["style", "folio-wallpaper"] });
    publishUi();
    this.setupIcons();
    this.migrateSpaceThemes();
    this.apply();
    this.setupResizer();
    // The sidebar key is "reserved": the browser handles it first, so it never waits for a busy web page to answer
    // (that wait was the pause you felt) and no site can swallow it. Kept true even if the key is changed later.
    const keepReserved = () => {
      for (const k of document.querySelectorAll('key[command="Folio:ToggleSidebar"], key[id^="key_folio"]')) {
        if (k.getAttribute("reserved") !== "true") k.setAttribute("reserved", "true");
      }
    };
    this.keepKeysReserved = keepReserved;
    keepReserved();
    new MutationObserver(keepReserved).observe(document.getElementById("mainKeyset") || document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["command", "key", "modifiers", "keycode"],
    });
    // Bottom buttons. Inline oncommand attributes don't run in browser chrome (CSP blocks them),
    // so the handlers are attached here, by id.
    // Settings opens a small menu above the button: Folio's own settings, or Firefox's.
    document.getElementById("folio-side-settings")?.addEventListener("command", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.showMenu(r.left, r.top - 4, [
        // The two logos as plain white marks (Sammy, 2026-11-26), like the other menu icons.
        ["Folio settings", () => openTrustedLinkIn("about:folio", "tab"), { icon: "branding/content/folio-mark.svg" }],
        ["Firefox settings", () => openTrustedLinkIn("about:preferences", "tab"), { icon: "browser/content/folio-settings/logos/firefox.svg" }],
      ]);
    });
    // The ≡ button: Folio's own menu with icons (Zen's second bottom icon). Firefox's full menu stays one click away.
    const ffMenu = document.getElementById("PanelUI-menu-button");
    ffMenu?.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.altKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const r = ffMenu.getBoundingClientRect();
      this.openMainMenu(r.left, r.top - 4);
    }, true);
    // The floating sidebar (peek) gets its own ≡ at the end of its bottom row (2026-11-26): there the real one stays in
    // the top bar, so the row looked like it was missing a button.
    const bottomRow = document.getElementById("folio-sidebar-bottom");
    if (bottomRow && !document.getElementById("folio-side-menu")) {
      const proxy = document.createXULElement("toolbarbutton");
      proxy.id = "folio-side-menu";
      proxy.className = "folio-side-button";
      proxy.setAttribute("tooltiptext", "Menu");
      proxy.addEventListener("command", () => { const rr = proxy.getBoundingClientRect(); this.openMainMenu(rr.left, rr.top - 4); });
      bottomRow.append(proxy);
    }
    document.getElementById("folio-side-downloads")?.addEventListener("command", () => this.toggleView("downloads"));
    document.getElementById("folio-side-history")?.addEventListener("command", () => this.toggleView("history"));
    this._rowTabs = new WeakMap();
    this._rows = new Map();
    this._folderEls = new Map();
    // A new tab joins the current space; a selected tab remembers when it was last used.
    gBrowser.tabContainer.addEventListener("TabOpen", (e) => { if (!e.target.folioSpace) this.setTabSpace(e.target, this.currentSpaceId()); });
    gBrowser.tabContainer.addEventListener("TabSelect", (e) => { e.target.folioLast = Date.now(); });
    // Session restore (2026-11-26 bug: relaunching moved every tab into the current space): restored tabs are created
    // first (TabOpen above stamps the current space on them), and their saved values arrive just before SSTabRestoring.
    // Take the saved space and folder back then, so tabs come back where they were.
    gBrowser.tabContainer.addEventListener("SSTabRestoring", (e) => {
      const tab = e.target;
      let sp = "", fo = "";
      try { sp = SessionStore.getCustomTabValue(tab, "folioSpace"); } catch (err) {}
      try { fo = SessionStore.getCustomTabValue(tab, "folioFolder"); } catch (err) {}
      if (sp && (sp === this.SHARED || this.spaces().some(s => s.id === sp)) && sp !== tab.folioSpace) tab.folioSpace = sp;
      if (fo !== undefined) tab.folioFolder = fo || "";
      clearTimeout(this._restoreRender);
      this._restoreRender = setTimeout(() => this.renderTabs(), 50);
    });
    // Lazy restored tabs never fire SSTabRestoring until opened: redraw once the whole window is restored.
    window.addEventListener("SSWindowRestored", () => { clearTimeout(this._restoreRender); this._restoreRender = setTimeout(() => this.renderTabs(), 50); });
    // Tab list follows the browser's tabs.
    for (const ev of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabMove"]) {
      gBrowser.tabContainer.addEventListener(ev, () => { FolioSidebar.syncEmpty(); FolioSidebar.renderTabs(); });
    }
    // A closing tab is still listed for its close animation: redraw once it's gone.
    gBrowser.tabContainer.addEventListener("TabClose", () => setTimeout(() => FolioSidebar.renderTabs(), 300));
    // Typing a URL while no tabs are open loads it into the hidden placeholder. When it leaves
    // about:blank it turns into a normal tab: it gets a row and the empty state goes away.
    // The address bar's zoom badge ("100%", Reset zoom level) never shows on Folio's new tab: CSS hides it while
    // the root carries folio-on-newtab.
    const syncNewtab = () => {
      const spec = gBrowser.selectedBrowser?.currentURI?.spec || "";
      document.documentElement.toggleAttribute("folio-on-newtab", /^about:(folio-newtab|newtab|home)([?#]|$)/.test(spec));
    };
    gBrowser.tabContainer.addEventListener("TabSelect", syncNewtab);
    syncNewtab();
    gBrowser.addTabsProgressListener({
      onLocationChange: (browser, webProgress, request, location) => {
        if (!webProgress.isTopLevel) return;
        if (browser === gBrowser.selectedBrowser) syncNewtab();
        // Firefox's own new tab / home (restored tabs, old links) is replaced by ours. In a private window
        // Firefox's private start page too: Folio's new tab shows a "Private" badge there, so every tab of
        // the window looks the same.
        if (/^about:(newtab|home)([?#]|$)/.test(location.spec) ||
            (/^about:privatebrowsing([?#]|$)/.test(location.spec) && PrivateBrowsingUtils.isWindowPrivate(window))) {

          try {
            browser.loadURI(Services.io.newURI("about:folio-newtab"), {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
              loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_REPLACE_HISTORY,
            });
          } catch (e) { console.warn("Folio new tab redirect:", e); }
          return;
        }
        const tab = gBrowser.getTabForBrowser(browser);
        // Firefox's own blank pages don't count (the start tab finishes loading about:home after we
        // turn it into the placeholder at startup).
        if (tab?.folioPlaceholder && !/^about:(blank|home|newtab|folio-newtab)$/.test(location.spec)) {
          tab.folioPlaceholder = false;
          Services.prefs.setBoolPref("folio.emptyState", false);
          FolioSidebar.syncEmpty();
          FolioSidebar.renderTabs();
        }
      },
    });
    Services.prefs.addObserver("folio.essentials", () => FolioSidebar.renderTabs());
    // The settings page changes these: apply them at once.
    Services.prefs.addObserver("folio.sidebar.hidden", () => FolioSidebar.apply());
    // Wallpaper theme: apply at startup and whenever the wallpaper changes.
    Services.prefs.addObserver(FolioTheme.PREF, () => { FolioTheme.apply(); FolioSidebar.syncCurrentSpaceFromPrefs(); });
    Services.prefs.addObserver("folio.seethrough", () => { FolioTheme.apply(); FolioSidebar.syncCurrentSpaceFromPrefs(); });
    FolioTheme.apply();
    window.FolioZoom?.ensureDefault();
    ChromeUtils.importESModule("resource:///modules/FolioSkins.sys.mjs").FolioSkins.start();
    // Built-in ad blocker (native, in Firefox's network layer; off unless folio.blocker.enabled). Once per app.
    try { ChromeUtils.importESModule("resource:///modules/FolioBlocker.sys.mjs").FolioBlocker.init(); } catch (e) { console.warn("Folio blocker:", e); }
    Services.prefs.addObserver("folio.sidebar.width", () => FolioSidebar.apply());
    Services.prefs.addObserver("folio.sidebar.icons", () => { FolioSidebar.apply(); window.dispatchEvent(new Event("resize")); });
    Services.prefs.addObserver("folio.sidebar.right", () => requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))));
    // Search suggestions in the address bar start ON (the urlbar's own default is an opt-in). They go only to the
    // engine the user picked in the tour. Once: after that the user's choice in settings is respected.
    if (!Services.prefs.getBoolPref("folio.defaults.suggestionsOn", false)) {
      Services.prefs.setBoolPref("folio.defaults.suggestionsOn", true);
      Services.prefs.setBoolPref("browser.urlbar.suggest.searches", true);
    }
    // First keystroke in the address bar: warm the connection to the engine's suggestion server (see FolioBangs.prewarmSuggestions).
    // Not on focus: focusing is not typing, and nothing may reach the engine before the user types.
    gURLBar.inputField.addEventListener("input", () => ChromeUtils.importESModule("resource:///modules/FolioBangs.sys.mjs").prewarmSuggestions());
    this.buildEmptyState();
    this.applyAccent();
    // Double-click empty space in the sidebar: a new tab (rows and tiles keep their own clicks).
    // Fast clicks are counted by time, not by target: a run of clicks that starts on empty space opens
    // a tab on every second click, even when the new rows appear under the pointer. A run that starts
    // on a tab or tile doesn't open anything.
    const body = document.getElementById("folio-sidebar-body");
    const run = { n: 0, last: -1000, startsEmpty: false };
    body?.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const onItem = !!e.target.closest(".folio-side-tab, .folio-ess-tile, .folio-view-head, .folio-dl-detail, .folio-folder");
      if (e.timeStamp - run.last > 450) { run.n = 0; run.startsEmpty = !onItem; }
      run.last = e.timeStamp;
      run.n++;
      if (run.startsEmpty && run.n % 2 === 0) gBrowser.selectedTab = gBrowser.addTrustedTab(Services.prefs.getStringPref("browser.newtab.url", "about:folio-newtab"));
    }, true);
    // Quit while in the empty state: the window opens with only Firefox's blank start tab. Go back to empty.
    const start = this.realTabs();
    if (Services.prefs.getBoolPref("folio.emptyState", false) && start.length === 1 &&
        /^about:(home|newtab|blank)$/.test(start[0].linkedBrowser?.currentURI?.spec || "about:blank")) {
      start[0].folioPlaceholder = true;
      start[0].linkedBrowser.loadURI(Services.io.newURI("about:blank"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    }
    // The welcome tour's Brave Search choice: the policy's icon never reaches the search service, so the
    // address bar showed a generic magnifier. Give the engine the icon we ship, once it has none.
    this.ensureBraveIcon();
    // Firefox's own close paths (Ctrl+W, the File menu, tabs closed by removeTab) would close the window
    // when the last real tab goes. Route that case through the placeholder, so Folio stays open with its
    // Essentials and the empty state, whatever the close came from.
    const origClose = BrowserCommands.closeTabOrWindow;
    BrowserCommands.closeTabOrWindow = function (event) {
      if (FolioSidebar.realTabs().length <= 1) {
        const t = gBrowser.selectedTab;
        if (t && !t.folioPlaceholder) FolioSidebar.closeTabSafely(t);
        return;
      }
      return origClose.call(this, event);
    };
    const origRemove = gBrowser.removeTab;
    gBrowser.removeTab = function (tab, opts) {
      if (tab && !tab.folioPlaceholder && !tab.closing && FolioSidebar.realTabs().length <= 1) {
        return FolioSidebar.closeTabSafely(tab);
      }
      return origRemove.call(this, tab, opts);
    };
    this.syncEmpty();
    this.renderTabs();
  },
};


// ---- Our own History and Downloads, shown INSIDE the sidebar (they replace the tab list) ----
// Real data: the Places database (history) and the Downloads list (downloads).
// Colors come from the --folio-* tokens (browser-shared.css), so the theme editor can change them.
FolioSidebar.HTML_NS = "http://www.w3.org/1999/xhtml";
FolioSidebar.SVG_NS = "http://www.w3.org/2000/svg";
FolioSidebar.current = null;
FolioSidebar.timer = null;

FolioSidebar.el = function (tag, props = {}, ...kids) {
  const node = document.createElementNS(this.HTML_NS, tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

FolioSidebar.svgEl = function (tag, attrs = {}) {
  const node = document.createElementNS(this.SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

// History / Downloads replace the tab list in the sidebar. Opening slides the view in from the right; closing slides it
// back out and eases the tab list in from the left (Folio's space-switch motion). Switching History <-> Downloads
// swaps straight across with the same slide-in. Anything else that closes a view (Create a Space) stays instant.
FolioSidebar._viewMotion = function (node, frames, ms, easing) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  return node.animate(frames, { duration: ms, easing, fill: "backwards" });
};

FolioSidebar.toggleView = function (kind) {
  if (this.current === kind) { this.closeView(true); return; }
  this.closeView();
  this.current = kind;
  document.getElementById("folio-sidebar-tabs").hidden = true;
  const view = document.getElementById("folio-sidebar-view");
  view.hidden = false;
  view.replaceChildren(this.el("div", { class: "folio-view-empty" }, "Loading…"));
  this._viewMotion(view, [{ opacity: 0, transform: "translateX(28px)" }, { opacity: 1, transform: "none" }],
    260, "cubic-bezier(0.16, 1, 0.3, 1)");
  for (const b of document.querySelectorAll(".folio-side-button[data-view]")) {
    b.toggleAttribute("active", b.dataset.view === kind);
  }
  const build = kind === "history" ? this.buildHistory(view) : this.buildDownloads(view);
  build.catch(err => {
    console.error("Folio " + kind + ":", err);
    view.replaceChildren(this.el("div", { class: "folio-view-empty" }, "Could not load this list."));
  });
};

FolioSidebar.closeView = function (animate = false) {
  clearInterval(this.timer);
  this.timer = null;
  const view = document.getElementById("folio-sidebar-view");
  const tabs = document.getElementById("folio-sidebar-tabs");
  // A close already sliding out finishes at once (a new view, or a second close, must not wait for it).
  if (this._viewOut) { const a = this._viewOut; this._viewOut = null; a.cancel(); }
  const wasOpen = this.current && !view.hidden;
  this.current = null;
  for (const b of document.querySelectorAll(".folio-side-button[data-view]")) b.removeAttribute("active");
  const finish = () => {
    view.hidden = true;
    view.replaceChildren();
    tabs.hidden = false;
  };
  if (!animate || !wasOpen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
  const out = view.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(28px)" }],
    { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
  this._viewOut = out;
  out.onfinish = () => {
    if (this._viewOut !== out) return;
    this._viewOut = null;
    finish();
    out.cancel();
    this._viewMotion(tabs, [{ opacity: 0, transform: "translateX(-22px)" }, { opacity: 1, transform: "none" }],
      260, "cubic-bezier(0.16, 1, 0.3, 1)");
  };
  out.oncancel = () => { if (!this.current) finish(); };
};

// Header row shared by both views: title and a back/close button.
FolioSidebar.viewHeader = function (title) {
  return this.el("div", { class: "folio-view-head" },
    this.el("span", { class: "folio-view-title" }, title),
    this.el("button", { class: "folio-view-close", title: "Back to tabs", onclick: () => this.closeView(true) }, "×"));
};

FolioSidebar.formatRate = function (bps) {
  if (bps < 1024) return Math.round(bps) + " bytes/s";
  if (bps < 1048576) return (bps / 1024).toFixed(0) + " KB/s";
  return (bps / 1048576).toFixed(2) + " MB/s";
};

FolioSidebar.formatSize = function (n) {
  if (!n) return "0 bytes";
  if (n < 1024) return n + " bytes";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(2) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
};

FolioSidebar.dayTitle = function (ms) {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((today - day) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(d);
};

FolioSidebar.dayIndex = function (ms) {
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
  const diff = Math.floor((ms - start.getTime()) / 86400000);
  return diff >= 0 && diff < 7 ? diff : -1;
};

FolioSidebar.dayLabels = function () {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    out.push(fmt.format(d));
  }
  return out;
};

// Smooth line through points: each segment is a cubic curve, flat at each point.
FolioSidebar.smoothPath = function (pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
};

// ---- History ----
FolioSidebar.buildHistory = async function (view) {
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const db = await PlacesUtils.promiseDBConnection();
  const since = (Date.now() - 7 * 86400000) * 1000; // Places stores microseconds
  const rows = await db.executeCached(
    "SELECT p.url, p.title, v.visit_date FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id " +
    "WHERE v.visit_date >= :since ORDER BY v.visit_date DESC LIMIT 2000", { since });
  const visits = rows.map(r => ({
    url: r.getResultByName("url"),
    title: r.getResultByName("title") || r.getResultByName("url"),
    ms: r.getResultByName("visit_date") / 1000,
  }));
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const v of visits) { const i = this.dayIndex(v.ms); if (i >= 0) counts[i]++; }

  const list = this.el("div", { class: "folio-view-list" });
  const renderList = (filter) => {
    list.replaceChildren();
    const f = filter.trim().toLowerCase();
    let lastDay = null, shown = 0;
    for (const v of visits) {
      if (f && !(v.title.toLowerCase().includes(f) || v.url.toLowerCase().includes(f))) continue;
      if (shown++ >= 200) break;
      const day = this.dayTitle(v.ms);
      if (day !== lastDay) { list.append(this.el("div", { class: "folio-view-day" }, day)); lastDay = day; }
      let host = v.url; try { host = new URL(v.url).host; } catch (e) {}
      // The site's icon from the local favicon store (page-icon: never goes to the network).
      const icon = this.el("img", { class: "folio-view-row-icon", src: "page-icon:" + v.url, alt: "" });
      icon.addEventListener("error", () => { icon.src = "chrome://global/skin/icons/defaultFavicon.svg"; }, { once: true });
      list.append(this.el("button", { class: "folio-view-row folio-view-row-iconed", onclick: () => openTrustedLinkIn(v.url, "tab") },
        icon,
        this.el("span", { class: "folio-view-row-title" }, v.title),
        this.el("span", { class: "folio-view-row-sub" }, host)));
    }
    if (!list.childElementCount) list.append(this.el("div", { class: "folio-view-empty" }, "Nothing here yet."));
  };
  const max = Math.max(1, ...counts);
  const bars = this.svgEl("svg", { viewBox: "0 0 300 80", class: "folio-bars" });
  counts.forEach((c, i) => {
    const slot = 300 / 7, w = slot * 0.6, x = i * slot + slot * 0.2;
    const h = Math.max(c ? 3 : 1, (58 * c) / max);
    bars.append(this.svgEl("rect", { x, y: 62 - h, width: w, height: h, rx: 3, class: c ? "folio-bar" : "folio-bar folio-bar-empty" }));
    const lab = this.svgEl("text", { x: x + w / 2, y: 76, "text-anchor": "middle", class: "folio-axis" });
    lab.textContent = this.dayLabels()[i];
    bars.append(lab);
  });

  const search = this.el("input", { class: "folio-view-search", type: "search", placeholder: "Search history", oninput: (e) => renderList(e.target.value) });
  view.replaceChildren(this.viewHeader("History"), bars, search, list);
  renderList("");
};

// ---- Downloads: list + details with a live speed graph for the selected download ----
FolioSidebar.buildDownloads = async function (view) {
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const dl = await Downloads.getList(Downloads.ALL);
  const samples = new Map(); // download object -> [{ t, bytes }]
  const speeds = new Map();  // download object -> [bytes per second]
  let selected = null;
  let query = "";

  const listBox = this.el("div", { class: "folio-view-list folio-dl-list" });
  const detail = this.el("div", { class: "folio-dl-detail" });
  const search = this.el("input", { class: "folio-view-search", type: "search", placeholder: "Search downloads", oninput: (e) => { query = e.target.value.toLowerCase(); } });
  view.replaceChildren(this.viewHeader("Downloads"), search, listBox, detail);

  const nameOf = (d) => d.target.path ? d.target.path.split(/[\\/]/).pop() : (d.source.url || "download");

  const renderDetail = (d) => {
    detail.replaceChildren();
    if (!d) { detail.append(this.el("div", { class: "folio-view-empty" }, "Select a download to see its details.")); return; }
    const sp = speeds.get(d) || [];
    const current = sp.length ? sp[sp.length - 1] : 0;
    const total = d.totalBytes || 0, got = d.currentBytes || 0;
    const state = d.succeeded ? "Completed" : d.canceled ? "Cancelled" : d.error ? "Failed" : d.stopped ? "Stopped" : "Downloading";
    const fmt = (dt) => dt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(dt) : "—";
    detail.append(
      this.el("div", { class: "folio-dl-name" }, nameOf(d)),
      this.el("div", { class: "folio-dl-url" }, d.source.url || ""),
      this.el("div", { class: "folio-dl-meta" },
        this.el("span", {}, "Path"), this.el("span", {}, d.target.path || "—"),
        this.el("span", {}, "Started"), this.el("span", {}, fmt(d.startTime)),
        this.el("span", {}, "State"), this.el("span", {}, state + (total ? " · " + Math.floor((100 * got) / total) + "%" : ""))),
      this.speedChart(sp),
      this.el("div", { class: "folio-dl-speed" },
        this.el("span", { class: "folio-dl-speed-now" }, this.formatRate(current)),
        this.el("span", { class: "folio-dl-size" }, this.formatSize(got) + (total ? " of " + this.formatSize(total) : ""))),
      this.el("div", { class: "folio-dl-actions" },
        this.el("button", { class: "folio-dl-btn", onclick: () => d.showContainingDirectory?.() }, "Show in folder")));
  };

  const renderList = (all) => {
    listBox.replaceChildren();
    const shown = all.filter(d => !query || nameOf(d).toLowerCase().includes(query));
    for (const d of shown.slice(0, 200)) {
      const total = d.totalBytes || 0, got = d.currentBytes || 0;
      const pct = d.succeeded ? 100 : total ? Math.min(100, (100 * got) / total) : 0;
      const status = d.succeeded ? this.formatSize(total)
        : d.canceled ? "cancelled" : d.error ? "failed"
        : d.stopped ? this.formatSize(got) + " of " + this.formatSize(total) + " - stopped"
        : this.formatSize(got) + (total ? " of " + this.formatSize(total) : "") + " - " + this.formatRate(speeds.get(d)?.at(-1) || 0);
      const row = this.el("button", {
        class: "folio-dl-row" + (d === selected ? " selected" : ""),
        onclick: () => { selected = d; renderDetail(d); renderList(all); },
      },
        this.el("span", { class: "folio-view-row-title" }, nameOf(d)),
        this.el("span", { class: "folio-dl-bar" }, this.el("span", { class: "folio-dl-bar-fill", style: `width:${pct}%` })),
        this.el("span", { class: "folio-view-row-sub" }, status));
      listBox.append(row);
    }
    if (!listBox.childElementCount) listBox.append(this.el("div", { class: "folio-view-empty" }, "No downloads yet."));
  };

  const tick = async () => {
    if (this.current !== "downloads") return;
    const all = (await dl.getAll()).filter(d => d.startTime).sort((x, y) => y.startTime - x.startTime);
    const now = Date.now();
    for (const d of all) {
      const s = samples.get(d) || [];
      s.push({ t: now, bytes: d.currentBytes || 0 });
      if (s.length > 60) s.shift();
      samples.set(d, s);
      const sp = speeds.get(d) || [];
      if (s.length >= 2) {
        const a = s[s.length - 2], b = s[s.length - 1];
        const dt = (b.t - a.t) / 1000;
        sp.push(dt > 0 ? Math.max(0, (b.bytes - a.bytes) / dt) : 0);
        if (sp.length > 60) sp.shift();
      }
      speeds.set(d, sp);
    }
    if (!selected && all.length) selected = all[0];
    renderList(all);
    // The graph and speed of the selected download update on every tick.
    if (selected) {
      const sel = selected;
      if (sel === selected) { const scroll = detail.scrollTop; renderDetail(sel); detail.scrollTop = scroll; }
    } else renderDetail(null);
  };

  await tick();
  this.timer = setInterval(() => { tick().catch(err => console.error("Folio downloads:", err)); }, 500);
};

// Vivaldi-style speed graph: grid, smooth line, filled area, in the accent colors.
FolioSidebar.speedChart = function (sp) {
  const W = 300, H = 110, top = 8, base = 100;
  const svg = this.svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "folio-speed", role: "img" });
  for (let i = 1; i < 4; i++) {
    const y = top + ((base - top) * i) / 4;
    svg.append(this.svgEl("line", { x1: 0, x2: W, y1: y, y2: y, class: "folio-speed-grid" }));
  }
  for (let i = 1; i < 6; i++) {
    const x = (W * i) / 6;
    svg.append(this.svgEl("line", { x1: x, x2: x, y1: top, y2: base, class: "folio-speed-grid" }));
  }
  const max = Math.max(1024, ...sp);
  const step = W / 59;
  const off = 60 - sp.length;
  const pts = sp.map((v, i) => [(off + i) * step, base - ((base - top) * v) / max]);
  if (pts.length >= 2) {
    const line = this.smoothPath(pts);
    svg.append(this.svgEl("path", { d: `${line} L${pts.at(-1)[0]},${base} L${pts[0][0]},${base} Z`, class: "folio-speed-area" }));
    svg.append(this.svgEl("path", { d: line, class: "folio-speed-line" }));
  }
  return svg;
};


FolioSidebar.init();
