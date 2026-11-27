/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio "Zen" (2026-11-25): hide any part of a page (FolioZenChild/Parent), started from the page's right-click menu
 * ("Zen this page") or the tab menu. Also: Shift + swipe left/right switches to the space on that side (pages report the
 * swipe through the same actor; over the sidebar it's caught here). */

var FolioZen = {
  init() {
    try {
      ChromeUtils.registerWindowActor("FolioZen", {
        parent: { esModuleURI: "resource:///modules/FolioZenParent.sys.mjs" },
        child: { esModuleURI: "resource:///modules/FolioZenChild.sys.mjs", events: { DOMDocElementInserted: { capture: true } } },
        allFrames: false,
        matches: ["http://*/*", "https://*/*"],
        // Runs inside website processes. FolioZenParent treats everything the page sends as untrusted (caps and
        // validates host/selector, writes only Folio's own pref).
        safeForUntrustedWebProcess: true,
      });
    } catch (e) { /* another window registered it already */ }

    const menu = document.getElementById("contentAreaContextMenu");
    menu?.addEventListener("popupshowing", (e) => {
      if (e.target !== menu) return;
      let item = document.getElementById("folio-zen-menuitem");
      if (!item) {
        item = document.createXULElement("menuitem");
        item.id = "folio-zen-menuitem";
        item.setAttribute("label", "Zen this page");
        item.addEventListener("command", () => this.start());
        const sep = document.createXULElement("menuseparator");
        sep.id = "folio-zen-sep";
        menu.append(sep, item);
      }
      const ok = /^https?:/.test(gBrowser.selectedBrowser.currentURI?.spec || "");
      item.hidden = !ok;
      document.getElementById("folio-zen-sep").hidden = !ok;
    });

    this.addButton();
    /* copy-link button removed (Sammy, 2026-11-26): only the Zen lotus stays in the address bar */
    this.syncFindColors();
    this.domainOnly();
    /* keyViz replaced by FolioKeyPop in folio-keys.js (2026-11-26) */
    // Ctrl+Alt+Z: Zen this page (its button is the only one left in the address bar).
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key?.toLowerCase() === "z") { e.preventDefault(); this.start(); }
    }, true);
    // Zen's top row needs the sidebar button; put it back once if a saved toolbar layout dropped it.
    try {
      const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
      if (!CustomizableUI.getPlacementOfWidget("sidebar-button") && !Services.prefs.getBoolPref("folio.sidebarButtonRestored", false)) {
        CustomizableUI.addWidgetToArea("sidebar-button", CustomizableUI.AREA_NAVBAR, 0);
        Services.prefs.setBoolPref("folio.sidebarButtonRestored", true);
      }
    } catch (e) { console.warn("Folio: sidebar button", e); }
    window.FolioSidebar?.watchSplitLayout?.();
    this.watchErrorPages();
    this.watchSwipeGestures();

    // Over the browser's own UI (sidebar, toolbar): same Shift + scroll. Plain scroll over the tab list switches tabs
    // when "Scroll to switch tabs" is on (folio.sidebar.wheelTabs).
    let tabAcc = 0, tabCool = 0;
    window.addEventListener("wheel", (e) => {
      // Scrolling over a page arrives here too (target = the page's <browser>), so pages and sidebar share this.
      if (e.target.closest?.("#folio-glance")) return;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 30 : 1);
      if (e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); this.wheel(d); return; }
      if (e.ctrlKey || e.altKey || e.shiftKey || !Services.prefs.getBoolPref("folio.sidebar.wheelTabs", false)) return;
      if (!e.target.closest?.("#folio-sidebar-tabs")) return;
      e.preventDefault();
      const now = Date.now();
      if (now < tabCool) return;
      tabAcc += d;
      if (Math.abs(tabAcc) < 60) return;
      const rows = [...document.querySelectorAll("#folio-sidebar-tabs .folio-side-tab")].filter(r => r.checkVisibility?.() ?? true);
      const tabs = rows.map(r => window.FolioSidebar?.realTabs().find(t => window.FolioSidebar._rows?.get(t) === r)).filter(Boolean);
      const i = tabs.indexOf(gBrowser.selectedTab);
      const next = tabs[i + (tabAcc > 0 ? 1 : -1)];
      tabAcc = 0; tabCool = now + 120;
      if (next) gBrowser.selectedTab = next;
    }, { passive: false, capture: true });
  },

  // A Zen button in the address bar, next to the star: one click starts Zen; an accent dot means this site has hidden
  // elements. (Right-click "Zen this page" still works.)
  addButton() {
    const actions = document.getElementById("page-action-buttons");
    if (!actions || document.getElementById("folio-zen-button")) return;
    const b = document.createXULElement("hbox");
    b.id = "folio-zen-button";
    b.className = "urlbar-page-action";
    b.setAttribute("role", "button");
    b.setAttribute("tooltiptext", "Zen: hide parts of this page (Ctrl+Alt+Z)");
    b.setAttribute("aria-label", "Zen: hide parts of this page");
    const icon = document.createXULElement("image");
    icon.className = "urlbar-icon";
    b.append(icon);
    b.addEventListener("click", (e) => { if (e.button === 0) this.start(); });
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.start(); } });
    b.tabIndex = 0;
    const star = document.getElementById("star-button-box");
    if (star?.parentNode === actions) actions.insertBefore(b, star); else actions.append(b);
    const update = () => {
      const uri = gBrowser.selectedBrowser.currentURI;
      const web = /^https?$/.test(uri?.scheme || "");
      b.hidden = !web;
      let n = 0;
      if (web) {
        try { n = (JSON.parse(Services.prefs.getStringPref("folio.zen.sites", "{}"))[uri.hostPort.toLowerCase()] || []).length; } catch (e) {}
      }
      b.toggleAttribute("zenned", n > 0);
    };
    gBrowser.addProgressListener({
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(wp) { if (wp?.isTopLevel) update(); },
    });
    gBrowser.tabContainer.addEventListener("TabSelect", update);
    Services.prefs.addObserver("folio.zen.sites", update);
    window.addEventListener("unload", () => Services.prefs.removeObserver("folio.zen.sites", update), { once: true });
    update();
  },

  // Zen's address bar: just the site's name ("youtube.com") while you're not using it; click in and the full address
  // is there to edit. Drawn as a label over the field (the field keeps the real URL, so copy/edit/Firefox's own logic
  // are untouched).
  domainOnly() {
    const urlbar = document.getElementById("urlbar");
    const input = gURLBar.inputField;
    if (!urlbar || !input || document.getElementById("folio-url-domain")) return;
    const label = document.createXULElement("label");
    label.id = "folio-url-domain";
    label.setAttribute("crop", "end");
    input.after(label);
    const update = () => {
      let host = "";
      try {
        const uri = gBrowser.selectedBrowser.currentURI;
        if (/^https?$/.test(uri.scheme) && !gURLBar.focused && !gURLBar.valueIsTyped && !urlbar.hasAttribute("searchmode")) {
          host = uri.host.replace(/^www\./, "");
        }
      } catch (e) {}
      if (host) { label.setAttribute("value", host); urlbar.setAttribute("folio-domain", ""); }
      else urlbar.removeAttribute("folio-domain");
    };
    for (const ev of ["focus", "blur", "input"]) input.addEventListener(ev, () => setTimeout(update, 0));
    gBrowser.tabContainer.addEventListener("TabSelect", update);
    gBrowser.addProgressListener({
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(wp) { if (wp?.isTopLevel) setTimeout(update, 0); },
    });
    new MutationObserver(update).observe(urlbar, { attributes: true, attributeFilter: ["searchmode", "focused"] });
    update();
  },

  // Show keys as you press them (folio.keyviz, Settings > Keyboard Shortcuts): a pill at the bottom of the window with
  // the keys and, when they're a shortcut, what it does. Super is "Super" on Linux, the Windows key on Windows, ⌘ on Mac.
  keyViz() {
    const PREF = "folio.keyviz";
    const plat = AppConstants.platform;
    const superName = plat === "macosx" ? "⌘" : plat === "win" ? "⊞ Win" : "Super";
    const nice = { " ": "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", PageUp: "PgUp", PageDown: "PgDn" };
    let pill = null, timer = 0;
    const actionFor = (e) => {
      for (const k of document.querySelectorAll("keyset key")) {
        if (k.hasAttribute("disabled")) continue;
        const key = (k.getAttribute("key") || "").toLowerCase();
        const code = k.getAttribute("keycode") || "";
        const match = key ? key === e.key.toLowerCase() : code && code === "VK_" + e.key.toUpperCase().replace(/^ARROW/, "");
        if (!match) continue;
        const mods = (k.getAttribute("modifiers") || "").split(/[,\s]+/).filter(Boolean);
        const want = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
        const has = { ctrl: false, alt: false, shift: false, meta: false };
        for (const m of mods) { if (m === "accel") has[plat === "macosx" ? "meta" : "ctrl"] = true; else if (m === "control") has.ctrl = true; else if (m in has) has[m] = true; }
        if (Object.keys(has).every(x => has[x] === want[x])) {
          const id = k.id;
          const row = window.FolioKeys?.list?.().find(r => r.id === id);
          return row?.name || k.getAttribute("label") || "";
        }
      }
      return "";
    };
    window.addEventListener("keydown", (e) => {
      if (!Services.prefs.getBoolPref(PREF, false)) return;
      const isMod = ["Control", "Alt", "Shift", "Meta", "OS", "Super"].includes(e.key);
      const anyMod = e.ctrlKey || e.altKey || e.metaKey || (e.getModifierState?.("OS"));
      if (!anyMod && !isMod && e.key.length === 1) return; // plain typing never shows
      const parts = [];
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.metaKey || e.getModifierState?.("OS") || e.key === "Meta" || e.key === "OS") parts.push(superName);
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      if (!isMod) parts.push(nice[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key));
      const what = isMod ? "" : actionFor(e);
      if (!pill) {
        pill = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        pill.id = "folio-keyviz";
        document.documentElement.append(pill);
      }
      pill.replaceChildren(...[...new Set(parts)].map(t => Object.assign(document.createElementNS("http://www.w3.org/1999/xhtml", "kbd"), { textContent: t })));
      if (what) pill.append(Object.assign(document.createElementNS("http://www.w3.org/1999/xhtml", "span"), { textContent: what }));
      pill.removeAttribute("leaving");
      pill.animate([{ transform: "translateX(-50%) scale(.94)" }, { transform: "translateX(-50%) scale(1)" }], { duration: 140, easing: "cubic-bezier(.2,0,0,1)" });
      clearTimeout(timer);
      timer = setTimeout(() => pill?.setAttribute("leaving", ""), 1400);
    }, true);
  },

  // Find in page follows the accent (2026-11-26): the current match and "highlight all" use Folio's accent instead of
  // the system's selection color. Firefox reads these colors from prefs, so we keep them in step with --folio-accent.
  syncFindColors() {
    const root = document.documentElement;
    let last = "";
    const apply = () => {
      const v = getComputedStyle(root).getPropertyValue("--folio-accent").trim();
      const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v) || /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(v);
      if (!m || v === last) return;
      last = v;
      const [r, g, b] = m.slice(1, 4).map(x => /^\d+$/.test(x) && v.startsWith("rgb") ? +x : parseInt(x, 16));
      const hex = "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
      const fg = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#15121f" : "#ffffff";
      const P = Services.prefs;
      P.setStringPref("ui.textSelectAttentionBackground", hex);
      P.setStringPref("ui.textSelectAttentionForeground", fg);
      P.setStringPref("ui.textHighlightBackground", hex + "66");
      // Everything that was Firefox's purple (buttons, focus rings, toggles, dialogs, about: pages, Folio's own pages)
      // takes the accent: one user sheet for browser-made documents, swapped whenever the accent changes (2026-11-26).
      try {
        const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
        const hover = "color-mix(in srgb, white 12%, " + hex + ")", active = "color-mix(in srgb, white 22%, " + hex + ")";
        const css = `@-moz-document url-prefix("chrome://"), url-prefix("about:"), url-prefix("resource://") {
          :root, :host { --color-accent-primary: ${hex} !important; --color-accent-primary-hover: ${hover} !important;
            --color-accent-primary-active: ${active} !important; --color-accent-primary-selected: ${hex} !important;
            --focus-outline-color: ${hex} !important; --button-text-color-primary: ${fg} !important;
            --button-background-color-primary: ${hex} !important; --button-background-color-primary-hover: ${hover} !important;
            --button-background-color-primary-active: ${active} !important; --button-border-color-primary: transparent !important;
            --checkbox-checked-bgcolor: ${hex} !important; --toggle-background-color-pressed: ${hex} !important;
            --color-accent-secondary: ${hex} !important;
            --button-background-color-primary-disabled: color-mix(in srgb, ${hex} 40%, transparent) !important;
            --button-text-color-primary-disabled: color-mix(in srgb, ${fg} 60%, transparent) !important;
            --color-violet-30: ${hex} !important; --color-violet-50: ${hex} !important; --color-violet-60: ${hover} !important; }
          :root { accent-color: ${hex}; } }`;
        const uri = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css));
        if (FolioZen._accentSheet && sss.sheetRegistered(FolioZen._accentSheet, sss.USER_SHEET)) sss.unregisterSheet(FolioZen._accentSheet, sss.USER_SHEET);
        sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
        FolioZen._accentSheet = uri;
      } catch (e) { console.warn("Folio accent sheet:", e); }
    };
    new MutationObserver(() => setTimeout(apply, 400)).observe(root, { attributes: true, attributeFilter: ["style", "folio-wallpaper"] });
    setTimeout(apply, 800);
  },

  // Copy-link button in the address bar (Zen's URL pill has one): click = copy the link, Shift+click = as Markdown.
  addCopyButton() {
    const actions = document.getElementById("page-action-buttons");
    if (!actions || document.getElementById("folio-copy-button")) return;
    const b = document.createXULElement("hbox");
    b.id = "folio-copy-button";
    b.className = "urlbar-page-action";
    b.setAttribute("role", "button");
    b.setAttribute("tooltiptext", "Copy link (Shift+click: as Markdown)");
    b.setAttribute("aria-label", "Copy link");
    const icon = document.createXULElement("image");
    icon.className = "urlbar-icon";
    b.append(icon);
    b.tabIndex = 0;
    const go = (md) => {
      window.FolioActions?.copyURL(md);
      icon.animate([{ transform: "scale(.7)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2,0,0,1)" });
    };
    b.addEventListener("click", (e) => { if (e.button === 0) go(e.shiftKey); });
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e.shiftKey); } });
    const zen = document.getElementById("folio-zen-button");
    if (zen?.parentNode === actions) actions.insertBefore(b, zen); else actions.prepend(b);
    const update = () => { b.hidden = !/^https?$/.test(gBrowser.selectedBrowser.currentURI?.scheme || ""); };
    gBrowser.addProgressListener({
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(wp) { if (wp?.isTopLevel) update(); },
    });
    gBrowser.tabContainer.addEventListener("TabSelect", update);
    update();
  },

  // Shift + touchpad swipe left/right -> the space on that side (2026-11-25, Sammy). On Linux, touchpad swipes reach the
  // browser as Firefox's own swipe GESTURES (the back/forward ones), not as scroll events, so we take them here, first
  // (capture), only while Shift is held; without Shift, Firefox's back/forward is untouched. While the fingers move, an
  // accent line grows from the middle of the page toward the swipe; it flashes when the switch happens.
  watchSwipeGestures() {
    const W = window.SimpleGestureEvent; // direction constants (Ci.nsIDOMSimpleGestureEvent is gone in Firefox 160)
    const neighbour = (dir) => {
      const S = window.FolioSidebar;
      if (!S) return null;
      const list = S.spaces();
      return list[list.findIndex(s => s.id === S.currentSpaceId()) + dir] || null;
    };
    let line = null;
    const box = () => document.getElementById("tabbrowser-tabbox")?.getBoundingClientRect();
    const showLine = () => {
      line?.remove();
      const r = box();
      if (!r) return;
      line = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      line.id = "folio-swipe-line";
      Object.assign(line.style, { left: (r.left + r.width / 2) + "px", top: (r.top + 6) + "px", width: (r.width / 2 - 24) + "px" });
      document.body.append(line);
    };
    const setLine = (p) => {
      if (!line) return;
      // p: -1..1 (left..right). The line grows from the center toward the swipe.
      const k = Math.max(0, Math.min(1, Math.abs(p)));
      line.style.transformOrigin = p < 0 ? "left center" : "left center";
      line.style.transform = `translateX(${p < 0 ? "-100%" : "0"}) scaleX(${k})`;
      if (p < 0) line.style.transformOrigin = "right center";
      line.style.opacity = String(0.35 + 0.65 * k);
      line.style.background = p < 0 ? "linear-gradient(270deg, transparent, var(--folio-accent) 30%, var(--folio-accent))" : "";
    };
    const endLine = (done) => {
      const l = line; line = null;
      if (!l) return;
      if (done) l.animate([{ filter: "brightness(1.6)", opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-out", fill: "forwards" }).onfinish = () => l.remove();
      else l.animate([{ opacity: Number(l.style.opacity) || 1 }, { opacity: 0, transform: l.style.transform.replace(/scaleX\([^)]*\)/, "scaleX(0)") }], { duration: 200, easing: "ease-in", fill: "forwards" }).onfinish = () => l.remove();
    };
    let active = false;
    const take = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    window.addEventListener("MozSwipeGestureMayStart", (e) => {
      if (!e.shiftKey || !window.FolioSidebar) return;
      const left = neighbour(-1), right = neighbour(1);
      if (!left && !right) return;
      e.allowedDirections = (left ? W.DIRECTION_LEFT : 0) | (right ? W.DIRECTION_RIGHT : 0);
      active = true;
      take(e);
    }, true);
    window.addEventListener("MozSwipeGestureStart", (e) => { if (!active) return; take(e); showLine(); }, true);
    window.addEventListener("MozSwipeGestureUpdate", (e) => { if (!active) return; take(e); setLine(-e.delta); }, true);
    window.addEventListener("MozSwipeGestureEnd", (e) => { if (!active) return; take(e); active = false; endLine(this._swiped); this._swiped = false; }, true);
    window.addEventListener("MozSwipeGesture", (e) => {
      if (!active && !e.shiftKey) return;
      take(e);
      const dir = e.direction & W.DIRECTION_LEFT ? -1 : e.direction & W.DIRECTION_RIGHT ? 1 : 0;
      if (dir) { this._swiped = true; this.switchBy(dir); }
    }, true);
    this._testLine = { showLine, setLine, endLine };

    // Shift + scroll: up = space on the left, down = space on the right. The accent line grows with the scroll and
    // flashes when the space switches; stop scrolling early and it shrinks back.
    const NEED = 160;
    let acc = 0, idle = 0, cool = 0;
    this.wheel = (d) => {
      const now = Date.now();
      if (now < cool) return;
      if (acc && Math.sign(d) !== Math.sign(acc)) acc = 0;
      acc += d;
      const dir = acc > 0 ? 1 : -1;
      if (!neighbour(dir)) { acc = 0; if (line) endLine(false); return; }
      if (!line) showLine();
      setLine(Math.max(-1, Math.min(1, acc / NEED)));
      clearTimeout(idle);
      if (Math.abs(acc) >= NEED) { acc = 0; cool = now + 420; endLine(true); this.switchBy(dir); return; }
      idle = setTimeout(() => { acc = 0; if (line) endLine(false); }, 260);
    };
  },

  actor(browser = gBrowser.selectedBrowser) {
    try { return browser.browsingContext?.currentWindowGlobal?.getActor("FolioZen"); } catch (e) { return null; }
  },
  // Error pages get the new tab's look (2026-11-26): the page paints no background (info-pages.css), and Folio marks
  // its browser so the window paints the wallpaper behind it (browser-shared.css, [folio-errorpage]); in see-through
  // mode the window shows through instead. On a wallpaper or see-through, the page's text is light (dark scheme).
  watchErrorPages() {
    const ERR = /^about:(neterror|certerror|blocked|httpsonlyerror|tabcrashed)/;
    const sync = (browser) => {
      if (!browser) return;
      let err = false;
      try { err = ERR.test(browser.documentURI?.spec || ""); } catch (e) {}
      const root = document.documentElement;
      const themed = err && (root.hasAttribute("folio-wallpaper") || root.hasAttribute("folio-seethrough"));
      browser.toggleAttribute("folio-errorpage", themed);
      browser.closest(".browserContainer")?.toggleAttribute("folio-errorpage", themed);
      if (themed) browser.setAttribute("transparent", "true");
      else if (!root.hasAttribute("folio-seethrough")) browser.removeAttribute("transparent");
      try {
        const bc = browser.browsingContext;
        if (bc && !bc.parent) {
          if (themed) { if (bc.prefersColorSchemeOverride !== "dark") { browser._folioSchemeWas = bc.prefersColorSchemeOverride; bc.prefersColorSchemeOverride = "dark"; } }
          else if (browser._folioSchemeWas !== undefined) { bc.prefersColorSchemeOverride = browser._folioSchemeWas; browser._folioSchemeWas = undefined; }
        }
      } catch (e) { /* not settable here */ }
    };
    gBrowser.addTabsProgressListener({
      onLocationChange(browser, wp) { if (wp?.isTopLevel) sync(browser); },
      onStateChange(browser, wp, req, flags) {
        if (wp?.isTopLevel && (flags & Ci.nsIWebProgressListener.STATE_STOP)) sync(browser);
      },
    });
    // Wallpaper / see-through switched: refresh every tab.
    new MutationObserver(() => { for (const b of gBrowser.browsers) sync(b); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["folio-wallpaper", "folio-seethrough"] });
    for (const b of gBrowser.browsers) sync(b);
  },

  // Zen mode starts in the page and the keyboard goes to the page, so Esc reaches it. Before (bug, 2026-11-26): the
  // Zen button left focus in the address bar, Esc went there and Zen never ended. Esc ends Zen: everything already
  // hidden stays saved (each click saves at once); with nothing hidden it just leaves Zen.
  start(browser) {
    const b = browser || gBrowser.selectedBrowser;
    this.actor(b)?.sendAsyncMessage("Start");
    this._zenBrowser = b;
    try { gURLBar?.view?.close?.(); } catch (e) {}
    setTimeout(() => { try { if (b === gBrowser.selectedBrowser) b.focus(); } catch (e) {} }, 0);
    if (!this._escHooked) {
      this._escHooked = true;
      // Esc anywhere in the window (address bar, sidebar) while the page is in Zen mode: end it. Keys typed in the
      // page itself are handled by the page's actor.
      window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !this._zenBrowser || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        if (this._zenBrowser !== gBrowser.selectedBrowser) { this._zenBrowser = null; return; }
        if (e.target === gBrowser.selectedBrowser) { this._zenBrowser = null; return; } // the page's own Esc ends it
        e.preventDefault(); e.stopPropagation();
        this.stop(this._zenBrowser);
      }, true);
      gBrowser.tabContainer.addEventListener("TabSelect", () => { if (this._zenBrowser) { this.stop(this._zenBrowser); } });
    }
  },
  stop(browser) {
    try { this.actor(browser)?.sendAsyncMessage("Stop"); } catch (e) {}
    if (!browser || browser === this._zenBrowser) this._zenBrowser = null;
  },

  // The space on the left (-1) or right (+1); no wrap-around at the ends.
  switchBy(dir) {
    const S = window.FolioSidebar;
    if (!S) return;
    const list = S.spaces();
    const i = list.findIndex(s => s.id === S.currentSpaceId());
    const next = list[i + dir];
    if (next) S.switchSpace(next.id);
  },
};
window.FolioZen = FolioZen;
if (document.readyState === "complete") FolioZen.init();
else window.addEventListener("load", () => FolioZen.init(), { once: true });
