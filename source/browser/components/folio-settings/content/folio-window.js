/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Window glue: sidebar button, tab keys, window buttons, color scheme, site add-ons, zoom popup, engine/bang pills,
// new-tab focus. Split out of folio-sidebar.js 2026-11-26, no code change, same load order.

// Firefox's own "sidebar" toolbar button (CustomizableUI adds it to the toolbar on a profile's second start) only
// toggled Firefox's hidden sidebar: a button that did nothing you could see. It now shows/hides Folio's sidebar,
// and its pressed look follows Folio's sidebar.
window.addEventListener("command", (e) => {
  if (e.target?.id !== "sidebar-button" || typeof FolioSidebar == "undefined") return;
  e.stopImmediatePropagation();
  e.preventDefault();
  FolioSidebar.toggle();
}, true);
{
  const syncSidebarButton = () => {
    const b = document.getElementById("sidebar-button");
    if (b) b.toggleAttribute("checked", !document.documentElement.hasAttribute("folio-sidebar-hidden"));
  };
  new MutationObserver(syncSidebarButton).observe(document.documentElement, { attributes: true, attributeFilter: ["folio-sidebar-hidden"] });
  window.addEventListener("load", () => setTimeout(syncSidebarButton, 500), { once: true });
}

// Keyboard in the tab list (night shift 2026-11-24): Up/Down/Home/End move between rows, Enter/Space opens the tab,
// Delete closes it, the Menu key or Shift+F10 opens its menu. Focus stays on the list while you move.
(function folioTabKeys() {
  const list = document.getElementById("folio-sidebar-tabs");
  if (!list || typeof FolioSidebar == "undefined") { setTimeout(folioTabKeys, 200); return; }
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-orientation", "vertical");
  list.setAttribute("aria-label", "Tabs");
  list.addEventListener("keydown", (e) => {
    const row = e.target.closest?.(".folio-side-tab");
    if (!row) return;
    const rows = [...list.querySelectorAll(".folio-side-tab")].filter(r => r.getClientRects().length && !r.classList.contains("folio-closing"));
    const i = rows.indexOf(row);
    const tab = FolioSidebar._rowTabs.get(row);
    const go = (r) => { if (!r) return; rows.forEach(x => { x.tabIndex = -1; }); r.tabIndex = 0; r.focus(); };
    switch (e.key) {
      case "ArrowDown": go(rows[i + 1]); break;
      case "ArrowUp": go(rows[i - 1]); break;
      case "Home": go(rows[0]); break;
      case "End": go(rows[rows.length - 1]); break;
      case "Enter": case " ": if (tab) gBrowser.selectedTab = tab; break;
      case "Delete": {
        if (!tab) return;
        const next = rows[i + 1] || rows[i - 1];
        FolioSidebar.closeTabSafely(tab);
        setTimeout(() => next?.isConnected && go(next), 480); // after the close animation and the re-render
        break;
      }
      case "ContextMenu": {
        const r = row.getBoundingClientRect();
        if (tab) FolioSidebar.tabMenu(tab, row, r.left + 24, r.bottom);
        break;
      }
      case "F10": if (e.shiftKey) { const r = row.getBoundingClientRect(); if (tab) FolioSidebar.tabMenu(tab, row, r.left + 24, r.bottom); break; } return;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  });
})();

// Window buttons (night shift 2026-11-24). Folio's Arc look drops close / minimize / maximize because a tiling window
// manager (Sammy's Hyprland) handles windows. On a floating desktop (GNOME, KDE, Windows) that left no way to close or
// maximize the window, since Folio draws its own title bar. Tiling WMs keep the clean look; everyone else gets the buttons.
(function folioWindowButtons() {
  const env = Services.env;
  const desk = `${env.get("XDG_CURRENT_DESKTOP")}:${env.get("XDG_SESSION_DESKTOP")}:${env.get("DESKTOP_SESSION")}`;
  const tiling = ["HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK", "I3SOCK", "NIRI_SOCKET"].some(v => env.exists(v)) ||
    /hyprland|sway|i3|river|niri|bspwm|dwm|qtile|awesome|xmonad|herbstluft|leftwm|spectrwm/i.test(desk);
  document.documentElement.toggleAttribute("folio-tiling", tiling);
})();

// Light / dark (2026-11-24): Folio's own UI follows Settings > Appearance (website appearance). Light and Dark are
// explicit; System follows the desktop. [folio-light] on the window switches Folio's CSS palette.
const FolioScheme = {
  PREF: "layout.css.prefers-color-scheme.content-override", // 0 dark, 1 light, 2 follow the browser / desktop
  isLight() {
    // See-through always uses the dark glass (Sammy 2026-11-26: light text on Zen-style clear glass; dark text needed a
    // white frost that hid the wallpaper). The Light choice is kept and comes back when see-through is off.
    if (Services.prefs.getBoolPref("folio.seethrough", false)) return false;
    // A wallpaper theme is dark too (its palette is dark): Light's pastel tiles and black ink clashed with it (Space 1).
    if (Services.prefs.getStringPref("folio.theme.wallpaper.path", "")) return false;
    const o = Services.prefs.getIntPref(this.PREF, 2);
    if (o === 1) return true;
    if (o === 0) return false;
    return !window.matchMedia("(prefers-color-scheme: dark)").matches;
  },
  // The user's own choice, ignoring see-through: see-through keeps the dark glass but Light still gets white frosted
  // controls (address bar, page search bars, buttons). Pages read folio.seethrough.lightLook (FolioSeeThroughChild).
  choseLight() {
    const o = Services.prefs.getIntPref(this.PREF, 2);
    return o === 1 || (o === 2 && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  },
  apply() {
    document.documentElement.toggleAttribute("folio-light", this.isLight());
    const chose = this.choseLight();
    document.documentElement.toggleAttribute("folio-light-pref", chose);
    if (Services.prefs.getBoolPref("folio.seethrough.lightLook", false) !== chose) Services.prefs.setBoolPref("folio.seethrough.lightLook", chose);
  },
  init() {
    this.apply();
    const obs = () => this.apply();
    Services.prefs.addObserver(this.PREF, obs);
    Services.prefs.addObserver("folio.seethrough", obs);
    Services.prefs.addObserver("folio.theme.wallpaper.path", obs);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", obs);
    window.addEventListener("unload", () => { Services.prefs.removeObserver(this.PREF, obs); Services.prefs.removeObserver("folio.seethrough", obs); Services.prefs.removeObserver("folio.theme.wallpaper.path", obs); mq.removeEventListener("change", obs); }, { once: true });
  },
};
window.FolioScheme = FolioScheme;
FolioScheme.init();

// Folio's site-theming add-ons (Folio Pages: every site recolored from the wallpaper; Site Skins: WhatsApp) only do
// something when a wallpaper exists, yet they injected their scripts into every page. Measured: 23 MB with 8 tabs, plus
// script work on every page load. They are now switched on only while some space has a wallpaper. (2026-11-24)
const FolioSiteAddons = {
  IDS: ["site-pages@folio.browser", "site-skins@folio.browser"],
  wanted() {
    if (Services.prefs.getStringPref("folio.theme.wallpaper.path", "")) return true;
    try { return JSON.parse(Services.prefs.getStringPref("folio.spaces", "[]")).some(s => s.wallpaper); } catch (e) { return false; }
  },
  async sync() {
    // One window does it (the add-on state is app-wide).
    if (Services.wm.getMostRecentWindow("navigator:browser") !== window) return;
    const want = this.wanted();
    try {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      for (const id of this.IDS) {
        const a = await AddonManager.getAddonByID(id);
        if (!a) continue;
        if (want && a.userDisabled) await a.enable();
        else if (!want && !a.userDisabled) await a.disable();
      }
    } catch (e) { console.warn("Folio site add-ons:", e); }
  },
  init() {
    const run = () => { clearTimeout(this._t); this._t = setTimeout(() => this.sync(), 1500); };
    for (const p of ["folio.theme.wallpaper.path", "folio.spaces"]) Services.prefs.addObserver(p, run);
    window.addEventListener("unload", () => { for (const p of ["folio.theme.wallpaper.path", "folio.spaces"]) Services.prefs.removeObserver(p, run); }, { once: true });
    setTimeout(() => this.sync(), 4000); // after startup settles
  },
};
window.FolioSiteAddons = FolioSiteAddons;
FolioSiteAddons.init();

// ---- Zoom popup (2026-11-24, Sammy: zoom % gone from the address bar, "or at least a popup"; the bar should be minimal) ----
// The address bar's zoom badge is hidden for good (browser-shared.css). When the USER zooms (Ctrl +/-, Ctrl+wheel, Ctrl 0,
// the menu: all go through FullZoom.enlarge/reduce/reset), a small pill over the top of the page shows the new size, with
// Reset when it isn't the default, and fades away. Tab switches and page loads never show it.
const FolioZoomPopup = {
  HIDE_MS: 1600,
  init() {
    if (typeof FullZoom == "undefined" || FullZoom._folioPopup) return;
    FullZoom._folioPopup = true;
    for (const fn of ["enlarge", "reduce", "reset"]) {
      const orig = FullZoom[fn];
      FullZoom[fn] = function (...args) {
        const browser = args[0] || gBrowser.selectedBrowser;
        const r = orig.apply(this, args);
        Promise.resolve(r).then(() => setTimeout(() => FolioZoomPopup.show(browser), 0), () => {});
        return r;
      };
    }
  },
  build() {
    const NS = "http://www.w3.org/1999/xhtml";
    const pop = document.createElementNS(NS, "div");
    pop.id = "folio-zoom-pop";
    pop.setAttribute("role", "status");
    pop.setAttribute("aria-live", "polite");
    const value = document.createElementNS(NS, "span");
    value.className = "folio-zoom-value";
    const reset = document.createElementNS(NS, "button");
    reset.className = "folio-zoom-reset";
    reset.textContent = "Reset";
    reset.addEventListener("click", () => FullZoom.reset());
    pop.append(value, reset);
    pop.addEventListener("mouseenter", () => clearTimeout(this._t));
    pop.addEventListener("mouseleave", () => this.hideLater());
    document.body.append(pop);
    return pop;
  },
  async show(browser) {
    if (browser !== gBrowser.selectedBrowser) return;
    const pop = document.getElementById("folio-zoom-pop") || this.build();
    const pct = Math.round(ZoomManager.getZoomForBrowser(browser) * 100);
    let def = 100;
    try { def = Math.round((await window.FolioZoom.get()) * 100); } catch (e) {}
    pop.querySelector(".folio-zoom-value").textContent = pct + "%";
    pop.querySelector(".folio-zoom-reset").hidden = pct === def;
    const box = document.getElementById("tabbrowser-tabbox")?.getBoundingClientRect();
    if (box) { pop.style.left = Math.round(box.left + box.width / 2) + "px"; pop.style.top = Math.round(box.top + 14) + "px"; }
    pop.setAttribute("open", "");
    this.hideLater();
  },
  hideLater() {
    clearTimeout(this._t);
    this._t = setTimeout(() => document.getElementById("folio-zoom-pop")?.removeAttribute("open"), this.HIDE_MS);
  },
};
window.FolioZoomPopup = FolioZoomPopup;
if (document.readyState == "complete") FolioZoomPopup.init();
else window.addEventListener("load", () => FolioZoomPopup.init(), { once: true });

// (2026-11-25) The new tab page has no search box any more (clock + date instead): search is the address bar, which
// keeps focus on a new tab. The earlier hand-off code was removed with the box.

// (2026-11-25) The address bar stays in place; only its results list widens (browser-shared.css .urlbarView).
// TRAP: never touch gURLBar before the window has loaded: it is a lazy getter, and an early `typeof gURLBar` runs it
// while #urlbar doesn't exist yet and caches null forever, which breaks the whole window.

// Pills take the site's own color (2026-11-25, Sammy: "colorful as the site's icon color, like the video"): the icon's
// dominant color (FolioSidebar.brandColor, as for Essentials) as the background, dark or white text by brightness.
function folioPillColor(el, iconUrlOrImg) {
  if (!el || !iconUrlOrImg) return;
  // An <img> that's already loaded: read its pixels directly (a page-icon: URL can't be re-fetched, which left the
  // pill in the accent color for sites Firefox had an icon for, 2026-11-25).
  const got = typeof iconUrlOrImg === "string"
    ? FolioSidebar.brandColor(iconUrlOrImg)
    : Promise.resolve().then(() => { try { return FolioSidebar.dominantColor(iconUrlOrImg); } catch (e) { return null; } });
  got.then(rgb => {
    if (!rgb || !el.isConnected) return;
    const [r, g, b] = rgb;
    const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
    el.style.setProperty("--folio-pill-bg", `rgb(${r} ${g} ${b})`);
    el.style.setProperty("--folio-pill-fg", light ? "#15121f" : "#ffffff");
  });
}
// Search-engine pill (@brave etc.): color from the engine's icon, set on #urlbar for the ::part(button) rule.
(function folioEnginePillColor() {
  if (document.readyState !== "complete") { window.addEventListener("load", folioEnginePillColor, { once: true }); return; }
  const urlbar = document.getElementById("urlbar");
  const update = async () => {
    urlbar.style.removeProperty("--folio-pill-bg");
    urlbar.style.removeProperty("--folio-pill-fg");
    const name = gURLBar.searchMode?.engineName;
    if (!name) return;
    try {
      const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
      const engine = SearchService.getEngineByName(name);
      const icon = await engine?.getIconURL?.();
      if (icon) folioPillColor(urlbar, icon);
    } catch (e) {}
  };
  new MutationObserver(update).observe(urlbar, { attributes: true, attributeFilter: ["searchmode"] });
})();

// ---- Bang pill (2026-11-25, Sammy: "please tell me you added the pill to bangs too"): type "!yt" then space, Tab or
// Right, and it becomes a colored "YouTube" pill with the site's icon; what you type next is the query (Enter
// searches that site: FolioBangs' provider puts "!yt " back in front). Backspace on an empty field or Esc removes it. ----
(function folioBangPill() {
  if (document.readyState !== "complete") { window.addEventListener("load", folioBangPill, { once: true }); return; }
  const { FolioBangs } = ChromeUtils.importESModule("resource:///modules/FolioBangs.sys.mjs");
  const input = gURLBar.inputField;
  const NS = "http://www.w3.org/1999/xhtml";
  let pill = null;
  const requery = () => input.dispatchEvent(new Event("input", { bubbles: true }));
  const remove = () => {
    pill?.remove(); pill = null;
    FolioBangs.setPill("");
    document.getElementById("urlbar")?.removeAttribute("folio-bang");
  };
  const show = (b) => {
    remove();
    FolioBangs.setPill(b.trigger);
    pill = document.createElementNS(NS, "span");
    pill.className = "folio-bang-pill";
    pill.title = `!${b.trigger}`;
    // The site's real icon: Firefox's icon cache first, then the site's own favicon (the site you're about to search).
    const img = document.createElementNS(NS, "img");
    img.alt = "";
    img.hidden = true;
    // Shown from Firefox's icon cache when it has one, but the COLOR always comes from the icon file itself (a
    // cached page-icon: image can't be read back, which left !r / !amazon purple, 2026-11-25).
    img.addEventListener("load", () => { img.hidden = false; });
    FolioBangs.iconFor(b.domain).then(url => { if (url) folioPillColor(pillRef, url); else folioPillColor(pillRef, img); });
    img.addEventListener("error", () => img.remove());
    // page-icon: never fails (an unknown site gets the default globe), so ask the favicon service first.
    (async () => {
      let cached = null;
      try {
        cached = await PlacesUtils.favicons.getFaviconForPage(Services.io.newURI("https://" + b.domain + "/"));
      } catch (e) {}
      img.src = cached ? "page-icon:https://" + b.domain + "/" : (await FolioBangs.iconFor(b.domain)) || "";
      if (!img.src) img.remove();
    })();
    const label = document.createElementNS(NS, "span");
    label.textContent = b.name;
    pill.append(img, label);
    const pillRef = pill;
    input.before(pill);
    document.getElementById("urlbar")?.setAttribute("folio-bang", "");
  };
  input.addEventListener("keydown", (e) => {
    if (pill) {
      if ((e.key === "Backspace" && input.selectionStart === 0 && input.selectionEnd === 0) || e.key === "Escape") {
        const t = FolioBangs.pill;
        remove();
        if (e.key === "Backspace") { e.preventDefault(); input.value = "!" + t; requery(); }
      }
      return;
    }
    const atEnd = input.selectionStart === input.value.length;
    if (e.key === " " || e.key === "Tab" || (e.key === "ArrowRight" && atEnd)) {
      const m = /^!(\S+)$/.exec(input.value);
      const b = m && FolioBangs.lookup(m[1]);
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      show(b);
      input.value = "";
      requery();
    }
  }, true);
  // The pill belongs to one typing session: gone after a navigation, a tab switch or leaving the bar.
  input.addEventListener("blur", () => setTimeout(() => { if (!gURLBar.focused) remove(); }, 150));
  gBrowser.tabContainer.addEventListener("TabSelect", remove);
  gBrowser.addProgressListener({
    QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
    onLocationChange(wp) { if (wp?.isTopLevel) remove(); },
  });
})();

// New tab -> the address bar is focused, ready to type (2026-11-25, Sammy). Ctrl+T already did; Folio's own "New tab"
// paths (sidebar button, empty space, switching to an empty new tab) did not. One rule for all of them.
(function folioNewTabFocus() {
  if (document.readyState !== "complete") { window.addEventListener("load", folioNewTabFocus, { once: true }); return; }
  const isNewTab = (b) => /^about:folio-newtab/.test(b?.currentURI?.spec || "");
  const focusBar = () => {
    if (!isNewTab(gBrowser.selectedBrowser) || gURLBar.focused) return;
    requestAnimationFrame(() => { if (isNewTab(gBrowser.selectedBrowser)) { gURLBar.focus(); gURLBar.select(); } });
  };
  gBrowser.tabContainer.addEventListener("TabSelect", focusBar);
  gBrowser.addProgressListener({
    QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
    onLocationChange(wp) { if (wp?.isTopLevel) focusBar(); },
  });
})();
