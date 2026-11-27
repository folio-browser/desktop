/* Folio keyboard shortcuts: every shortcut of the browser in one list, each one changeable, clearable and resettable
   (Settings > Keyboard Shortcuts). Changes are kept in the pref folio.keys.overrides = { keyId: {key|keycode, modifiers} | {off:true} }.
   Firefox reads its <key> elements once and caches them, so a change is applied by replacing the whole <keyset> with a copy
   (the way Zen does it). Defaults are read from the live elements at startup, so they follow the platform (Ctrl or Cmd). */
(() => {
  const PREF = "folio.keys.overrides";
  const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
  const isMac = AppConstants.platform === "macosx";

  // id, name, group. Keys not listed here but with a command still appear, under "Other", named from their id.
  const GROUPS = ["Spaces and sidebar", "Tabs", "Navigation", "Page", "Windows", "Bookmarks, history and tools", "Developer tools", "Other"];
  const CATALOG = [
    ["key_folioToggleSidebar", "Show or hide the sidebar", 0],
    ["key_folioSpaceNext", "Next space", 0], ["key_folioSpacePrev", "Previous space", 0],
    ...Array.from({ length: 10 }, (_, i) => ["key_folioSpace" + (i + 1), "Go to space " + (i + 1), 0]),
    ["key_folioNewSpace", "Create a space", 0],
    ["key_folioHistory", "Show or hide history", 0],
    ["key_folioCopyURL", "Copy current URL", 1], ["key_folioCopyURLMarkdown", "Copy current URL as Markdown", 1],
    ["key_folioCloseUnpinned", "Close all unpinned tabs", 1], ["key_folioTogglePin", "Pin or unpin tab", 1],
    ["key_addTabSplitView", "Split view: open a tab beside this one", 1], ["key_separateTabSplitView", "Close split view", 1],
    ["key_newNavigatorTab", "New tab", 1], ["key_close", "Close tab", 1], ["key_restoreLastClosedTabOrWindowOrSession", "Reopen closed tab", 1],
    ["key_duplicateTab", "Duplicate tab", 1], ["key_toggleMute", "Mute or unmute tab", 1], ["key_showAllTabs", "Show all tabs", 1],
    ["key_searchTabs", "Search tabs", 1],
    ...Array.from({ length: 8 }, (_, i) => ["key_selectTab" + (i + 1), "Go to tab " + (i + 1), 1]),
    ["key_selectLastTab", "Go to the last tab", 1],
    ["focusURLBar", "Focus the address bar", 2], ["focusURLBar2", "Focus the address bar (alternative)", 2], ["key_search", "Focus the search bar", 2],
    ["key_search2", "Focus the search bar (alternative)", 2],
    ["goBackKb", "Back", 2], ["goForwardKb", "Forward", 2], ["goBackKb2", "Back (alternative)", 2], ["goForwardKb2", "Forward (alternative)", 2],
    ["goHome", "Home page", 2], ["key_reload", "Reload", 2], ["key_reload2", "Reload (F5)", 2], ["key_reload_skip_cache", "Reload, skipping the cache", 2],
    ["key_reload_skip_cache2", "Reload, skipping the cache (F5)", 2], ["key_stop", "Stop loading", 2],
    ["key_find", "Find in page", 3], ["key_findAgain", "Find next", 3], ["key_findPrevious", "Find previous", 3], ["key_findAgain2", "Find next (F3)", 3],
    ["key_findPrevious2", "Find previous (F3)", 3], ["key_fullZoomEnlarge", "Zoom in", 3], ["key_fullZoomReduce", "Zoom out", 3],
    ["key_fullZoomReset", "Reset zoom", 3], ["printKb", "Print", 3], ["key_savePage", "Save page as", 3], ["openFileKb", "Open a file", 3],
    ["key_viewSource", "View page source", 3], ["key_viewInfo", "Page info", 3], ["key_screenshot", "Take a screenshot", 3],
    ["key_togglePictureInPicture", "Picture-in-picture", 3], ["key_toggleReaderMode", "Reader view", 3],
    ["key_switchTextDirection", "Switch text direction", 3], ["key_enterFullScreen", "Full screen", 3],
    ["key_newNavigator", "New window", 4], ["key_closeWindow", "Close window", 4], ["key_privatebrowsing", "New private window", 4],
    ["key_undoCloseWindow", "Reopen closed window", 4], ["key_quitApplication", "Quit", 4], ["key_quickRestart", "Restart", 4],
    ["addBookmarkAsKb", "Bookmark this page", 5], ["bookmarkAllTabsKb", "Bookmark all tabs", 5], ["manBookmarkKb", "Show all bookmarks", 5],
    ["showAllHistoryKb", "Show all history", 5], ["viewBookmarksToolbarKb", "Show or hide the bookmarks toolbar", 5],
    ["key_openDownloads", "Downloads", 5], ["key_openAddons", "Add-ons and themes", 5], ["key_sanitize", "Clear recent history", 5],
    ["key_aboutProcesses", "Task manager", 5],
    ["key_toggleToolbox", "Developer tools", 6], ["key_toggleToolboxF12", "Developer tools (F12)", 6], ["key_browserToolbox", "Browser toolbox", 6],
    ["key_browserConsole", "Browser console", 6], ["key_responsiveDesignMode", "Responsive design mode", 6], ["key_inspector", "Inspector", 6],
    ["key_webconsole", "Web console", 6], ["key_jsdebugger", "Debugger", 6], ["key_netmonitor", "Network", 6], ["key_styleeditor", "Style editor", 6],
    ["key_performance", "Performance", 6], ["key_storage", "Storage", 6], ["key_dom", "DOM", 6], ["key_accessibility", "Accessibility", 6],
  ];
  // Firefox's own sidebars are not used in Folio; hidden from the list.
  // Folio's own defaults where Zen's keys take over a Firefox one (the Firefox action moves, nothing is lost).
  // null = no default shortcut. Reset in Settings goes back to these.
  const FOLIO_DEFAULTS = {
    key_inspector: { key: "C", modifiers: "accel,alt" },            // Ctrl+Shift+C is "copy current URL" now
    key_webconsole: { key: "K", modifiers: "accel,alt" },           // Ctrl+Shift+K is "close all unpinned tabs"
    bookmarkAllTabsKb: { key: "D", modifiers: "accel,alt,shift" },  // Ctrl+Shift+D is "pin or unpin tab"
    viewOpenTabsSidebarKb: null,                                    // Firefox's own sidebar is not used in Folio
    key_addTabSplitView: { key: "V", modifiers: "accel,alt" },
    key_separateTabSplitView: { key: "U", modifiers: "accel,alt" },
  };
  const HIDE = new Set(["viewBookmarksSidebarKb", "key_gotoHistory", "viewGenaiChatSidebarKb", "viewOpenTabsSidebarKb", "toggleSidebarKb"]);
  const byId = new Map(CATALOG.map(([id, name, g]) => [id, { name, group: g }]));

  const niceName = (id) => id.replace(/^key_/, "").replace(/Kb\d*$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const attrCombo = (el) => ({ key: el.getAttribute("key") || "", keycode: el.getAttribute("keycode") || "", modifiers: el.getAttribute("modifiers") || "" });
  const sig = (c) => {
    const mods = [...new Set((c.modifiers || "").split(/[ ,]+/).filter(Boolean).map((m) => (m === "accel" ? (isMac ? "meta" : "ctrl") : m === "control" ? "ctrl" : m)))].sort();
    return mods.join("+") + "|" + (c.keycode || (c.key || "").toUpperCase());
  };
  const hasBinding = (el) => !!(el.getAttribute("key") || el.getAttribute("keycode"));

  const FolioKeys = {
    GROUPS,
    _defaults: new Map(),
    _suspended: [],

    allKeys() { return [...document.querySelectorAll("keyset key")]; },
    keyEl(id) { return document.getElementById(id); },
    overrides() { try { return JSON.parse(Services.prefs.getStringPref(PREF, "{}")) || {}; } catch (e) { return {}; } },
    setOverrides(o) { Services.prefs.setStringPref(PREF, JSON.stringify(o)); },

    pretty(combo) {
      if (!combo || (!combo.key && !combo.keycode)) return "";
      const el = document.createXULElement("key");
      if (combo.key) el.setAttribute("key", combo.key);
      if (combo.keycode) el.setAttribute("keycode", combo.keycode);
      if (combo.modifiers) el.setAttribute("modifiers", combo.modifiers);
      try { return ShortcutUtils.prettifyShortcut(el); } catch (e) { return ""; }
    },
    nameOf(id) { return byId.get(id)?.name || niceName(id); },

    // The rows of the settings list.
    list() {
      const ov = this.overrides();
      const rows = [];
      const seen = new Set();
      const add = (id, name, group) => {
        const el = this.keyEl(id);
        if (!el || seen.has(id)) return;
        seen.add(id);
        const off = ov[id] ? !!ov[id].off : !!this._defaults.get(id)?.off;
        const combo = off ? null : attrCombo(el);
        rows.push({ id, name, group, text: off ? "" : this.pretty(combo), off, changed: id in ov, defaultText: this.pretty(this._defaults.get(id)) });
      };
      for (const [id, name, g] of CATALOG) add(id, name, g);
      for (const el of this.allKeys()) {
        const id = el.id;
        if (!id || seen.has(id) || HIDE.has(id) || el.getAttribute("internal") === "true" || el.getAttribute("disabled") === "true" && !ov[id]) continue;
        // A shortcut the user changed (removed included) always stays listed, or its row and its reset button vanished
        // with the key (2026-11-26, Sammy: a removed shortcut could only come back through "Reset all").
        if (!(el.getAttribute("command") || el.hasAttribute("oncommand")) || (!hasBinding(el) && !ov[id])) continue;
        add(id, niceName(id), 7);
      }
      rows.sort((a, b) => a.group - b.group);
      return rows;
    },

    // Is this combination taken by another shortcut? Returns { id, name, internal } or null.
    findConflict(combo, exceptId) {
      const want = sig(combo);
      for (const el of this.allKeys()) {
        if (!el.id || el.id === exceptId || !hasBinding(el)) continue;
        if (el.getAttribute("disabled") === "true" && !el.hasAttribute("folio-suspended")) continue;
        if (sig(attrCombo(el)) === want) {
          return { id: el.id, name: this.nameOf(el.id), internal: el.getAttribute("internal") === "true" || !byId.has(el.id) && !(el.getAttribute("command") || el.hasAttribute("oncommand")) };
        }
      }
      return null;
    },

    // Turn a key press into a combination. Returns null for a lone modifier or a key we cannot name.
    captureCombo(e) {
      if (["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"].includes(e.key)) return null;
      const mods = [];
      if (isMac ? e.metaKey : e.ctrlKey) mods.push("accel");
      if (isMac && e.ctrlKey) mods.push("control");
      if (!isMac && e.metaKey) mods.push("meta");
      if (e.altKey) mods.push("alt");
      if (e.shiftKey) mods.push("shift");
      const code = e.code || "";
      const punct = { Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`" };
      const named = { ArrowLeft: "VK_LEFT", ArrowRight: "VK_RIGHT", ArrowUp: "VK_UP", ArrowDown: "VK_DOWN", Enter: "VK_RETURN", Tab: "VK_TAB",
        Backspace: "VK_BACK", Delete: "VK_DELETE", Insert: "VK_INSERT", Home: "VK_HOME", End: "VK_END", PageUp: "VK_PAGE_UP",
        PageDown: "VK_PAGE_DOWN", " ": "VK_SPACE", Escape: "VK_ESCAPE" };
      let key = "", keycode = "";
      if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
      else if (/^Digit\d$/.test(code)) key = code.slice(5);
      else if (punct[code]) key = punct[code];
      else if (named[e.key]) keycode = named[e.key];
      else if (/^F\d{1,2}$/.test(e.key)) keycode = "VK_" + e.key;
      else if (e.key && e.key.length === 1) key = e.key.toUpperCase();
      else return null;
      const printable = !!key || keycode === "VK_SPACE";
      return { key, keycode, modifiers: mods.join(","), printable, bare: !mods.some((m) => m !== "shift") };
    },

    set(id, combo) {
      const ov = this.overrides();
      if (!combo) ov[id] = { off: true };
      else {
        const c = { key: combo.key || "", keycode: combo.keycode || "", modifiers: combo.modifiers || "" };
        const def = this._defaults.get(id);
        if (def && sig(def) === sig(c)) delete ov[id]; else ov[id] = c;
      }
      this.setOverrides(ov);
    },
    reset(id) { const ov = this.overrides(); delete ov[id]; this.setOverrides(ov); },
    resetAll() { Services.prefs.clearUserPref(PREF); },

    // While the settings page records a new shortcut, no browser shortcut may fire (Ctrl+T would open a tab).
    suspend() {
      this.resume();
      for (const el of this.allKeys()) {
        if (el.getAttribute("disabled") !== "true") { el.setAttribute("disabled", "true"); el.setAttribute("folio-suspended", "true"); this._suspended.push(el); }
      }
    },
    resume() {
      for (const el of this._suspended) { el.removeAttribute("disabled"); el.removeAttribute("folio-suspended"); }
      this._suspended = [];
      for (const el of this.allKeys()) if (el.hasAttribute("folio-suspended")) { el.removeAttribute("disabled"); el.removeAttribute("folio-suspended"); }
    },

    // Make the document match the overrides. Replaces the keysets that changed (see the note at the top).
    apply() {
      this.resume();
      const ov = this.overrides();
      const touched = new Set();
      for (const el of this.allKeys()) {
        const id = el.id;
        if (!id) continue;
        if (!this._defaults.has(id)) this._defaults.set(id, { ...attrCombo(el), disabled: el.getAttribute("disabled") });
        const def = this._defaults.get(id);
        const want = ov[id];
        let next;
        if (!want) next = def.off ? { key: "", keycode: "", modifiers: "", off: true } : { key: def.key, keycode: def.keycode, modifiers: def.modifiers, off: false };
        else if (want.off) next = { key: "", keycode: "", modifiers: "", off: true };
        else next = { key: want.key || "", keycode: want.keycode || "", modifiers: want.modifiers || "", off: false };
        const cur = attrCombo(el);
        const curOff = el.hasAttribute("folio-off");
        if (cur.key === next.key && cur.keycode === next.keycode && cur.modifiers === next.modifiers && curOff === next.off) continue;
        for (const [a, v] of [["key", next.key], ["keycode", next.keycode], ["modifiers", next.modifiers]]) {
          if (v) el.setAttribute(a, v); else el.removeAttribute(a);
        }
        el.removeAttribute("data-l10n-id"); // a later translation pass must not put the old key back
        if (next.off) { el.setAttribute("folio-off", "true"); el.setAttribute("disabled", "true"); }
        else { el.removeAttribute("folio-off"); if (def.disabled) el.setAttribute("disabled", def.disabled); else el.removeAttribute("disabled"); }
        const ks = el.closest("keyset");
        if (ks) touched.add(ks);
      }
      for (const ks of touched) ks.replaceWith(ks.cloneNode(true));
      if (touched.size) window.FolioSidebar?.keepKeysReserved?.();
    },

    // Read the defaults once the window has finished starting (key letters come from the translation pass), then apply.
    init() {
      const start = () => {
        // Keys can appear after startup (the developer tools add theirs late), so look again a few times.
        const learn = () => {
          for (const el of this.allKeys()) {
            if (!el.id || this._defaults.has(el.id)) continue;
            this._defaults.set(el.id, { ...attrCombo(el), disabled: el.getAttribute("disabled") });
            if (el.id in FOLIO_DEFAULTS) {
              const d = FOLIO_DEFAULTS[el.id];
              this._defaults.set(el.id, d ? { key: d.key || "", keycode: d.keycode || "", modifiers: d.modifiers || "", disabled: null } : { key: "", keycode: "", modifiers: "", disabled: null, off: true });
            }
          }
          this.apply();
        };
        learn();
        for (const ms of [800, 2500, 6000]) setTimeout(learn, ms);
        const obs = { observe: () => this.apply() };
        Services.prefs.addObserver(PREF, obs);
        window.addEventListener("unload", () => Services.prefs.removeObserver(PREF, obs), { once: true });
      };
      if (typeof gBrowserInit != "undefined" && gBrowserInit.delayedStartupFinished) { start(); return; }
      const topic = "browser-delayed-startup-finished";
      const waiter = { observe: (subject) => {
        if (subject !== window) return;
        Services.obs.removeObserver(waiter, topic);
        start();
      } };
      Services.obs.addObserver(waiter, topic);
    },
  };
  window.FolioKeys = FolioKeys;
  FolioKeys.init();

  // Key popup (Sammy, 2026-11-26): the keys you press with Ctrl/Alt/Super (and F-keys) show as chips in the middle of
  // the window, the same glass card as the space switch, tinted with the space's accent, with what the shortcut does.
  // On by default; Settings > Keyboard Shortcuts switch = folio.keyviz. Nothing shows while a shortcut is being recorded.
  const FolioKeyPop = {
    ORDER: ["Ctrl", "Alt", "Shift", "Super", "Meta", "Win"],
    GLYPHS: { "Left Arrow": "←", "Right Arrow": "→", "Up Arrow": "↑", "Down Arrow": "↓" },
    parts(text) {
      const out = [];
      let cur = "";
      for (const ch of text) { if (ch === "+" && cur) { out.push(cur); cur = ""; } else cur += ch; }
      if (cur) out.push(cur);
      const mods = out.filter((p) => this.ORDER.includes(p)).sort((a, b) => this.ORDER.indexOf(a) - this.ORDER.indexOf(b));
      return [...mods, ...out.filter((p) => !this.ORDER.includes(p))].map((p) => this.GLYPHS[p] || p);
    },
    onKey(e) {
      if (!e.isTrusted || e.repeat || !Services.prefs.getBoolPref("folio.keyviz", true)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d{1,2}$/.test(e.key)) return; // plain typing never shows
      if (document.querySelector("key[folio-suspended]")) return;
      const combo = FolioKeys.captureCombo(e);
      if (!combo) return;
      const hit = FolioKeys.findConflict(combo, null);
      if (hit && /^key_folioSpace/.test(hit.id)) return; // the space switch shows its own card in the same place
      let text = FolioKeys.pretty(combo);
      if (!text) {
        const m = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
        text = [...m, e.key.length === 1 ? e.key.toUpperCase() : e.key].join("+");
      }
      this.show(text, hit?.name || "");
    },
    show(text, name) {
      if (!text) return;
      this._anim?.cancel();
      document.getElementById("folio-key-pop")?.remove();
      const pop = document.createElement("div");
      pop.id = "folio-key-pop";
      const keys = document.createElement("div");
      keys.className = "folio-key-pop-keys";
      for (const p of this.parts(text)) {
        const k = document.createElement("span");
        k.className = "folio-key-chip" + (p.length === 1 ? " one" : "");
        k.textContent = p;
        keys.append(k);
      }
      const label = document.createElement("div");
      label.className = "folio-key-pop-name";
      label.textContent = name;
      pop.append(keys);
      if (name) pop.append(label);
      document.documentElement.append(pop);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setTimeout(() => pop.remove(), 900);
        return;
      }
      const a = pop.animate([
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.86)" },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.2 },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.72 },
        { opacity: 0, transform: "translate(-50%, -50%) scale(1.05)" },
      ], { duration: 1100, easing: "ease-out" });
      a.onfinish = a.oncancel = () => pop.remove();
      this._anim = a;
    },
  };
  window.FolioKeyPop = FolioKeyPop;
  // Bubble phase of the default group: runs before the keyset (system group) handles the key, and sees keys
  // pressed while a page has focus too (the page's unused keys come back to the window).
  window.addEventListener("keydown", (e) => { try { FolioKeyPop.onKey(e); } catch (err) { /* never block a key */ } });
})();
