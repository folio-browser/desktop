/* Folio settings. Left: categories and search. Right: one pane at a time.
   Controls write prefs (the browser window reacts at once) or call the browser window's FolioSidebar. */
const prefs = globalThis.Services?.prefs ?? ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services.prefs;
const SVC = globalThis.Services ?? ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
const wm = SVC.wm;

// See-through window: this page lets the glass show (its own panels turn translucent).
const syncSeeThrough = () => document.documentElement.toggleAttribute("seethrough", prefs.getBoolPref("folio.seethrough", false));
syncSeeThrough();
// Colors: this page follows the current space (its wallpaper's colors, or the space's own color), live.
const applyPalette = () => {
  let p = null;
  try { p = JSON.parse(prefs.getStringPref("folio.ui.palette", "")); } catch (e) { /* default colors */ }
  const st = document.documentElement.style;
  if (p?.accent) st.setProperty("--accent", p.accent); else st.removeProperty("--accent");
  if (p?.base) st.setProperty("--base", p.base); else st.removeProperty("--base");
};
applyPalette();
prefs.addObserver("folio.ui.palette", applyPalette);
window.addEventListener("unload", () => prefs.removeObserver("folio.ui.palette", applyPalette));
prefs.addObserver("folio.seethrough", syncSeeThrough);
window.addEventListener("unload", () => prefs.removeObserver("folio.seethrough", syncSeeThrough));

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {
  look: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  tabs: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 9v-5"/>',
  keys: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8" r="1"/><path d="M8 12h8M9 16h6"/>',
  mods: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  sync: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  privacy: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  passwords: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2"/>',
  appearance: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  downloads: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  tabsbrowsing: '<path d="M5 4l5 16 2.5-6.5L19 11z"/>',
  access: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="7.5" r="1.2"/><path d="M8 10h8M12 10v4l-2.5 4M12 14l2.5 4"/>',
  languages: '<path d="M4 6h10M9 4v2M7 6c.5 3 2.5 5 5 6M13 6c-.5 3-2.5 5-5 6M13 20l4-9 4 9M14.5 17h5"/>',
  perms: '<circle cx="8" cy="8" r="2.5"/><circle cx="16" cy="16" r="2.5"/><path d="M10 8h10M4 16h10"/>',
  perf: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-6"/><circle cx="12" cy="17" r="1"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  ext: '<path d="M10 4h4v3a2 2 0 1 0 0 4v3h-3a2 2 0 1 1-4 0H4v-4a2 2 0 1 0 0-4V4h6z"/>',
};
const EXTERNAL = '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';
// Animated icons (Pulsoicon's): the category icons move when you hover them, and the title icon plays once when its pane opens.
let pulso = null;
const PULSO_NAMES = { look: "palette", tabs: "panel-left", keys: "keyboard", mods: "blocks", sync: "user", search: "search", privacy: "lock",
  passwords: "key-round", appearance: "eye", downloads: "download", tabsbrowsing: "mouse-pointer-2", perf: "gauge", access: "accessibility",
  languages: "languages", perms: "sliders-horizontal", about: "info", ext: "puzzle" };
import("chrome://browser/content/folio-settings/folio-icons.mjs").then((m) => { pulso = m; draw(); }).catch(() => { /* the static icons stay */ });
const icon = (name, cls = "nav-icon", raw) => {
  if (!raw && pulso && PULSO_NAMES[name]) {
    const animated = pulso.makeIcon(document, PULSO_NAMES[name], { size: cls === "pane-icon" ? 24 : 20, strokeWidth: 1.7 });
    if (animated) { animated.classList.add(cls); return animated; }
  }
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = raw || ICONS[name] || "";
  return svg;
};

// The browser window that these settings act on.
const browserWin = () => wm.getMostRecentWindow("navigator:browser");
const folio = () => browserWin()?.FolioSidebar || null;

// ---- Row builders -----------------------------------------------------------------------
// Shown/hidden switch for a browser element. Clearing the user value only shows the element when its default is
// "shown": some are hidden by default (folio.hide.alltabs, folio.hide.sidebartools), and their switch could never
// turn them on. Now the value always matches the switch; a value equal to the default is cleared.
const shownRow = (item) => ({
  kind: "switch", label: item.label, search: item.label,
  get: () => !prefs.getBoolPref("folio.hide." + item.key, false),
  set: (on) => {
    const name = "folio.hide." + item.key;
    let dflt = false;
    try { dflt = SVC.prefs.getDefaultBranch("").getBoolPref(name, false); } catch (e) {}
    if (!on === dflt) prefs.clearUserPref(name); else prefs.setBoolPref(name, !on);
  },
});
const elementsIn = (group) => FOLIO_ELEMENTS.filter(i => i.group === group).map(shownRow);
const prefSwitch = (label, pref, dflt, search) => ({
  kind: "switch", label, search: search || label,
  get: () => prefs.getBoolPref(pref, dflt),
  set: (on) => prefs.setBoolPref(pref, on),
});

// Browser layouts: whole styles, like Zen's (Only Sidebar / Sidebar and Top Toolbar / Collapsed Sidebar).
// Each one is a set of prefs the browser already reads live.
const LAYOUTS = [
  { id: "vertical", name: "Vertical", desc: "A sidebar with the address bar inside it. No top bar." },
  { id: "horizontal", name: "Horizontal", desc: "A top bar across the window, with the sidebar beside the page." },
  { id: "compact", name: "Compact", desc: "The sidebar is hidden. Only the top bar and the page." },
];
const currentLayout = () => {
  if (prefs.getBoolPref("folio.sidebar.hidden", false)) return "compact";
  return prefs.getBoolPref("folio.toolbar.sidebar", false) ? "vertical" : "horizontal";
};
function setLayout(id) {
  prefs.setBoolPref("folio.sidebar.hidden", id === "compact");
  prefs.setBoolPref("folio.toolbar.sidebar", id === "vertical");
  prefs.setBoolPref("folio.toolbar.bottom", false);
}

// Small schematic of each layout, drawn in the palette.
function thumb(id) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 190 120");
  const rect = (x, y, w, h, fill, rx = 4) => {
    const r = document.createElementNS(SVGNS, "rect");
    Object.entries({ x, y, width: w, height: h, rx, fill }).forEach(([k, v]) => r.setAttribute(k, v)); r.style.fill = fill;
    svg.append(r);
  };
  rect(0, 0, 190, 120, "#26242b", 10);
  const side = "#1d1c22", page = "#3a3742", bar = "var(--accent)", dim = "#55515e";
  if (id === "vertical") {
    rect(0, 0, 66, 120, side, 10); rect(8, 8, 50, 9, bar); rect(8, 24, 50, 5, dim); rect(8, 33, 40, 5, dim);
    rect(8, 104, 50, 8, dim, 4);
    rect(72, 10, 110, 100, page, 8);
  } else if (id === "horizontal") {
    rect(0, 0, 190, 16, side, 10); rect(40, 5, 100, 6, bar);
    rect(0, 16, 50, 104, side, 0); rect(8, 24, 34, 5, dim); rect(8, 33, 28, 5, dim);
    rect(58, 22, 124, 90, page, 8);
  } else {
    rect(0, 0, 190, 16, side, 10); rect(40, 5, 100, 6, bar);
    rect(8, 22, 174, 90, page, 8);
  }
  return svg;
}

// ---- Custom blocks (they read and change the browser window's own data) -----------------
function layoutChoices() {
  const wrap = el("div", "choices");
  wrap.setAttribute("role", "radiogroup");
  const draw = () => {
    wrap.replaceChildren();
    const now = currentLayout();
    for (const L of LAYOUTS) {
      const b = el("button", "choice");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(now === L.id));
      b.append(thumb(L.id), el("span", "choice-name", L.name), el("span", "choice-desc", L.desc));
      b.addEventListener("click", () => { setLayout(L.id); draw(); });
      wrap.append(b);
    }
  };
  draw();
  return wrap;
}

function aboutCard() {
  const card = el("div", "body");
  const version = SVC.appinfo?.version || "";
  const head = el("div", "about-head");
  const mark = el("div", "about-mark");
  const words = el("div", "about-words");
  words.append(el("div", "about-name", "Folio"), el("div", "about-tag", "the web, collected"),
    el("div", "about-ver", version ? `Version ${version} · built on Firefox ${version}` : "Built on Firefox"));
  head.append(mark, words);
  card.append(head);
  const open = (label, url) => {
    const b = el("button", "row link", label);
    b.type = "button";
    b.addEventListener("click", () => { const w = browserWin(); w?.gBrowser && (w.gBrowser.selectedTab = w.gBrowser.addTrustedTab(url)); });
    return b;
  };
  card.append(open("Open source licenses", "about:license"), open("Troubleshooting information", "about:support"));
  return card;
}

// Space routing list (folio-routing.js rules) + the space for links opened from other apps.
function routesCard() {
  const F = folio();
  const card = el("div", "body");
  if (!F) { card.append(el("div", "row-note", "Open a Folio window to manage routing.")); return card; }
  const spaces = F.spaces();
  const nameOf = (id) => spaces.find(s => s.id === id)?.name || "(deleted space)";
  const read = () => { try { const a = JSON.parse(prefs.getStringPref("folio.routes", "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const ext = el("div", "row static");
  ext.append(el("span", "row-label", "Links from other apps open in"));
  const sel = document.createElement("select");
  sel.className = "text-field";
  sel.setAttribute("aria-label", "Links from other apps open in");
  const cur = prefs.getStringPref("folio.routes.external", "");
  for (const [v, n] of [["", "The space I'm in"], ...spaces.map(s => [s.id, s.name])]) {
    const o = document.createElement("option"); o.value = v; o.textContent = n; if (v === cur) o.selected = true; sel.append(o);
  }
  sel.addEventListener("change", () => prefs.setStringPref("folio.routes.external", sel.value));
  ext.append(sel);
  card.append(ext);
  const routes = read();
  if (!routes.length) card.append(el("div", "row-note", "No routes yet. Right-click a tab and pick Add route."));
  const how = { contains: "contains", exactly: "is exactly", regex: "matches" };
  routes.forEach((r, i) => {
    const row = el("div", "row static");
    row.append(el("span", "row-label", `Link ${how[r.match] || "contains"} "${r.value}" opens in ${nameOf(r.space)}`));
    const del = el("button", "row-btn danger", "Remove");
    del.type = "button";
    del.addEventListener("click", () => { const list = read(); list.splice(i, 1); prefs.setStringPref("folio.routes", JSON.stringify(list)); row.remove(); });
    row.append(del);
    card.append(row);
  });
  return card;
}

// Custom search presets (FolioBangs reads folio.bangs.custom).
function presetsCard() {
  const card = el("div", "body");
  const read = () => { try { const a = JSON.parse(prefs.getStringPref("folio.bangs.custom", "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const write = (a) => prefs.setStringPref("folio.bangs.custom", JSON.stringify(a));
  const draw = () => {
    card.replaceChildren();
    read().forEach((c, i) => {
      const row = el("div", "row static");
      row.append(el("span", "row-label", `!${c.trigger}  ${c.name || ""}`));
      const del = el("button", "row-btn danger", "Remove");
      del.type = "button";
      del.addEventListener("click", () => { const a = read(); a.splice(i, 1); write(a); draw(); });
      row.append(del);
      card.append(row);
    });
    const add = el("div", "row static preset-add");
    const t = document.createElement("input"); t.className = "text-field"; t.placeholder = "Shortcut"; t.setAttribute("aria-label", "Shortcut");
    const n = document.createElement("input"); n.className = "text-field"; n.placeholder = "Name"; n.setAttribute("aria-label", "Name");
    const u = document.createElement("input"); u.className = "text-field"; u.placeholder = "Link"; u.setAttribute("aria-label", "Link");
    const b = el("button", "row-btn", "Add"); b.type = "button";
    b.addEventListener("click", () => {
      const trigger = t.value.trim().replace(/^!/, "").toLowerCase();
      const url = u.value.trim();
      if (!/^[a-z0-9._-]{1,20}$/.test(trigger)) { t.focus(); t.setAttribute("aria-invalid", "true"); return; }
      if (!/^https?:\/\/.+%s/i.test(url)) { u.focus(); u.setAttribute("aria-invalid", "true"); return; }
      write([...read().filter(c => c.trigger !== trigger), { trigger, name: n.value.trim() || trigger, url }]);
      draw();
    });
    add.append(t, n, u, b);
    card.append(add);
  };
  draw();
  return card;
}

function spacesCard() {
  const F = folio();
  const card = el("div", "body");
  if (!F) { card.append(el("div", "row-note", "Open a Folio window to manage spaces.")); return card; }
  const list = F.spaces();
  for (const s of list) {
    const row = el("div", "row static");
    const name = el("input", "text-field");
    name.type = "text";
    name.value = s.name;
    name.setAttribute("aria-label", "Space name");
    name.addEventListener("change", () => F.renameSpace(s.id, name.value));
    row.append(name);
    if (list.length > 1) {
      const del = el("button", "row-btn danger", "Delete");
      del.type = "button";
      let armed = false;
      del.addEventListener("click", () => {
        if (!armed) { armed = true; del.textContent = "Delete and close its tabs"; setTimeout(() => { armed = false; del.textContent = "Delete"; }, 3000); return; }
        F.deleteSpace(s.id);
        draw();
      });
      row.append(del);
    }
    card.append(row);
  }
  const add = el("button", "row link", "New space");
  add.type = "button";
  add.addEventListener("click", () => { F.openSpaceCreation(); browserWin()?.focus(); });
  card.append(add);
  return card;
}

function essentialsCard() {
  const F = folio();
  const card = el("div", "body");
  if (!F) { card.append(el("div", "row-note", "Open a Folio window to manage Essentials.")); return card; }
  const entries = F.essEntries();
  if (!entries.length) card.append(el("div", "row-note", "No Essentials yet. Pin a tab to add one."));
  entries.forEach((entry, i) => {
    const row = el("div", "row static");
    const host = (() => { try { return new URL(entry.url).hostname.replace(/^www\./, ""); } catch (e) { return entry.url; } })();
    const note = el("span", "row-note essential-url", entry.url);
    note.title = entry.url;
    row.append(el("span", "row-label", host), note);
    const rm = el("button", "row-btn danger", "Remove");
    rm.type = "button";
    rm.addEventListener("click", () => { F.setEssEntries(F.essEntries().filter((_, j) => j !== i)); draw(); });
    row.append(rm);
    card.append(row);
  });
  const count = el("div", "row-note count", `${entries.length} of ${F.MAX_ESSENTIALS}`);
  card.append(count);
  return card;
}

// Live privacy report: what Folio sends out right now, read from the real prefs.
function privacyCard() {
  const card = el("div", "body");
  const yes = (k) => prefs.getBoolPref(k, false);
  const rows = [
    ["Telemetry, studies and crash reports", "Off. Folio sends nothing about how you use it.", !yes("datareporting.healthreport.uploadEnabled") && !yes("datareporting.policy.dataSubmissionEnabled") && !yes("app.shield.optoutstudies.enabled")],
    ["Ads and sponsored content", "Off. No sponsored tiles, no suggestion server.", !yes("browser.newtabpage.activity-stream.showSponsored") && !yes("browser.urlbar.quicksuggest.enabled")],
    ["Search suggestions", "Only the search engine you picked sees what you type, and only once you start typing.", true],
    ["Google Safe Browsing", "Off. It never worked in this build (no API key) and only pinged Google.", !yes("browser.safebrowsing.malware.enabled")],
    ["Location, push and prefetching", "Off. No location lookups, no push server, no connections to sites you have not opened.", !yes("dom.push.enabled") && prefs.getIntPref("network.http.speculative-parallel-limit", 6) === 0],
  ];
  for (const [label, note, ok] of rows) {
    const r = el("div", "row static col");
    const l = el("span", "row-label", (ok ? "\u2713  " : "\u2022  ") + label);
    r.append(l, el("span", "row-note", ok ? note : "Not fully off: check Firefox privacy settings."));
    card.append(r);
  }
  const open = el("button", "row link", "Firefox privacy settings");
  open.type = "button";
  open.addEventListener("click", () => browserWin()?.openTrustedLinkIn("about:preferences#privacy", "tab"));
  card.append(open);
  return card;
}

// ---- Firefox prefs and engines, shown in the Zen-named panes --------------------------------
const boolPref = (label, pref, dflt, search, invert = false) => ({
  kind: "switch", label, search: search || label,
  get: () => invert ? !prefs.getBoolPref(pref, dflt) : prefs.getBoolPref(pref, dflt),
  set: (on) => prefs.setBoolPref(pref, invert ? !on : on),
});
// Radio card: one choice at a time, the chosen one filled.
function radioCard(options, get, set) {
  const card = el("div", "body");
  const draw = () => {
    card.replaceChildren();
    const now = get();
    for (const o of options) {
      const b = el("button", "row");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(now === o.id));
      const label = el("span", "row-label");
      label.append(el("span", null, o.label));
      if (o.desc) label.append(el("span", "row-note block", o.desc));
      b.append(el("span", "check radio"), label);
      b.addEventListener("click", () => { set(o.id); draw(); });
      card.append(b);
    }
  };
  draw();
  return card;
}
function trackingCard() {
  return radioCard(
    [
      { id: "standard", label: "Standard", desc: "Strong, reliable protection that works with most websites." },
      { id: "strict", label: "Strict", desc: "Stronger protection. Some sites may not work." },
    ],
    () => prefs.getStringPref("browser.contentblocking.category", "standard"),
    (id) => prefs.setStringPref("browser.contentblocking.category", id),
  );
}
// Search engine icons (2026-11-26): shipped files for the engines Folio knows, else the disk cache, else Firefox's
// own icon or the site's favicon, fetched once and stored (also handed to the engine itself, so an engine you add gets
// its icon in the address bar too).
const ENGINE_FILES = {
  "Google": "engines/google.png", "Google No AI": "engines/google.png",
  "DuckDuckGo": "engines/duckduckgo.svg", "DuckDuckGo No AI": "engines/duckduckgo.svg",
  "Brave Search": "brave.png", "Mojeek": "engines/mojeek.png", "Kagi": "engines/kagi.png",
  "Startpage": "engines/startpage.svg", "Ecosia": "engines/ecosia.svg", "Qwant": "engines/qwant.svg",
};
const engineIconMemo = new Map();
function engineIcon(e) {
  if (ENGINE_FILES[e.name]) return Promise.resolve("chrome://browser/content/folio-welcome/" + ENGINE_FILES[e.name]);
  if (!engineIconMemo.has(e.id)) engineIconMemo.set(e.id, (async () => {
    let Bangs = null;
    try { Bangs = ChromeUtils.importESModule("resource:///modules/FolioBangs.sys.mjs").FolioBangs; } catch (err) {}
    const key = "engine:" + e.name;
    const stored = await Bangs?.storedIcon?.(key);
    if (stored) return stored;
    let url = null;
    try { url = await e.getIconURL?.(32); } catch (err) {}
    let data = null;
    if (url) {
      if (url.startsWith("data:")) data = url;
      else {
        try {
          // Firefox's engine icons are blob: URLs of the browser window; this page can't read them, the window can.
          const w = browserWin() || window;
          const blob = await (await w.fetch(url)).blob();
          if (/^image\//.test(blob.type)) data = await new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
        } catch (err) { /* keep url */ }
      }
    }
    if (!data && !url) {
      try {
        const host = new URL(e.searchUrlDomain ? "https://" + e.searchUrlDomain : e.getSubmission("x").uri.spec).host;
        data = await Bangs?.iconFor?.(host);
        if (data) { try { await e._setIcon?.(data); } catch (err) { /* built-in engines keep theirs */ } }
      } catch (err) {}
    }
    if (data) Bangs?.storeIcon?.(key, data);
    return data || (url && !url.startsWith("blob:") ? url : null);
  })());
  return engineIconMemo.get(e.id);
}
function searchCard() {
  const card = el("div", "body");
  const note = el("div", "row-note pad", "Loading search engines…");
  card.append(note);
  // The search service is a module of its own (Firefox's preferences pane imports it the same way).
  let engines = null;
  try { engines = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs").SearchService; } catch (e) {}
  if (!engines) { note.textContent = "Search engines are not available here."; return card; }
  Promise.all([engines.getVisibleEngines(), engines.getDefault()]).then(async ([list, def]) => {
    // Every icon is resolved before the list shows, so they are all there at once. Known engines use the icons
    // shipped with Folio (both Googles the same logo); the rest are fetched once and kept on disk (FolioBangs cache).
    const icons = await Promise.all(list.map((e) => Promise.race([engineIcon(e), new Promise((r) => setTimeout(() => r(null), 2500))])));
    card.replaceChildren();
    list.forEach((e, i) => {
      const b = el("button", "row");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(def && def.id === e.id));
      const ic = document.createElement("img"); ic.className = "engine-icon"; ic.alt = "";
      if (icons[i]) ic.src = icons[i];
      else {
        ic.classList.add("pending");
        engineIcon(e).then((u) => { if (u) { ic.src = u; ic.classList.remove("pending"); } });
      }
      b.append(el("span", "check radio"), ic, el("span", "row-label", e.name));
      b.addEventListener("click", async () => {
        await engines.setDefault(e, engines.CHANGE_REASON?.USER || "user");
        card.replaceWith(searchCard());
      });
      card.append(b);
    });
    // Add your own engine (Firefox's own dialog).
    const add = el("button", "row");
    add.type = "button";
    add.append(el("span", "row-label", "Add a search engine…"));
    add.addEventListener("click", () => {
      const w = browserWin();
      const tabBrowser = w?.gBrowser?.getBrowserForContentWindow?.(window) || w?.gBrowser?.selectedBrowser;
      const box = w?.gBrowser?.getTabDialogBox(tabBrowser);
      box?.open("chrome://browser/content/search/addEngine.xhtml", { features: "resizable=no, modal=yes" }, { mode: "NEW" })
        .closedPromise.then(() => card.replaceWith(searchCard()));
    });
    card.append(add);
  }).catch(() => { note.textContent = "Search engines could not be loaded."; });
  return card;
}
// Where downloads go: the folder Firefox really uses (a folder picked in Firefox's settings counts too), and a
// Change… button. With "Ask where to save" on, it is where the save dialog starts.
// Light / Dark / System: the same setting as Firefox's "Website appearance"; the browser frame follows it too.
function schemeCard() {
  const card = el("div", "body seg");
  const PREF = "layout.css.prefers-color-scheme.content-override";
  const opts = [[2, "System"], [1, "Light"], [0, "Dark"]];
  const draw = () => {
    card.replaceChildren();
    const cur = prefs.getIntPref(PREF, 2);
    for (const [v, name] of opts) {
      const b = el("button", "row");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(cur === v));
      b.append(el("span", "check radio"), el("span", "row-label", name));
      b.addEventListener("click", () => { prefs.setIntPref(PREF, v); draw(); });
      card.append(b);
    }
  };
  draw();
  return card;
}

// Quick settings (2026-11-25 settings polish): big tiles for the most-changed things. Each tile shows its current value
// and cycles or toggles on click; the full controls are further down.
function quickCard() {
  const card = el("div", "body quick");
  const tiles = [
    { label: "Look", icon: "◐", get: () => ["Dark", "Light", "System"][prefs.getIntPref("layout.css.prefers-color-scheme.content-override", 2)] || "System",
      next: () => { const v = prefs.getIntPref("layout.css.prefers-color-scheme.content-override", 2); prefs.setIntPref("layout.css.prefers-color-scheme.content-override", v === 2 ? 1 : v === 1 ? 0 : 2); } },
    { label: "Sidebar", icon: "▥", get: () => prefs.getBoolPref("folio.sidebar.right", false) ? "Right" : "Left",
      next: () => prefs.setBoolPref("folio.sidebar.right", !prefs.getBoolPref("folio.sidebar.right", false)) },
    { label: "Tabs", icon: "☰", get: () => prefs.getBoolPref("folio.sidebar.icons", false) ? "Icons only" : "Full",
      next: () => prefs.setBoolPref("folio.sidebar.icons", !prefs.getBoolPref("folio.sidebar.icons", false)) },
    { label: "Clock", icon: "◷", get: () => ({ auto: "Automatic", "12": "12-hour", "24": "24-hour" })[prefs.getStringPref("folio.newtab.clock", "auto")] || "Automatic",
      next: () => { const v = prefs.getStringPref("folio.newtab.clock", "auto"); prefs.setStringPref("folio.newtab.clock", v === "auto" ? "12" : v === "12" ? "24" : "auto"); } },
  ];
  const draw = () => {
    card.replaceChildren();
    for (const t of tiles) {
      const b = el("button", "quick-tile");
      b.type = "button";
      b.append(el("span", "quick-icon", t.icon), el("span", "quick-label", t.label), el("span", "quick-value", t.get()));
      b.addEventListener("click", () => {
        t.next(); draw();
        card.querySelectorAll(".quick-tile")[tiles.indexOf(t)]?.animate([{ transform: "scale(.96)" }, { transform: "scale(1)" }], { duration: 180, easing: "cubic-bezier(.2,0,0,1)" });
      });
      card.append(b);
    }
  };
  draw();
  return card;
}

// New tab clock format (2026-11-25): follow the system, or force 12-hour / 24-hour.
function clockCard() {
  const card = el("div", "body seg");
  const PREF = "folio.newtab.clock";
  const opts = [["auto", "Automatic"], ["12", "12-hour (3:42 PM)"], ["24", "24-hour (15:42)"]];
  const draw = () => {
    card.replaceChildren();
    const cur = prefs.getStringPref(PREF, "auto");
    for (const [v, name] of opts) {
      const b = el("button", "row");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(cur === v));
      b.append(el("span", "check radio"), el("span", "row-label", name));
      b.addEventListener("click", () => { prefs.setStringPref(PREF, v); draw(); });
      card.append(b);
    }
  };
  draw();
  return card;
}

function downloadFolderCard() {
  const card = el("div", "body");
  const note = el("div", "row-note pad", "…");
  const change = el("button", "row link", "Change folder…");
  change.type = "button";
  const draw = async () => {
    try {
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      note.textContent = "Saved to " + (await Downloads.getPreferredDownloadsDirectory());
    } catch (e) { note.textContent = "Downloads folder not found."; }
  };
  change.addEventListener("click", () => {
    const win = browserWin() || window;
    const fp = win.Cc["@mozilla.org/filepicker;1"].createInstance(win.Ci.nsIFilePicker);
    fp.init(win.browsingContext, "Save downloads to", win.Ci.nsIFilePicker.modeGetFolder);
    fp.open((res) => {
      if (res !== win.Ci.nsIFilePicker.returnOK || !fp.file) return;
      SVC.prefs.setComplexValue("browser.download.dir", win.Ci.nsIFile, fp.file);
      SVC.prefs.setIntPref("browser.download.folderList", 2);
      draw();
    });
  });
  card.append(note, change);
  draw();
  return card;
}

// Import from Arc: spaces, folders, pinned tabs and Favorites (window.FolioArc in folio-sidebar.js does the work).
function arcCard() {
  const body = el("div", "body");
  const win = browserWin();
  const A = win?.FolioArc;
  if (!A) { body.append(el("div", "row-note pad", "Open a Folio window to import from Arc.")); return body; }
  const result = el("div", "row-note pad");
  const run = async (path) => {
    try {
      const r = await A.importFrom(path);
      const parts = [[r.spaces, "space"], [r.folders, "folder"], [r.tabs, "tab"], [r.favorites, "favorite"]]
        .filter(([n]) => n).map(([n, w]) => `${n} ${w}${n > 1 ? "s" : ""}`);
      result.textContent = parts.length ? `Imported ${parts.join(", ")} from Arc.` : "Everything from Arc is already here.";
    } catch (e) {
      result.textContent = "That file isn't Arc's sidebar file.";
    }
  };
  const pick = () => {
    const fp = win.Cc["@mozilla.org/filepicker;1"].createInstance(win.Ci.nsIFilePicker);
    fp.init(win.browsingContext, "StorableSidebar.json", win.Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("Arc sidebar", "StorableSidebar.json;*.json");
    fp.open((rv) => { if (rv === win.Ci.nsIFilePicker.returnOK && fp.file) run(fp.file.path); });
  };
  const button = (label, onclick) => { const b = el("button", "row link", label); b.type = "button"; b.addEventListener("click", onclick); return b; };
  A.findFile().then((found) => {
    body.replaceChildren();
    if (found) body.append(button("Import from Arc", () => run(found)), button("Choose another file", pick));
    else body.append(button("Choose Arc's sidebar file", pick));
    body.append(result);
  });
  return body;
}

// ---- Panes: Zen's category names, in Zen's order ------------------------------------------
// Groups are separated in the nav like Zen's (main, Firefox-style, then extensions).
const NAV_GROUPS = [
  ["looks", "tabs", "keys", "mods", "sync", "search", "privacy", "passwords", "appearance", "downloads", "tabsbrowsing", "perf"],
  ["access", "languages", "perms", "about"],
  ["ext"],
];
// A row that opens the matching page in Firefox's own settings.
const externalRow = (label, hash) => ({ kind: "external", label, hash });
const firefoxRows = (...pairs) => pairs.map(([label, hash]) => externalRow(label, hash));
const nothingYet = (text) => () => { const c = el("div", "body"); c.append(el("div", "row-note pad", text)); return c; };

const PANES = [
  { id: "looks", name: "Look and Feel", icon: "look", blocks: [
    { head: "Quick settings", text: "The things people change most, one click each.", custom: quickCard, search: "quick settings light dark sidebar right icons clock zoom" },
    { head: "Browser layout", text: "Where your tabs and the address bar sit.", special: "layout", search: "browser layout address bar sidebar top bottom" },
    { head: "Page size", text: "How big websites look. Bigger only for the sites you choose.", custom: zoomCard, search: "page size zoom scale text bigger smaller 125 percent" },
    { head: "Wallpaper theme", text: "Colors and a blurred sidebar, taken from an image.", custom: themeCard, search: "theme wallpaper colors accent blur" },
    { head: "See-through window", text: "The whole window becomes glass and your desktop shows through, blurred. The sidebar is clearer than the page.", search: "see-through transparent transparency glass blur acrylic mica opacity translucent", rows: [
      prefSwitch("See-through window", "folio.seethrough", false, "see-through transparent glass"),
      { kind: "range", label: "Sidebar opacity", search: "sidebar opacity transparency", min: 0, max: 90, step: 5, unit: "%",
        get: () => prefs.getIntPref("folio.seethrough.sidebar", 8),
        set: (v) => prefs.setIntPref("folio.seethrough.sidebar", v) },
      { kind: "range", label: "Page opacity", search: "page opacity transparency", min: 0, max: 100, step: 5, unit: "%",
        get: () => prefs.getIntPref("folio.seethrough.page", 10),
        set: (v) => prefs.setIntPref("folio.seethrough.page", v) },
      prefSwitch("Tint with the space color", "folio.seethrough.accent", true, "tint space color"),
      ...(navigator.platform.startsWith("Win") ? [{
        kind: "switch", label: "Acrylic blur (off = Mica)", search: "acrylic mica windows blur",
        get: () => prefs.getStringPref("folio.seethrough.material", "acrylic") === "acrylic",
        set: (on) => prefs.setStringPref("folio.seethrough.material", on ? "acrylic" : "mica") }] : []),
    ] },
    { head: "Sidebar", text: "Your tabs, spaces and Essentials.", rows: [
      { kind: "switch", label: "Show sidebar", search: "sidebar show hide",
        get: () => !prefs.getBoolPref("folio.sidebar.hidden", false),
        set: (on) => prefs.setBoolPref("folio.sidebar.hidden", !on) },
      prefSwitch("Icons only", "folio.sidebar.icons", false, "sidebar icons only compact narrow collapsed favicons"),
      prefSwitch("Scroll over the tabs to switch tabs", "folio.sidebar.wheelTabs", false, "scroll wheel switch tabs sidebar mouse"),
      prefSwitch("On the right", "folio.sidebar.right", false, "sidebar right side position left zen"),
      { kind: "range", label: "Width", search: "sidebar width", min: 200, max: 420, step: 10, unit: "px",
        get: () => prefs.getIntPref("folio.sidebar.width", 260),
        set: (v) => prefs.setIntPref("folio.sidebar.width", v) },
      { kind: "switch", label: "Show tool icons", search: "sidebar tool icons",
        get: () => !prefs.getBoolPref("folio.hide.sidebartools", true),
        set: (on) => prefs.setBoolPref("folio.hide.sidebartools", !on) },
      prefSwitch("Address bar at the bottom of the sidebar", "folio.toolbar.sidebarBottom", false, "sidebar bottom address bar"),
    ] },
    { head: "Page card", text: "The frame around the page.", rows: elementsIn("Window") },
    { head: "Toolbar buttons", text: "Hiding a button only removes it from view.", rows: elementsIn("Toolbar") },
    { head: "Address bar buttons", text: "Buttons inside the address bar.", rows: elementsIn("Address bar") },
  ] },
  { id: "tabs", name: "Tab Management", icon: "tabs", blocks: [
    { head: "Spaces", text: "A space is a set of tabs with its own folders.", custom: spacesCard, search: "space spaces rename delete new workspaces" },
    { head: "Space routing", text: "Sites that always open in a certain space, and where links from other apps go. Add a route from a tab's right-click menu.", custom: routesCard, search: "space routing routes rules external links other apps default space" },
    { head: "Essentials", text: "Sites pinned to the top of the sidebar.", custom: essentialsCard, search: "essentials pinned pin remove" },
    { head: "Hibernation", text: "Tabs you leave alone go to sleep and stop using memory. Click one and it wakes up where you left it. Tabs playing sound, in a call, or with unsaved changes never sleep.", search: "hibernate sleep memory ram tabs unload save", rows: [
      prefSwitch("Hibernate tabs I'm not using", "folio.hibernate.enabled", true, "hibernate sleep unload tabs memory"),
      { kind: "range", label: "After", search: "hibernate minutes idle", min: 5, max: 240, step: 5, unit: " min",
        get: () => prefs.getIntPref("folio.hibernate.minutes", 30),
        set: (v) => prefs.setIntPref("folio.hibernate.minutes", v) },
      { kind: "range", label: "Other spaces, after leaving", search: "hibernate spaces other leave grace minutes sleep", min: 0, max: 60, step: 1,
        fmt: (v) => (v === 0 ? "Never" : v + " min"),
        get: () => prefs.getIntPref("folio.hibernate.spaces.minutes", 10),
        set: (v) => prefs.setIntPref("folio.hibernate.spaces.minutes", v) },
      { kind: "note", text: "When you leave a space, its tabs keep running for this long, then go to sleep a few at a time. Coming back sooner reloads nothing. Sites that send you notifications, like WhatsApp, never sleep." },
      prefSwitch("Show memory and CPU when I hover a tab", "folio.tabtip.enabled", true, "hover tab memory cpu"),
      { kind: "note", text: "Right-click a tab to hibernate it, or all the others, right away." },
    ] },
  ] },
  { id: "perf", name: "Performance", icon: "perf", blocks: [
    { head: "RAM limiter", bare: true, custom: () => gxLimiter("ram"), search: "performance memory ram limit limiter guard hibernate usage" },
    { head: "CPU limiter", bare: true, custom: () => gxLimiter("cpu"), search: "performance cpu limit limiter cap processor priority yield usage" },
    { head: "Back and Forward", text: "How many pages Folio keeps ready in memory so Back and Forward are instant. Fewer pages = less memory. Pages beyond that load again when you go back to them.", search: "back forward cache bfcache pages memory", rows: [
      { kind: "range", label: "Pages kept", search: "back forward cache pages", min: 0, max: 8, step: 1, unit: "",
        fmt: (v) => v === 0 ? "None" : v + (v === 1 ? " page" : " pages"),
        get: () => Math.max(0, prefs.getIntPref("browser.sessionhistory.max_total_viewers", 3)),
        set: (v) => prefs.setIntPref("browser.sessionhistory.max_total_viewers", v) },
    ] },
  ] },
  { id: "keys", name: "Keyboard Shortcuts", icon: "keys", blocks: [
    { head: "Show keys as you press them", text: "The keys you press pop up in the middle of the window, in your space's color, with what they do.", search: "show keys keystrokes popup recording screencast overlay", rows: [
      prefSwitch("Show keys as you press them", "folio.keyviz", true, "show keys keystrokes popup"),
    ] },
    { head: "Keyboard Shortcuts", text: "", custom: keysCard,
      get search() { return "keyboard shortcuts keybinds hotkeys keys " + (browserWin()?.FolioKeys?.list().map((r) => r.name).join(" ") || ""); } },
  ] },
  { id: "mods", name: "Mods", icon: "mods", blocks: [
    { head: "Mods", text: "Changes to how Folio looks and works, added from outside.", custom: nothingYet("No mods yet."), search: "mods" },
  ] },
  { id: "sync", name: "Account and sync", icon: "sync", blocks: [
    { head: "Mozilla account and sync", text: "Sign in to sync bookmarks, passwords and tabs between your devices.", rows: firefoxRows(["Account and sync", "sync"]), search: "account sync firefox" },
    { head: "Import from Arc", text: "Your Arc spaces, folders, pinned tabs and Favorites.", custom: arcCard, search: "arc import migrate spaces pinned tabs favorites the browser company" },
  ] },
  { id: "search", name: "Search", icon: "search", blocks: [
    { head: "Default search engine", text: "Used when you search from the address bar.", custom: searchCard, search: "search engine default" },
    { head: "My search shortcuts", text: "Your own bangs. Type !name and your search in the address bar. Put %s in the link where your words go.", custom: presetsCard, search: "search shortcuts presets bangs custom my own g2 prompt" },
    { head: "More search settings", text: "Search shortcuts, suggestions and other engines.", rows: firefoxRows(["Search settings", "search"]), search: "search engine" },
  ] },  { id: "privacy", name: "Privacy and security", icon: "privacy", blocks: [
    { head: "Built-in ad blocker", text: "Folio's own blocker, lighter than uBlock Origin. When it's on, uBlock is switched off; turn it off and uBlock comes back.", search: "ad blocker ads ublock native built-in block trackers", rows: [
      prefSwitch("Use the built-in ad blocker", "folio.blocker.enabled", false, "ad blocker ads native built-in"),
    ] },
    { head: "What leaves your browser", text: "Folio is set up to send nothing to Mozilla.", custom: privacyCard, search: "privacy telemetry mozilla sync security" },
    { head: "What Folio may download", text: "These are the only things that can reach Mozilla. Turn off either one and Folio stops connecting.", search: "security updates extension updates mozilla blocklist revocation download", rows: [
      prefSwitch("Security updates", "folio.safety.updates", true, "security updates revocation blocklist tracker lists mozilla"),
      { kind: "note", text: "Certificate revocation, the add-on blocklist and tracker lists. Folio downloads the lists; nothing about you is sent except your IP address." },
      prefSwitch("Check my extensions for updates", "extensions.update.enabled", true, "extension add-on updates"),
      { kind: "note", text: "Tells addons.mozilla.org which extensions you have installed. Does nothing until you install one." },
    ] },
    { head: "Web protections", text: "Safer by default. Switch one off only if a site you trust breaks.", search: "https only referrer query tracking global privacy control", rows: [
      prefSwitch("HTTPS-only mode", "dom.security.https_only_mode", true, "https only secure connection"),
      prefSwitch("Remove tracking from links (utm_, fbclid...)", "privacy.query_stripping.enabled", true, "query stripping tracking parameters links"),
      { kind: "switch", label: "Hide which page you came from on other sites", search: "referrer trimming origin",
        get: () => prefs.getIntPref("network.http.referer.XOriginTrimmingPolicy", 0) === 2,
        set: (on) => prefs.setIntPref("network.http.referer.XOriginTrimmingPolicy", on ? 2 : 0) },
      prefSwitch("Tell sites not to sell or share my data (Global Privacy Control)", "privacy.globalprivacycontrol.enabled", true, "gpc global privacy control"),
    ] },
    { head: "Tracking protection", text: "Blocks trackers that follow you between sites.", custom: trackingCard, search: "tracking protection standard strict" },
    { head: "More privacy settings", text: "Cookies, site data, certificates and permissions.", rows: firefoxRows(["Privacy and security settings", "privacy"]), search: "security certificates" },
  ] },  { id: "passwords", name: "Passwords and autofill", icon: "passwords", blocks: [
    { head: "Logins", text: "Folio can save the passwords you type.", rows: [
      boolPref("Save logins and passwords", "signon.rememberSignons", true, "passwords logins save"),
    ] },
    { head: "Autofill", text: "Fill in forms from what you saved.", rows: [
      boolPref("Addresses", "extensions.formautofill.addresses.enabled", true, "autofill addresses"),
      boolPref("Payment cards", "extensions.formautofill.creditCards.enabled", true, "autofill cards payment"),
    ] },
    { head: "Saved passwords", text: "See, edit or delete the passwords Folio saved.", rows: firefoxRows(["Passwords and autofill settings", "passwords"]), search: "passwords" },
  ] },  { id: "appearance", name: "Appearance", icon: "appearance", blocks: [
    { head: "Light or dark", text: "Folio and websites that support it follow this: light, dark, or your system.", custom: schemeCard, search: "appearance dark light colors theme mode" },
    { head: "Clock on the new tab", text: "How the time under the logo is written.", custom: clockCard, search: "appearance clock time 12 24 hour am pm new tab format" },
  ] },
  { id: "downloads", name: "Downloads", icon: "downloads", blocks: [
    { head: "Save files to", text: "Where downloads go.", custom: downloadFolderCard, search: "downloads folder save files" },
    { head: "Downloads", text: "What happens when a download starts.", rows: [
      boolPref("Ask where to save files before downloading", "browser.download.useDownloadDir", true, "ask save files", true),
    ] },
  ] },
  { id: "tabsbrowsing", name: "Tabs and browsing", icon: "tabsbrowsing", blocks: [
    { head: "Startup", text: "What Folio opens when it starts.", rows: [
      { kind: "switch", label: "Open previous windows and tabs", search: "startup previous session restore",
        get: () => prefs.getIntPref("browser.startup.page", 1) === 3,
        set: (on) => prefs.setIntPref("browser.startup.page", on ? 3 : 1) },
    ] },
    { head: "Tabs", text: "How tabs open, close and look.", rows: [
      { sub: "Opening" },
      { kind: "switch", label: "Open links in tabs instead of new windows", search: "links tabs windows",
        get: () => prefs.getIntPref("browser.link.open_newwindow", 3) === 3,
        set: (on) => prefs.setIntPref("browser.link.open_newwindow", on ? 3 : 2) },
      boolPref("Switch to new tabs right away", "browser.tabs.loadDivertedInBackground", false, "switch new tab immediately", true),
      { sub: "Closing" },
      boolPref("Warn when closing multiple tabs", "browser.tabs.warnOnClose", false, "warn close tabs"),
      { sub: "Tab rows" },
      ...elementsIn("Tabs"),
    ] },
    { head: "More browsing settings", text: "Scrolling, autoscroll, spell check and more.", rows: firefoxRows(["Tabs and browsing settings", "tabs-browsing"]), search: "browsing tabs" },
  ] },
  { id: "access", name: "Accessibility", icon: "access", blocks: [
    { head: "Accessibility", text: "Text size, zoom and how pages are shown.", rows: firefoxRows(["Accessibility settings", "accessibility"]), search: "accessibility zoom text size" },
  ] },
  { id: "languages", name: "Languages", icon: "languages", blocks: [
    { head: "Languages", text: "The language Folio and websites use.", rows: firefoxRows(["Language settings", "languages"]), search: "languages translation" },
  ] },
  { id: "perms", name: "Permissions and data", icon: "perms", blocks: [
    { head: "Permissions and data", text: "Camera, microphone, location and site data.", rows: firefoxRows(["Permissions and site data", "permissions-data"]), search: "permissions site data cookies" },
  ] },
  { id: "about", name: "About Folio", icon: "about", blocks: [
    { head: "About Folio", text: "Version and licenses.", custom: aboutCard, search: "about version firefox" },
  ] },
  { id: "ext", name: "Extensions and themes", icon: "ext", blocks: [
    { head: "Extensions and themes", text: "Add-ons and themes from addons.mozilla.org.", rows: [externalRow("Extensions and themes", "addons")], search: "extensions themes addons" },
  ] },
];

// ---- Rendering --------------------------------------------------------------------------
// A row that opens the matching page in Firefox's own settings (Zen's "Related settings" style).
function externalLink(r) {
  const b = el("button", "row");
  b.type = "button";
  b.append(el("span", "row-label", r.label), icon(null, "ext-icon", EXTERNAL));
  b.addEventListener("click", () => {
    const url = r.hash === "addons" ? "about:addons" : "about:preferences#" + r.hash;
    browserWin()?.openTrustedLinkIn(url, "tab");
  });
  return b;
}

function switchRow(r) {
  const b = el("button", "row");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", String(r.get()));
  b.append(el("span", "check"), el("span", "row-label", r.label));
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    r.set(next);
    b.setAttribute("aria-checked", String(next));
  });
  return b;
}

function rangeRow(r) {
  const wrap = el("div", "range-row");
  const input = el("input");
  input.type = "range";
  input.min = r.min; input.max = r.max; input.step = r.step;
  input.value = r.get();
  input.setAttribute("aria-label", r.label);
  const show = (v) => r.fmt ? r.fmt(Number(v)) : v + r.unit;
  const value = el("span", "range-value", show(input.value));
  input.addEventListener("input", () => { value.textContent = show(input.value); r.set(Number(input.value)); });
  wrap.append(el("span", "row-label", r.label), input, value);
  return wrap;
}

function renderBlock(block, query) {
  const rows = block.rows ? block.rows.filter(r => !query || (r.search || r.label || r.text || "").toLowerCase().includes(query) || block.head.toLowerCase().includes(query)) : null;
  if (query && !block.head.toLowerCase().includes(query) && !(block.search || "").includes(query) && !(rows && rows.length)) {
    if (!block.special && !block.custom) return null;
    if (block.custom && !(block.search || "").includes(query)) return null;
    if (block.special && !(block.search || "").includes(query)) return null;
  }
  if (block.bare) return block.custom();
  const sec = el("section", "card block");
  const head = el("div", "card-head");
  if (block.icon) head.append(icon(block.icon, "card-icon"));
  head.append(el("h2", null, block.head));
  sec.append(head);
  if (block.text) sec.append(el("p", "card-desc", block.text));
  if (block.special === "layout") { sec.append(layoutChoices()); return sec; }
  if (block.custom) { sec.append(block.custom()); return sec; }
  if (!rows || !rows.length) return null;
  const body = el("div", "body");
  for (const sub of block.subheads || []) { /* placed by the rows below */ }
  for (const r of rows) {
    if (r.sub) { body.append(el("div", "subhead", r.sub)); continue; }
    if (r.kind === "note") { body.append(el("div", "row-note pad", r.text)); continue; }
    body.append(r.kind === "range" ? rangeRow(r) : r.kind === "external" ? externalLink(r) : switchRow(r));
  }
  sec.append(body);
  return sec;
}

let current = PANES[0].id;

// Page size: the global default zoom (Firefox's own setting). 125% is Folio's recommended default.
function zoomCard() {
  const card = el("div", "body seg");
  const win = browserWin();
  const Z = win?.FolioZoom;
  if (!Z) { card.append(el("div", "row-note pad", "Open a Folio window to change the page size.")); return card; }
  const VALUES = [1, 1.1, 1.25, 1.5, 1.75, 2];
  const draw = async () => {
    const now = Math.round((await Z.get()) * 100);
    card.replaceChildren();
    for (const v of VALUES) {
      const pct = Math.round(v * 100);
      const b = el("button", "row");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(now === pct));
      b.append(el("span", "check radio"), el("span", "row-label", pct + "%" + ""));
      b.addEventListener("click", async () => { await Z.set(v); draw(); });
      card.append(b);
    }
    // Sites with their own size
    // Only sites whose size differs from what they would have anyway: their own default (WhatsApp 125%), else the global
    // size (2026-11-26, Sammy: search.brave.com at 100% with a 100% default is not "its own size").
    const globalNow = await Z.get();
    const sites = (await Z.listSites()).filter(st => Math.abs(st.value - (Z.siteDefault?.(st.host) ?? globalNow)) > 0.001);
    const box = el("div", "zoom-sites");
    box.append(el("div", "subhead", "Sites with their own size"));
    for (const st of sites) {
      const row = el("div", "row static");
      row.append(el("span", "row-label", st.host));
      const sel = document.createElement("select"); sel.className = "text-field";
      for (const v of VALUES) { const o = document.createElement("option"); o.value = v; o.textContent = Math.round(v * 100) + "%"; if (Math.abs(v - st.value) < 0.001) o.selected = true; sel.append(o); }
      if (!VALUES.some(v => Math.abs(v - st.value) < 0.001)) { const o = document.createElement("option"); o.value = st.value; o.textContent = Math.round(st.value * 100) + "%"; o.selected = true; sel.prepend(o); }
      sel.addEventListener("change", async () => { await Z.setSite(st.host, Number(sel.value)); draw(); });
      const own = Z.siteDefault?.(st.host);
      const del = el("button", "row-btn", "Reset"); del.type = "button";
      del.title = own ? `Back to this site's default size (${Math.round(own * 100)}%)` : "Back to the default size";
      // Reset = the size the site has by default: its own default if it has one, else no saved size at all.
      del.addEventListener("click", async () => { if (own) await Z.setSite(st.host, own); else await Z.removeSite(st.host); draw(); });
      row.append(sel, del);
      box.append(row);
    }
    const add = el("div", "row static");
    const host = document.createElement("input"); host.className = "text-field"; host.placeholder = "Site"; host.setAttribute("aria-label", "Site");
    const sel = document.createElement("select"); sel.className = "text-field";
    for (const v of VALUES) { const o = document.createElement("option"); o.value = v; o.textContent = Math.round(v * 100) + "%"; if (v === 1.25) o.selected = true; sel.append(o); }
    const b = el("button", "row-btn", "Add"); b.type = "button";
    b.addEventListener("click", async () => {
      let h = host.value.trim().toLowerCase();
      try { h = new URL(/^[a-z]+:\/\//.test(h) ? h : "https://" + h).host; } catch (e) { h = ""; }
      if (!h) { host.setAttribute("aria-invalid", "true"); host.focus(); return; }
      await Z.setSite(h, Number(sel.value)); draw();
    });
    add.append(host, sel, b);
    box.append(add);
    card.append(box);
  };
  draw();
  return card;
}

// Wallpaper theme: pick an image, and Folio takes its colors and blurs it behind the sidebar.
function themeCard() {
  const body = el("div", "body");
  const win = browserWin();
  const current = prefs.getStringPref("folio.theme.wallpaper.path", "");
  const preview = el("div", "wallpaper-preview");
  if (current && win?.FolioTheme) win.FolioTheme.urlForSaved().then(u => { if (u) preview.style.backgroundImage = `url("${u}")`; });
  const row = el("div", "row static");
  const file = el("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f || !win?.FolioTheme) return;
    await win.FolioTheme.setWallpaper(f);
    draw();
  });
  const pick = el("button", "row-btn", current ? "Change image…" : "Choose image…");
  pick.type = "button";
  pick.addEventListener("click", () => file.click());
  row.append(pick);
  if (current) {
    const clear = el("button", "row-btn danger", "Remove");
    clear.type = "button";
    clear.addEventListener("click", () => { win?.FolioTheme?.clearWallpaper(); draw(); });
    row.append(clear);
  }
  const note = el("div", "row-note pad", current
    ? "This is the wallpaper of the current space. Colors and the blurred sidebar come from this image."
    : "Pick any image for the current space. Folio takes its colors from it.");
  body.append(preview, row, note, file);
  return body;
}
// Keyboard Shortcuts: every shortcut of the browser, searchable. Click one, press the new keys (Esc cancels,
// Backspace clears). Taken combinations ask before replacing. The work is done by FolioKeys in the browser window.
// A shortcut as key chips: "Ctrl+Shift+C" -> [Ctrl] [Shift] [C]. Arrow names become arrows.
const KEY_GLYPHS = { "Left Arrow": "←", "Right Arrow": "→", "Up Arrow": "↑", "Down Arrow": "↓", "Left": "←", "Right": "→", "Up": "↑", "Down": "↓" };
function comboParts(text) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "+" && cur) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const ORDER = ["Ctrl", "Alt", "Shift", "Super", "Meta", "Win"];
  const mods = parts.filter((p) => ORDER.includes(p)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...mods, ...parts.filter((p) => !ORDER.includes(p))].map((p) => KEY_GLYPHS[p] || p);
}
function comboEl(text) {
  const wrap = el("span", "combo");
  for (const p of comboParts(text)) wrap.append(el("kbd", "kbd" + (p.length === 1 ? " one" : ""), p));
  return wrap;
}
const KEY_ACT_ICONS = {
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  clear: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
function keyAct(kind, title) {
  const b = el("button", "key-act");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const m of KEY_ACT_ICONS[kind].matchAll(/<path d="([^"]+)"\/>/g)) {
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", m[1]);
    svg.append(path);
  }
  b.append(svg);
  return b;
}
function keysCard() {
  const K = browserWin()?.FolioKeys;
  const body = el("div", "body keys");
  if (!K) { body.append(el("div", "row-note pad", "Shortcuts can be changed from a browser window.")); return body; }
  const search = el("input", "text-field keys-search");
  search.type = "search";
  search.placeholder = "Search shortcuts";
  const resetAll = el("button", "row-btn danger", "Reset all");
  resetAll.type = "button";
  let armed = null;
  resetAll.addEventListener("click", () => {
    if (!armed) {
      resetAll.textContent = "Click again to reset all";
      armed = setTimeout(() => { armed = null; resetAll.textContent = "Reset all"; }, 3000);
      return;
    }
    clearTimeout(armed); armed = null; resetAll.textContent = "Reset all";
    offerUndo(null, "All shortcuts reset");
    K.resetAll(); draw();
  });
  // Undo for anything that throws away a choice (one remove, or Reset all): the overrides as they were, for 10 s.
  let undo = null;
  const offerUndo = (id, text) => {
    clearTimeout(undo?.timer);
    undo = { id, text, snap: K.overrides(), timer: setTimeout(() => { undo = null; draw(); }, 10000) };
  };
  const undoBar = () => {
    const bar = el("div", "keys-undo");
    bar.setAttribute("role", "status");
    const b = el("button", "row-btn", "Undo"); b.type = "button";
    b.addEventListener("click", () => { const snap = undo.snap; clearTimeout(undo.timer); undo = null; K.setOverrides(snap); draw(); });
    bar.append(el("span", "", undo.text), b);
    return bar;
  };
  const top = el("div", "keys-top");
  top.append(search, resetAll);
  const list = el("div", "keys-list");
  body.append(top, list);

  let stopRecording = null;
  const cancel = () => { if (stopRecording) stopRecording(); };
  const record = (r, row, cap) => {
    cancel();
    K.suspend();
    cap.replaceChildren(el("span", "keycap-hint", "Press keys"));
    cap.classList.add("recording");
    row.classList.add("recording");
    const msg = el("div", "keys-msg");
    row.append(msg);
    let done = false;
    // The modifiers held so far show as chips while recording.
    const showHeld = (e) => {
      const held = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
      cap.replaceChildren(held.length ? comboEl(held.join("+") + "+") : el("span", "keycap-hint", "Press keys"));
    };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      if (["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"].includes(e.key)) { showHeld(e); return; }
      const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
      if (e.key === "Escape" && plain) { finish(); return; }
      // Del and Backspace are keys like any other here (2026-11-26, Sammy: re-recording Del as Del deleted the shortcut).
      // Removing a shortcut is only the explicit remove button, which can be undone.
      const c = K.captureCombo(e);
      if (!c) return;
      if (c.printable && c.bare) { msg.textContent = "Add Ctrl or Alt so it doesn't clash with typing."; return; }
      const clash = K.findConflict(c, r.id);
      if (!clash) { K.resume(); K.set(r.id, c); finish(); return; }
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onUp, true);
      cap.replaceChildren(comboEl(K.pretty(c)));
      msg.replaceChildren();
      const say = el("span", "keys-msg-text");
      if (clash.internal) {
        say.append(el("b", "", clash.name), " already uses it");
        msg.append(say);
        const ok = el("button", "row-btn", "OK"); ok.type = "button"; ok.addEventListener("click", finish);
        msg.append(ok);
        return;
      }
      say.append(el("b", "", clash.name), " already uses it");
      msg.append(say);
      const rep = el("button", "row-btn primary", "Replace"); rep.type = "button";
      rep.addEventListener("click", () => { K.resume(); K.set(clash.id, null); K.set(r.id, c); finish(); });
      const no = el("button", "row-btn", "Cancel"); no.type = "button"; no.addEventListener("click", finish);
      msg.append(rep, no);
    };
    const onUp = (e) => { if (!done && !msg.firstChild) showHeld(e); };
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", finish);
      K.resume();
      stopRecording = null;
      draw();
    };
    stopRecording = finish;
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", finish);
  };

  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = K.list().filter((r) => !q || `${r.name} ${K.GROUPS[r.group]} ${r.text} ${r.defaultText}`.toLowerCase().includes(q));
    list.replaceChildren();
    if (undo && undo.id === null) list.append(undoBar());
    if (!rows.length) { list.append(el("div", "row-note pad", "No shortcut matches.")); return; }
    let group = -1;
    for (const r of rows) {
      if (r.group !== group) { group = r.group; list.append(el("div", "subhead", K.GROUPS[group])); }
      const row = el("div", "keyrow");
      const cap = el("button", "keycap" + (r.text ? "" : " empty"));
      cap.type = "button";
      cap.append(r.text ? comboEl(r.text) : el("span", "keycap-hint", "None"));
      cap.addEventListener("click", () => record(r, row, cap));
      const acts = el("div", "key-acts");
      if (r.changed) {
        const reset = keyAct("reset", r.defaultText ? `Back to ${r.defaultText}` : "Back to no shortcut");
        reset.addEventListener("click", () => { K.reset(r.id); draw(); });
        acts.append(reset);
      }
      if (r.text) {
        const clear = keyAct("clear", "Remove this shortcut");
        clear.addEventListener("click", () => { offerUndo(r.id, `${r.name}: shortcut removed`); K.set(r.id, null); draw(); });
        acts.append(clear);
      }
      // Order: name, the key (what you click to change it), then the small actions at the far end, away from the key.
      row.append(el("span", "keyrow-name", r.name), cap, acts);
      if (r.changed) row.classList.add("changed");
      list.append(row);
      if (undo && undo.id === r.id) list.append(undoBar());
    }
  }
  search.addEventListener("input", () => { cancel(); draw(); });
  // Another window or the pref changed: show it.
  const obs = { observe: () => { if (!stopRecording) draw(); } };
  Services.prefs.addObserver("folio.keys.overrides", obs);
  window.addEventListener("unload", () => { Services.prefs.removeObserver("folio.keys.overrides", obs); K.resume(); }, { once: true });
  draw();
  return body;
}
// Opera GX-style limiters (Sammy, 2026-11-26, from GX Control): a 270-degree gauge with the live number in the middle,
// tick marks and a marker at the limit, an on/off switch, a slider with the value riding on its thumb over a MIN/MAX
// ruler, and a switch row at the bottom. Everything in the space's accent. They drive Folio's own limits
// (folio.limit.memoryMB / cpuPercent / lowPriority, applied live by FolioLimits in the browser window).
const SVGN = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(SVGN, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const GX_ICONS = {
  ram: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 17v2M11 17v2M15 17v2M7 10v4M11 10v4M15 10v4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
};
function gxGauge() {
  // 270 degrees, from bottom-left (135deg) clockwise to bottom-right (405deg).
  const C = 110, R = 84, START = 135, SWEEP = 270;
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (r, a0, a1) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const svg = svgEl("svg", { viewBox: "0 0 220 220", class: "gx-gauge", "aria-hidden": "true" });
  svg.append(svgEl("path", { d: arc(100, START, START + SWEEP), class: "gx-ring" }));
  const ticks = svgEl("g", { class: "gx-ticks" });
  for (let i = 0; i <= 40; i++) {
    const a = START + SWEEP * i / 40, major = i % 10 === 0;
    const [x0, y0] = pt(major ? 64 : 67, a), [x1, y1] = pt(73, a);
    ticks.append(svgEl("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? "major" : "" }));
  }
  svg.append(ticks);
  svg.append(svgEl("path", { d: arc(R, START, START + SWEEP), class: "gx-track" }));
  const LEN = 2 * Math.PI * R * SWEEP / 360;
  const val = svgEl("path", { d: arc(R, START, START + SWEEP), class: "gx-value", "stroke-dasharray": `${LEN} ${LEN}`, "stroke-dashoffset": String(LEN) });
  svg.append(val);
  const lim = svgEl("g", { class: "gx-limit" });
  const limLine = svgEl("line", {});
  const limDot = svgEl("circle", { r: "4.5" });
  lim.append(limLine, limDot);
  svg.append(lim);
  const labels = [0, 0.5, 1].map((f) => {
    const [x, y] = pt(f === 0.5 ? 112 : 104, START + SWEEP * f);
    const t = svgEl("text", { x: x.toFixed(1), y: (y + 4).toFixed(1), class: "gx-scale", "text-anchor": "middle" });
    svg.append(t);
    return t;
  });
  const num = svgEl("text", { x: "110", y: "116", class: "gx-num", "text-anchor": "middle" });
  const unit = svgEl("text", { x: "110", y: "142", class: "gx-unit", "text-anchor": "middle" });
  svg.append(num, unit);
  return {
    svg,
    set(value, max, limit, scale, n, u) {
      const f = Math.max(0, Math.min(1, value / max));
      val.setAttribute("stroke-dashoffset", String(LEN * (1 - f)));
      lim.classList.toggle("off", !limit);
      if (limit) {
        const a = START + SWEEP * Math.min(1, limit / max);
        const [x0, y0] = pt(R - 9, a), [x1, y1] = pt(R + 9, a), [dx, dy] = pt(100, a);
        limLine.setAttribute("x1", x0); limLine.setAttribute("y1", y0); limLine.setAttribute("x2", x1); limLine.setAttribute("y2", y1);
        limDot.setAttribute("cx", dx); limDot.setAttribute("cy", dy);
      }
      svg.classList.toggle("over", !!limit && value >= limit * 0.85);
      labels.forEach((t, i) => { t.textContent = scale[i]; });
      num.textContent = n;
      unit.textContent = u;
    },
  };
}
function gxSwitch(on, onChange, label) {
  const b = el("button", "gx-switch");
  b.type = "button";
  b.setAttribute("role", "switch");
  b.setAttribute("aria-label", label);
  const set = (v) => b.setAttribute("aria-checked", String(v));
  set(on);
  b.addEventListener("click", () => { const v = b.getAttribute("aria-checked") !== "true"; set(v); onChange(v); });
  b.folioSet = set;
  return b;
}
function gxLimiter(kind) {
  const ram = kind === "ram";
  const card = el("section", "gx-card");
  card.dataset.kind = kind;
  const head = el("div", "gx-head");
  const ic = svgEl("svg", { viewBox: "0 0 24 24", class: "gx-head-icon", "aria-hidden": "true" });
  for (const m of GX_ICONS[kind].matchAll(/<(rect|path)([^>]*)\/>/g)) {
    const n = svgEl(m[1]);
    for (const a of m[2].matchAll(/(\w[\w-]*)="([^"]*)"/g)) n.setAttribute(a[1], a[2]);
    ic.append(n);
  }
  const title = el("div", "gx-title-wrap");
  title.append(el("h2", "gx-title", ram ? "RAM limiter" : "CPU limiter"), el("p", "gx-sub", ram ? "Limit how much RAM Folio can use" : "Limit how much CPU Folio can use"));
  const PREF = ram ? "folio.limit.memoryMB" : "folio.limit.cpuPercent";
  const LAST = PREF + ".last";
  const totalGB = Math.max(2, Math.round((Services.sysinfo.getProperty("memsize") || 8 * 1024 ** 3) / 1024 ** 3));
  const maxGB = Math.min(32, totalGB);
  const cur = () => prefs.getIntPref(PREF, 0);
  const last = () => prefs.getIntPref(LAST, ram ? 4096 : 50);
  const sw = gxSwitch(cur() > 0, (on) => {
    if (on) prefs.setIntPref(PREF, last());
    else { if (cur() > 0) prefs.setIntPref(LAST, cur()); prefs.setIntPref(PREF, 0); }
    sync();
  }, ram ? "RAM limiter" : "CPU limiter");
  head.append(ic, title, sw);
  const gauge = gxGauge();
  const gwrap = el("div", "gx-gauge-wrap");
  gwrap.append(gauge.svg);

  // Slider: GB in 0.5 steps (RAM) or 5% steps (CPU); the value sits on the thumb.
  const sl = el("div", "gx-slider");
  const lab = el("div", "gx-slider-label", ram ? "Memory limit (GB)" : "Processor limit (%)");
  const track = el("div", "gx-range-wrap");
  const range = el("input", "gx-range");
  range.type = "range";
  if (ram) { range.min = "1"; range.max = String(maxGB); range.step = "0.5"; } else { range.min = "5"; range.max = "100"; range.step = "5"; }
  const bubble = el("span", "gx-bubble");
  track.append(range, bubble);
  const ruler = el("div", "gx-ruler");
  ruler.append(el("span", "", "MIN"), el("span", "gx-ruler-ticks"), el("span", "", "MAX"));
  sl.append(lab, track, ruler);
  const showRange = () => {
    const v = Number(range.value);
    const p = (v - Number(range.min)) / (Number(range.max) - Number(range.min));
    track.style.setProperty("--p", String(p));
    bubble.textContent = ram ? v.toFixed(1) : String(v);
  };
  range.addEventListener("input", () => {
    showRange();
    const v = ram ? Math.round(Number(range.value) * 1024) : Number(range.value);
    prefs.setIntPref(LAST, v);
    prefs.setIntPref(PREF, v);
    sw.folioSet(true);
    sync();
  });

  // Bottom row: RAM = what the guard did; CPU = yield to other apps (Folio's own "low priority").
  const foot = el("div", "gx-foot");
  let note = null;
  if (ram) {
    const t = el("div", "gx-foot-text");
    t.append(el("div", "gx-foot-title", "Sleeping tabs"));
    note = el("div", "gx-foot-note", "Near the limit, the tabs you use least go to sleep first.");
    t.append(note);
    foot.append(t);
  } else {
    const t = el("div", "gx-foot-text");
    t.append(el("div", "gx-foot-title", "Yield to other apps"), el("div", "gx-foot-note", "When the computer is busy, Folio steps back."));
    foot.append(t, gxSwitch(prefs.getBoolPref("folio.limit.lowPriority", false), (on) => prefs.setBoolPref("folio.limit.lowPriority", on), "Yield to other apps"));
  }
  card.append(head, gwrap, sl, foot);

  let usage = 0; // bytes (RAM) or percent (CPU)
  let lastCpu = null;
  function sync() {
    const lim = cur();
    card.toggleAttribute("off", lim === 0);
    if (document.activeElement !== range) {
      range.value = String(ram ? (lim || last()) / 1024 : (lim || last()));
      showRange();
    }
    if (ram) {
      const gb = usage / 1024 ** 3;
      const big = gb >= 1 ? gb.toFixed(1) : String(Math.round(usage / 1024 ** 2));
      gauge.set(gb, maxGB, lim / 1024, ["0", String(maxGB / 2), String(maxGB)], big, gb >= 1 ? "GB" : "MB");
    } else {
      gauge.set(usage, 100, lim, ["0", "50", "100"], String(Math.round(usage)), "%");
    }
  }
  const tick = async () => {
    if (!card.isConnected && tick.started) { clearInterval(timer); prefs.removeObserver(PREF, sync); return; }
    tick.started = true;
    const win = browserWin();
    try {
      if (ram) {
        if (win?.FolioTabs) usage = await win.FolioTabs.totalBytes();
        const g = win?.FolioLimits?.lastGuard;
        if (note && g) note.textContent = `Last time: ${g.count} tab${g.count > 1 ? "s" : ""} went to sleep, ${Math.max(0, Math.round((Date.now() - g.time) / 60000))} min ago.`;
      } else {
        const info = await ChromeUtils.requestProcInfo();
        const total = (info.cpuTime || 0) + (info.children || []).reduce((s, c) => s + (c.cpuTime || 0), 0);
        const now = performance.now();
        if (lastCpu) {
          const cores = Math.max(1, navigator.hardwareConcurrency || 1);
          usage = Math.min(100, Math.max(0, (total - lastCpu.total) / 1e6 / (now - lastCpu.now) / cores * 100));
        }
        lastCpu = { total, now };
      }
    } catch (e) { /* busy */ }
    sync();
  };
  const timer = setInterval(tick, 1500);
  prefs.addObserver(PREF, sync);
  window.addEventListener("unload", () => { clearInterval(timer); prefs.removeObserver(PREF, sync); }, { once: true });
  sync();
  tick();
  return card;
}
// Live readout for the Performance pane.
const mbText = (bytes) => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(1) + " GB" : Math.round(bytes / 1024 ** 2) + " MB";
function perfCard() {
  const card = el("div", "body");
  const row = el("div", "row static col");
  const l = el("span", "row-label", "Reading...");
  const note = el("span", "row-note", "");
  row.append(l, note);
  card.append(row);
  let first = true;
  const tick = async () => {
    // Stop once the card has been taken off the page (the first call happens before it is added).
    if (!first && !card.isConnected) { clearInterval(id); return; }
    first = false;
    const win = browserWin();
    if (!win?.FolioTabs || !win?.FolioLimits) return;
    try {
      const b = await win.FolioTabs.totalBytes();
      const lim = prefs.getIntPref("folio.limit.memoryMB", 0);
      const unit = await win.FolioLimits.unit();
      l.textContent = `Folio is using ${mbText(b)} right now` + (lim ? ` of your ${mbText(lim * 1048576)} limit` : "");
      const g = win.FolioLimits.lastGuard;
      note.textContent = (unit ? "The system holds Folio to your limits (started from the Folio launcher)." : "Not started from the Folio launcher: the memory guard works, the system limits do not.")
        + (g ? ` Last guard: put ${g.count} tab${g.count > 1 ? "s" : ""} to sleep ${Math.max(0, Math.round((Date.now() - g.time) / 60000))} min ago.` : "");
    } catch (e) { /* window busy */ }
  };
  const id = setInterval(tick, 2000);
  tick();
  return card;
}

function draw() {
  const query = document.getElementById("search").value.trim().toLowerCase();
  const navRoot = document.getElementById("nav-items");
  const root = document.getElementById("panes");
  const empty = document.getElementById("empty");
  navRoot.replaceChildren();
  root.replaceChildren();
  empty.hidden = true;

  NAV_GROUPS.forEach((ids, gi) => {
    if (gi > 0) navRoot.append(el("div", "nav-sep"));
    for (const id of ids) {
      const pane = PANES.find(p => p.id === id);
      const b = el("button", "nav-item");
      b.type = "button";
      b.dataset.pane = pane.id;
      const tile = el("span", "nav-tile");
      tile.append(icon(pane.icon));
      b.append(tile, el("span", "nav-label", pane.name));
      b.title = pane.name; // very narrow windows show only the icons
      b.addEventListener("pointerenter", () => b.querySelector(".folio-pulso")?.folioPlay?.());
      if (!query && pane.id === current) {
        b.setAttribute("aria-current", "page");
        requestAnimationFrame(() => b.scrollIntoView({ block: "nearest", inline: "nearest" })); // narrow: the tab row scrolls to it
      }
      b.addEventListener("click", () => { current = pane.id; document.getElementById("search").value = ""; draw(); });
      navRoot.append(b);
    }
  });

  const shown = query ? PANES : PANES.filter(p => p.id === current);
  let any = false;
  for (const pane of shown) {
    const sec = el("div", "pane");
    const title = el("h1", "pane-title");
    title.append(icon(pane.icon, "pane-icon"), el("span", null, pane.name));
    setTimeout(() => title.querySelector(".folio-pulso")?.folioPlay?.(), 320);
    sec.append(title);
    let paneAny = false;
    for (const block of pane.blocks) {
      const g = renderBlock(block, query);
      if (g) { sec.append(g); paneAny = true; }
    }
    if (paneAny || !query) { root.append(sec); any = any || paneAny; }
  }
  empty.hidden = any || !query;
}

document.getElementById("search").addEventListener("input", draw);
document.getElementById("reset").addEventListener("click", () => {
  for (const item of FOLIO_ELEMENTS) prefs.clearUserPref("folio.hide." + item.key);
  for (const p of ["folio.sidebar.hidden", "folio.sidebar.width", "folio.toolbar.sidebar", "folio.toolbar.bottom", "folio.toolbar.sidebarBottom"]) prefs.clearUserPref(p);
  draw();
});

draw();
