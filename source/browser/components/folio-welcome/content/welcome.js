/* Folio first-run tour. Motion values follow Zen's welcome (MPL-2.0). */

const START_PAGE = "about:home";
const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
const Cc = globalThis.Cc ?? Components.classes;
const Ci = globalThis.Ci ?? Components.interfaces;

function load(url, pick) {
  try { return pick(ChromeUtils.importESModule(url)); }
  catch (e) { console.error("folio-welcome: could not load " + url, e); return null; }
}
const MigrationUtils = load("moz-src:///browser/components/migration/MigrationUtils.sys.mjs", m => m.MigrationUtils);
const SearchService = load("moz-src:///toolkit/components/search/SearchService.sys.mjs", m => m.SearchService);

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ---- Motion -----------------------------------------------------------------

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// A damped spring as a CSS linear() easing, so Web Animations can play Zen-style springs.
function spring(bounce, visual) {
  const zeta = 1 - bounce, w = (2 * Math.PI) / visual;
  const wd = w * Math.sqrt(Math.max(1 - zeta * zeta, 0.0001));
  const total = visual * 2.2, n = 48, pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total;
    const v = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
    pts.push(v.toFixed(4));
  }
  pts[n] = "1";
  return { easing: "linear(" + pts.join(", ") + ")", duration: total * 1000 };
}

function play(nodes, frames, { delay = 0, stagger = 0, easing = "ease-out", duration = 300 } = {}) {
  const list = nodes instanceof Element ? [nodes] : [...nodes];
  return Promise.all(list.map((node, i) =>
    node.animate(frames, {
      duration: reduced ? 1 : duration,
      delay: reduced ? 0 : delay + i * stagger,
      easing, fill: "both",
    }).finished.catch(() => {})
  ));
}

const SPRING_TEXT = spring(0.4, 0.3);   // sidebar text entering
const SPRING_TITLE = spring(0.3, 0.45); // intro letters
const SPRING_PAGE = spring(0.35, 0.35); // option rows

// ---- Stage 1: the title builds letter by letter -------------------------------

async function intro() {
  const title = $("title");
  for (const [text, cls] of [["Welcome to Folio", "line-1"], ["the web, collected", "line-2"]]) {
    const line = el("span", cls);
    for (const ch of text) {
      if (ch === " ") { line.append(" "); continue; }
      line.append(el("span", "char", ch));
    }
    title.append(line);
  }
  const chars = title.querySelectorAll(".char");
  await play(chars, [{ opacity: 0, transform: "translateY(50px)" }, { opacity: 1, transform: "none" }],
    { delay: 800, stagger: 35, ...SPRING_TITLE });
  const go = $("go");
  go.addEventListener("click", async () => {
    await play([...chars, go], [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px)" }],
      { stagger: 12, duration: 300, easing: "ease-in" });
    $("start").remove();
    startSteps();
  }, { once: true });
  play(go, [{ opacity: 0, transform: "translateY(20px)", filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
    { delay: 100, ...spring(0.35, 0.4) });
  go.focus();
}

// ---- Building blocks --------------------------------------------------------------

function letters(node, text) {
  node.replaceChildren();
  node.setAttribute("aria-label", text);
  for (const ch of text) {
    if (ch === " ") { node.append(" "); continue; }
    node.append(el("span", "char", ch));
  }
  return node.querySelectorAll(".char");
}

function tile({ name, logo, glyph, meta, checked, onPick, group, badge, label }) {
  const t = el("button", "tile");
  t.type = "button";
  t.setAttribute("role", "radio");
  t.setAttribute("aria-checked", String(!!checked));
  if (label) t.setAttribute("aria-label", label);
  t.append(el("span", "tick"));
  // A badge ("No AI") sits on the logo's corner like an app badge, so it never crowds the name or the tick.
  const holder = badge ? el("span", "tile-logo-wrap") : t;
  if (logo) {
    const img = el("img", "tile-logo"); img.alt = ""; img.src = logo;
    img.onerror = () => img.replaceWith(el("span", "tile-glyph", (glyph || name).charAt(0)));
    holder.append(img);
  } else {
    holder.append(el("span", "tile-glyph", glyph || name.charAt(0)));
  }
  if (badge) { holder.append(el("span", "tile-badge", badge)); t.append(holder); }
  t.append(el("span", "tile-name", name));
  if (meta) t.append(meta);
  t.addEventListener("click", () => {
    group.querySelectorAll(".tile").forEach(x => x.setAttribute("aria-checked", "false"));
    t.setAttribute("aria-checked", "true");
    onPick?.();
  });
  return t;
}

function popIn(nodes, delay = 0) {
  return play(nodes, [{ opacity: 0, transform: "translateY(24px) scale(0.94)" }, { opacity: 1, transform: "none" }],
    { delay, stagger: 45, ...SPRING_PAGE });
}

function note(msg) { $("step-note").textContent = msg || ""; }

// ---- Import -----------------------------------------------------------------

const RESTORE = [
  { type: "BOOKMARKS", label: "Bookmarks", on: true },
  { type: "HISTORY", label: "History", on: true },
  { type: "PASSWORDS", label: "Saved logins", on: true },
  { type: "FORMDATA", label: "Form data", on: false },
  { type: "COOKIES", label: "Cookies", on: false },
  { type: "PAYMENT_METHODS", label: "Payment cards", on: false },
];
const RESTORE_NOTE = {
  BOOKMARKS: "Your saved sites.",
  HISTORY: "Pages you visited, so the address bar knows you.",
  PASSWORDS: "Your logins. They stay on this computer, nowhere else.",
  FORMDATA: "Addresses and past searches. Handy, but you might not need it.",
  COOKIES: "Keeps you signed in. Also brings the trackers along, so it starts off.",
  PAYMENT_METHODS: "Saved cards. Off unless you really want them here.",
};

function prettyName(key) {
  const names = { "chromium-edge": "Edge", "chromium-360se": "360 Browser", firefox: "Firefox", "firefox-other": "Firefox", zen: "Zen", librewolf: "LibreWolf", arc: "Arc" };
  return names[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

async function installedSources() {
  const found = [];
  if (!MigrationUtils) return found;
  for (const key of MigrationUtils.availableMigratorKeys) {
    if (key === "internal-testing") continue;
    try {
      const m = await MigrationUtils.getMigrator(key);
      if (!m || !(await m.isSourceAvailable())) continue; // only browsers really installed here
      const profiles = await m.getSourceProfiles();
      const profile = profiles?.[0] ?? null;
      const bits = await m.getMigrateData(profile);
      found.push({ key, migrator: m, profile, bits, icon: m.constructor.brandImage });
    } catch (e) { /* skip browsers that fail to load */ }
  }
  try { found.push(...(await geckoSources())); } catch (e) { console.error("folio-welcome: gecko sources", e); }
  try { const arc = await arcSource(); if (arc) found.push(arc); } catch (e) { console.error("folio-welcome: arc", e); }
  return found;
}

// ---- Sources Firefox's importer doesn't know ---------------------------------------------------
// A custom source: { key, name, icon, custom: { types: [{ type, label, note, on }], run(picks) } }.
// Gecko browsers (Firefox, Zen, LibreWolf): Firefox only imports between its OWN profiles, so Folio reads the other
// browser's places database itself: bookmarks (into a "From <name>" folder) and history (with visit dates). Logins are
// encrypted with that browser's own key: not brought (yet).
const Sqlite = load("resource://gre/modules/Sqlite.sys.mjs", m => m.Sqlite);
const PlacesUtils = load("resource://gre/modules/PlacesUtils.sys.mjs", m => m.PlacesUtils);
const GECKO = [
  { key: "firefox-other", name: "Firefox", icon: "file:///usr/share/icons/hicolor/256x256/apps/firefox.png",
    linux: [".config/mozilla/firefox", ".mozilla/firefox"], win: ["Mozilla/Firefox"], mac: ["Firefox"] },
  { key: "zen", name: "Zen", icon: "",
    linux: [".config/zen", ".zen"], win: ["zen"], mac: ["zen"] },
  { key: "librewolf", name: "LibreWolf", icon: "",
    linux: [".config/librewolf/librewolf", ".librewolf"], win: ["librewolf"], mac: ["librewolf"] },
];
async function geckoProfile(root) {
  const ini = PathUtils.join(root, "profiles.ini");
  if (!(await IOUtils.exists(ini))) return null;
  const text = await IOUtils.readUTF8(ini);
  const sections = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^\[(.+)\]$/);
    if (h) { cur = { name: h[1] }; sections.push(cur); continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && cur) cur[kv[1].trim()] = kv[2].trim();
  }
  // The profile the installed browser really uses (Install section), then Default=1, then any with data.
  const paths = [
    ...sections.filter(x => x.name.startsWith("Install") && x.Default).map(x => x.Default),
    ...sections.filter(x => x.Path && x.Default === "1").map(x => x.Path),
    ...sections.filter(x => x.Path).map(x => x.Path),
  ];
  const own = PathUtils.normalize(PathUtils.profileDir);
  for (const rel of paths) {
    const dir = rel.startsWith("/") || /^[A-Za-z]:/.test(rel) ? rel : PathUtils.join(root, ...rel.split("/"));
    if (PathUtils.normalize(dir) === own) continue; // never "import" Folio into itself
    if (await IOUtils.exists(PathUtils.join(dir, "places.sqlite"))) return dir;
  }
  return null;
}
async function geckoSources() {
  if (!Sqlite || !PlacesUtils) return [];
  const os = AppConstants.platform;
  const base = os === "win" ? Services.dirsvc.get("AppData", Ci.nsIFile).path
    : os === "macosx" ? PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, "Library", "Application Support")
    : Services.dirsvc.get("Home", Ci.nsIFile).path;
  const out = [];
  for (const g of GECKO) {
    let dir = null;
    for (const rel of g[os === "macosx" ? "mac" : os === "win" ? "win" : "linux"] || []) {
      dir = await geckoProfile(PathUtils.join(base, ...rel.split("/"))).catch(() => null);
      if (dir) break;
    }
    if (!dir) continue;
    out.push({ key: g.key, name: g.name, icon: g.icon, custom: {
      types: [
        { type: "BOOKMARKS", label: "Bookmarks", note: RESTORE_NOTE.BOOKMARKS, on: true },
        { type: "HISTORY", label: "History", note: RESTORE_NOTE.HISTORY, on: true },
      ],
      run: (picks) => importGecko(g.name, dir, picks),
    } });
  }
  return out;
}
async function importGecko(name, dir, picks) {
  // Copy first: the other browser may be running and holding the database.
  const tmp = PathUtils.join(PathUtils.tempDir, "folio-import-" + Date.now());
  await IOUtils.makeDirectory(tmp);
  try {
    for (const f of ["places.sqlite", "places.sqlite-wal"]) {
      const src = PathUtils.join(dir, f);
      if (await IOUtils.exists(src)) await IOUtils.copy(src, PathUtils.join(tmp, f));
    }
    const db = await Sqlite.openConnection({ path: PathUtils.join(tmp, "places.sqlite"), readOnly: true });
    try {
      if (picks.has("BOOKMARKS")) {
        const rows = await db.execute(`SELECT b.id, b.parent, b.type, b.title, b.position, p.url, pb.guid AS parentGuid
          FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk LEFT JOIN moz_bookmarks pb ON pb.id = b.parent
          ORDER BY b.parent, b.position`);
        const all = rows.map(r => ({ id: r.getResultByName("id"), parent: r.getResultByName("parent"), type: r.getResultByName("type"),
          title: r.getResultByName("title") || "", url: r.getResultByName("url"), parentGuid: r.getResultByName("parentGuid") }));
        const kids = new Map();
        for (const b of all) { if (!kids.has(b.parent)) kids.set(b.parent, []); kids.get(b.parent).push(b); }
        const tree = (id) => (kids.get(id) || []).map(b => {
          if (b.type === 1 && b.url && /^(https?|ftp|file):/i.test(b.url)) return { url: b.url, title: b.title || b.url };
          if (b.type === 2) { const c = tree(b.id); return c.length ? { title: b.title || "Folder", type: PlacesUtils.bookmarks.TYPE_FOLDER, children: c } : null; }
          return null;
        }).filter(Boolean);
        const ROOTS = { toolbar_____: "Bookmarks toolbar", menu________: "Bookmarks menu", unfiled_____: "Other bookmarks", mobile______: "Mobile bookmarks" };
        const children = [];
        const rootRows = await db.execute("SELECT id, guid FROM moz_bookmarks WHERE guid IN ('toolbar_____','menu________','unfiled_____','mobile______')");
        for (const r of rootRows) {
          const c = tree(r.getResultByName("id"));
          if (c.length) children.push({ title: ROOTS[r.getResultByName("guid")], type: PlacesUtils.bookmarks.TYPE_FOLDER, children: c });
        }
        if (children.length) {
          await PlacesUtils.bookmarks.insertTree({ guid: PlacesUtils.bookmarks.menuGuid,
            children: [{ title: "From " + name, type: PlacesUtils.bookmarks.TYPE_FOLDER, children }] });
        }
      }
      if (picks.has("HISTORY")) {
        const rows = await db.execute(`SELECT url, title, last_visit_date FROM moz_places
          WHERE last_visit_date IS NOT NULL AND hidden = 0 AND url LIKE :web ORDER BY last_visit_date DESC LIMIT 20000`, { web: "http%" });
        const pages = rows.map(r => ({ url: r.getResultByName("url"), title: r.getResultByName("title") || undefined,
          visits: [{ date: new Date(Math.floor(r.getResultByName("last_visit_date") / 1000)), transition: PlacesUtils.history.TRANSITIONS.LINK }] }))
          .filter(p => { try { new URL(p.url); return true; } catch (e) { return false; } });
        for (let i = 0; i < pages.length; i += 500) await PlacesUtils.history.insertMany(pages.slice(i, i + 500));
      }
    } finally { await db.close(); }
  } finally { await IOUtils.remove(tmp, { recursive: true, ignoreAbsent: true }); }
}

// Arc (Windows / macOS): spaces, folders, pinned tabs and Favorites, through the window's FolioArc (folio-sidebar.js).
async function arcSource() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const A = win?.FolioArc;
  if (!A) return null;
  const path = await A.findFile();
  if (!path) return null;
  return { key: "arc", name: "Arc", icon: "", custom: {
    types: [{ type: "ARC", label: "Spaces, folders and pinned tabs", note: "Your Arc sidebar, rebuilt as Folio spaces. Pinned tabs wait asleep until you open them.", on: true }],
    run: () => A.importFrom(path),
  } };
}

// Several browsers can be picked; each one gets its own row of what to bring.
const importState = { picked: new Map() }; // src -> Set of resource types
const chosen = { brought: [], search: null, isDefault: null };
const FOLIO_LOGO = "chrome://browser/content/folio-welcome/folio.png";

async function renderImport(box) {
  importState.picked = new Map();
  const bring = el("div"); bring.id = "bring";
  box.after(bring);
  const fresh = el("button", "tile");
  fresh.type = "button";
  fresh.setAttribute("aria-checked", "true");
  fresh.append(el("span", "tick"), el("span", "tile-glyph", "+"), el("span", "tile-name", "Start fresh"));
  box.append(fresh);

  const found = MigrationUtils ? await installedSources() : [];
  const tiles = new Map();
  const sync = () => {
    fresh.setAttribute("aria-checked", String(importState.picked.size === 0));
    for (const [src, t] of tiles) t.setAttribute("aria-checked", String(importState.picked.has(src)));
    drawBring(bring, found);
  };
  fresh.addEventListener("click", () => { importState.picked.clear(); note(""); sync(); });
  for (const src of found) {
    const t = el("button", "tile");
    t.type = "button";
    t.setAttribute("role", "checkbox");
    t.setAttribute("aria-checked", "false");
    const img = el("img", "tile-logo"); img.alt = ""; img.src = src.icon;
    img.onerror = () => img.replaceWith(el("span", "tile-glyph", prettyName(src.key).charAt(0)));
    t.append(el("span", "tick"), img, el("span", "tile-name", prettyName(src.key)));
    t.addEventListener("click", () => {
      if (importState.picked.has(src)) importState.picked.delete(src);
      else importState.picked.set(src, new Set(src.custom ? src.custom.types.filter(r => r.on).map(r => r.type)
        : RESTORE.filter(r => r.on && (src.bits & MigrationUtils.resourceTypes[r.type])).map(r => r.type)));
      note(importState.picked.size > 1 ? "Bringing from " + importState.picked.size + " browsers. Pick what comes from each." : "");
      sync();
    });
    tiles.set(src, t);
    box.append(t);
  }
  popIn(box.children);
  if (!found.length) note("No other browsers here to bring things from.");
}

// One row per picked browser: its logo and name, then its pills.
function drawBring(bring, found) {
  const before = new Set([...bring.children].map(r => r.dataset.key));
  bring.replaceChildren();
  for (const src of found) {
    const picks = importState.picked.get(src);
    if (!picks) continue;
    const row = el("div", "bring-row");
    row.dataset.key = src.key;
    const from = el("span", "bring-from");
    const img = el("img"); img.alt = ""; img.src = src.icon;
    from.append(img, prettyName(src.key));
    row.append(from);
    for (const r of (src.custom ? src.custom.types : RESTORE)) {
      if (!src.custom && !(src.bits & MigrationUtils.resourceTypes[r.type])) continue; // that browser has none of it
      const p = el("button", "pill");
      p.type = "button";
      p.append(el("span", "dot"), r.label);
      p.setAttribute("aria-pressed", String(picks.has(r.type)));
      p.addEventListener("click", () => {
        picks.has(r.type) ? picks.delete(r.type) : picks.add(r.type);
        p.setAttribute("aria-pressed", String(picks.has(r.type)));
        note(r.note || RESTORE_NOTE[r.type]);
      });
      p.addEventListener("mouseenter", () => note(r.note || RESTORE_NOTE[r.type]));
      row.append(p);
    }
    bring.append(row);
    if (!before.has(src.key)) popIn(row.children); // only animate rows that just appeared
  }
}

async function commitImport() {
  chosen.brought = [];
  for (const [src, picks] of importState.picked) {
    if (!picks.size) continue;
    note("Bringing things over from " + prettyName(src.key) + "…");
    try {
      if (src.custom) await src.custom.run(picks);
      else {
        let mask = 0;
        for (const t of picks) mask |= MigrationUtils.resourceTypes[t];
        await src.migrator.migrate(mask, false, src.profile, () => {});
      }
      chosen.brought.push({ name: prettyName(src.key), logo: src.icon });
    } catch (e) {
      note(prettyName(src.key) + " didn't work: " + e.message);
      return false;
    }
  }
  return true;
}

// ---- Search -----------------------------------------------------------------

const SHIELD_PATH = {
  private: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  some: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M12 8v5M12 16v.5"/>',
  tracks: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M5 19L19 5"/>',
  unrated: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17v.5"/>',
};
const SHIELD_LABEL = { private: "Private", some: "Some privacy", tracks: "Tracks you", unrated: "Not rated" };
// Ratings and hover texts, checked against each engine's own privacy pages (2026-11-24). Rank = order in the tour:
// the private ones first (Brave, our default, on top), then "some privacy", then the ones that track you.
const ENGINES = {
  "brave search": { cat: "private", rank: 0, note: "Runs on its own index, so your searches aren't quietly handed to Google or Bing. No profile on you, no ads chasing you around the web. Our pick. It does plug Brave things now and then, nobody's perfect." },
  "duckduckgo no ai": { cat: "private", rank: 1, note: "DuckDuckGo with every AI bit switched off: no AI answers, no chat, and AI-made images filtered out of results. Just links, the way search worked before everything learned to talk." },
  "duckduckgo": { cat: "private", rank: 2, note: "Doesn't track you or build a profile, and its AI answers are private too. A lot of the results come from Bing, but Bing never finds out it was you asking." },
  "mojeek": { cat: "private", rank: 3, note: "A small UK engine with its own index, built from scratch, and it hasn't tracked anyone since 2006. Results can be a little quirky, but every one of them is its own, not Google's or Bing's." },
  "kagi": { cat: "private", rank: 4, note: "No ads, no tracking, and results good enough that people happily pay for them. That's the catch: it's a subscription, so you'll need an account before your first search." },
  "startpage": { cat: "private", rank: 5, note: "Google's results without Google knowing who asked: Startpage fetches them for you. Worth knowing: an ad-tech company has owned most of it since 2019. So far it has kept its word." },
  "ecosia": { cat: "some", rank: 40, note: "Spends its ad money planting trees, millions of them so far. It's building its own European index with Qwant, but many results still come from Google and Bing, so your searches travel a bit." },
  "qwant": { cat: "some", rank: 41, note: "French, privacy-minded, and building its own European index with Ecosia. Good intentions, but for now a lot of its results still come from Microsoft." },
  "perplexity": { cat: "tracks", rank: 85, note: "Answers your question with AI and cites its sources instead of handing you ten links. The price: it keeps your questions, can train its AI on them, and shares activity with ad partners." },
  "bing": { cat: "tracks", rank: 90, note: "Microsoft's engine, with Copilot answers baked in. It would very much like to get to know you. Like, really get to know you." },
  "google no ai": { cat: "tracks", rank: 91, note: "Google's results with the AI Overview cut out: just the classic list of links. Same Google underneath, though. The AI is gone, the tracking isn't." },
  "google": { cat: "tracks", rank: 92, note: "The biggest index on the planet, with AI Overviews on top. It's free because you're the product: every search adds to what Google knows about you." },
};
// Engines Folio adds itself (policies.json) get no icon from Firefox, so the tour ships them (also used by folio-sidebar.js).
const ENGINE_ICONS = {
  "Brave Search": "chrome://browser/content/folio-welcome/brave.png",
  "DuckDuckGo No AI": "chrome://browser/content/folio-welcome/engines/duckduckgo.svg",
  "Google No AI": "chrome://browser/content/folio-welcome/engines/google.png",
  "Google": "chrome://browser/content/folio-welcome/engines/google.png", // Firefox's own is a blurry 16 px .ico at tile size
  "Mojeek": "chrome://browser/content/folio-welcome/engines/mojeek.png",
  "Kagi": "chrome://browser/content/folio-welcome/engines/kagi.png",
  "Startpage": "chrome://browser/content/folio-welcome/engines/startpage.svg",
  "Ecosia": "chrome://browser/content/folio-welcome/engines/ecosia.svg",
  "Qwant": "chrome://browser/content/folio-welcome/engines/qwant.svg",
};
function engineInfo(name) {
  return ENGINES[name.toLowerCase()] ?? { cat: "unrated", rank: 50, note: "Haven't checked this one, so no promises either way." };
}
function shieldMeta(cat) {
  const m = el("span", "tile-meta");
  m.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SHIELD_PATH[cat] + "</svg>";
  m.append(SHIELD_LABEL[cat]);
  return m;
}

async function renderSearch(box) {
  box.classList.add("engines");
  if (!SearchService) { note("Search engines aren't available in this build."); return; }
  let engines = [], current = null;
  try {
    engines = await SearchService.getVisibleEngines();
    current = await SearchService.getDefault();
  } catch (e) { note("Couldn't load search engines: " + e.message); return; }
  const list = engines
    .filter(e => !/wikipedia|ebay/i.test(e.name))
    .sort((a, b) => engineInfo(a.name).rank - engineInfo(b.name).rank || a.name.localeCompare(b.name));
  for (const engine of list) {
    const info = engineInfo(engine.name);
    // Engines added by policy (Brave, the No AI ones, Mojeek...) have no icon of their own, so the tour ships them.
    const logo = ENGINE_ICONS[engine.name] || (await engine.getIconURL(64).catch(() => null)) || null;
    const picked = current && engine.name === current.name;
    if (picked) chosen.search = { name: engine.name.replace(/ Search$/, ""), logo };
    // "DuckDuckGo No AI" would wrap to two lines and push its logo out of line with the row: the tile shows
    // "DuckDuckGo" with a small "No AI" badge in its corner instead (screen readers still get the full name).
    const noAI = / No AI$/.test(engine.name);
    const t = tile({
      name: engine.name.replace(/ Search$/, "").replace(/ No AI$/, ""), logo, glyph: engine.name, meta: shieldMeta(info.cat),
      badge: noAI ? "No AI" : null, label: engine.name,
      checked: picked, group: box,
      onPick: async () => {
        note(info.note);
        chosen.search = { name: engine.name.replace(/ Search$/, ""), logo };
        try { await SearchService.setDefault(engine, SearchService.CHANGE_REASON.USER); }
        catch (e) { note("Couldn't switch to " + engine.name + "."); }
      },
    });
    t.addEventListener("mouseenter", () => note(info.note));
    t.addEventListener("mouseleave", () => {
      const sel = list.find(e => e.name === box.querySelector('.tile[aria-checked="true"]')?.dataset.engine);
      note(sel ? engineInfo(sel.name).note : "");
    });
    t.dataset.engine = engine.name;
    if (picked) note(info.note);
    box.append(t);
  }
  popIn(box.children);
}

// ---- Default browser ------------------------------------------------------------

const ICON = {
  chat: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  doc: '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  later: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};
function svgIcon(name, size = 28) {
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
}

let makeDefault = true;
function renderDefault(box) {
  makeDefault = true;
  box.classList.add("default");
  const flow = el("div", "flow");
  const apps = el("div", "flow-apps");
  for (const k of ["chat", "mail", "doc"]) { const i = el("span", "flow-app"); i.innerHTML = svgIcon(k); apps.append(i); }
  const dots = el("div", "flow-dots");
  for (let n = 0; n < 5; n++) dots.append(el("span"));
  const logo = el("img", "flow-logo"); logo.src = FOLIO_LOGO; logo.alt = "Folio";
  flow.append(apps, dots, logo);

  const sw = el("button", "switch");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.append(el("span", "switch-label", "Open my links in Folio"), el("span", "switch-track"));
  const yesNote = "Links from your chats, mail and everything else open right here.";
  const noNote = "No pressure. Flip it any time in Settings.";
  const set = (on) => {
    makeDefault = on;
    sw.setAttribute("aria-checked", String(on));
    flow.toggleAttribute("off", !on);
    note(on ? yesNote : noNote);
  };
  sw.addEventListener("click", () => set(!makeDefault));
  set(true);
  box.append(flow, sw);
  popIn(box.children);
}
function commitDefault() {
  chosen.isDefault = makeDefault;
  if (!makeDefault) return true;
  try {
    Cc["@mozilla.org/shell/service;1"].getService(Ci.nsIShellService).setDefaultBrowser(false);
  } catch (e) { /* Settings, then Default browser, still works */ }
  return true;
}

// ---- Done: a recap of what you chose ------------------------------------------------

function recapTile(label, name, logo, glyph, icon) {
  const t = el("div", "tile recap");
  if (icon) {
    const g = el("span", "tile-glyph"); g.innerHTML = svgIcon(icon, 30); t.append(g);
  } else if (logo) {
    const img = el("img", "tile-logo"); img.alt = ""; img.src = logo;
    img.onerror = () => img.replaceWith(el("span", "tile-glyph", (glyph || name).charAt(0)));
    t.append(img);
  } else {
    t.append(el("span", "tile-glyph", glyph || name.charAt(0)));
  }
  t.append(el("span", "tile-meta", label), el("span", "tile-name", name));
  return t;
}

// Brought from one browser: its logo. From several: their logos side by side.
function broughtTile() {
  const list = chosen.brought;
  if (!list.length) return recapTile("Started", "Fresh", null, "+");
  if (list.length === 1) return recapTile("Brought from", list[0].name, list[0].logo);
  const t = el("div", "tile recap");
  const logos = el("span", "recap-logos");
  for (const b of list.slice(0, 3)) { const i = el("img"); i.alt = ""; i.src = b.logo; logos.append(i); }
  const name = list.length === 2 ? list[0].name + " + " + list[1].name : list.length + " browsers";
  t.append(logos, el("span", "tile-meta", "Brought from"), el("span", "tile-name", name));
  return t;
}

// Layout: the three whole styles from Settings > Look and Feel (same prefs, same names). Vertical is Folio's default.
const LAYOUTS = [
  { id: "vertical", name: "Vertical", meta: "Sidebar, no top bar" },
  { id: "horizontal", name: "Horizontal", meta: "Top bar + sidebar" },
  { id: "compact", name: "Compact", meta: "Just the page" },
];
function currentLayout() {
  if (Services.prefs.getBoolPref("folio.sidebar.hidden", false)) return "compact";
  return Services.prefs.getBoolPref("folio.toolbar.sidebar", true) ? "vertical" : "horizontal";
}
function setLayout(id) {
  Services.prefs.setBoolPref("folio.sidebar.hidden", id === "compact");
  Services.prefs.setBoolPref("folio.toolbar.sidebar", id === "vertical");
  Services.prefs.setBoolPref("folio.toolbar.bottom", false);
}
function layoutThumb(id) {
  // Literal colors: the page's CSP blocks inline style attributes, and SVG fill="" attributes can't use var().
  const side = "#1d1c22", page = "#3a3742", bar = "#ce5caa", dim = "#55515e";
  const r = (x, y, w, h, f, rx = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}"/>`;
  let body = r(0, 0, 190, 120, "#26242b", 10);
  if (id === "vertical") body += r(0, 0, 66, 120, side, 10) + r(8, 8, 50, 9, bar) + r(8, 24, 50, 5, dim) + r(8, 33, 40, 5, dim) + r(8, 104, 50, 8, dim) + r(72, 10, 110, 100, page, 8);
  else if (id === "horizontal") body += r(0, 0, 190, 16, side, 10) + r(40, 5, 100, 6, bar) + r(0, 16, 50, 104, side, 0) + r(8, 24, 34, 5, dim) + r(8, 33, 28, 5, dim) + r(58, 22, 124, 90, page, 8);
  else body += r(0, 0, 190, 16, side, 10) + r(40, 5, 100, 6, bar) + r(8, 22, 174, 90, page, 8);
  const wrap = el("span", "layout-thumb");
  wrap.innerHTML = `<svg viewBox="0 0 190 120" aria-hidden="true">${body}</svg>`;
  return wrap;
}
function renderLayout(box) {
  box.classList.add("layouts");
  box.setAttribute("role", "radiogroup");
  const now = currentLayout();
  for (const L of LAYOUTS) {
    const t = tile({ name: L.name, meta: el("span", "tile-meta", L.meta), checked: now === L.id, group: box,
      onPick: () => { setLayout(L.id); chosen.layout = L; } });
    t.classList.add("layout");
    t.querySelector(".tile-glyph, .tile-logo")?.replaceWith(layoutThumb(L.id));
    box.append(t);
  }
  chosen.layout = LAYOUTS.find(L => L.id === now);
  popIn(box.children);
}

function renderDone(box) {
  box.classList.add("done");
  const logo = el("img", "done-logo"); logo.src = FOLIO_LOGO; logo.alt = "Folio";
  $("step-hero").append(logo);
  const row = el("div", "recap-row");
  row.append(
    broughtTile(),
    recapTile("Searching with", chosen.search?.name ?? "Your pick", chosen.search?.logo, "S"),
    (() => { const t = recapTile("Laid out", (chosen.layout ?? LAYOUTS[0]).name, null, "L");
             t.querySelector(".tile-glyph")?.replaceWith(layoutThumb((chosen.layout ?? LAYOUTS[0]).id)); t.classList.add("layout"); return t; })(),
    chosen.isDefault === false
      ? recapTile("Your links open in", "Your old browser", null, null, "later")
      : recapTile("Your links open in", "Folio", null, null, "link"),
  );
  box.append(row);
  play(logo, [{ opacity: 0, transform: "scale(0.6) rotate(-8deg)" }, { opacity: 1, transform: "none" }], { delay: 150, ...spring(0.45, 0.55) });
  popIn(row.children, 450);
}

// ---- What reaches Mozilla: say it plainly, and let them switch it off -----------------

const PREFS = globalThis.Services?.prefs;
const MOZ_ITEMS = [
  {
    name: "Sync",
    what: "Keeps your bookmarks and logins the same on your other devices. Only if you sign in, and it's encrypted so Mozilla can't read it.",
  },
  {
    name: "Extension updates",
    what: "Keeps your extensions up to date. To check for updates, Folio tells Mozilla which extensions you have.",
    prefs: ["extensions.update.enabled", "extensions.update.autoUpdateDefault"],
  },
  {
    name: "Security blocklists",
    what: "Stops fake websites and known malware from getting in. Folio only downloads the list, nothing about you is sent.",
    keep: true,
    prefs: ["extensions.blocklist.enabled", "security.remote_settings.intermediates.enabled", "security.remote_settings.crlite_filters.enabled"],
  },
];

function renderMozilla(box) {
  box.classList.add("disclose");
  for (const item of MOZ_ITEMS) {
    const row = el("div", "disclose-row");
    const text = el("div", "disclose-text");
    const name = el("p", "disclose-name", item.name);
    if (item.keep) name.append(el("span", "disclose-keep", "Keep this on"));
    text.append(name, el("p", "disclose-what", item.what));
    row.append(text);
    if (item.prefs) {
      const sw = el("button", "switch mini");
      sw.type = "button";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-label", item.name);
      sw.append(el("span", "switch-track"));
      const on = item.prefs.every(p => { try { return PREFS.getBoolPref(p, true); } catch (e) { return true; } });
      sw.setAttribute("aria-checked", String(on));
      sw.addEventListener("click", () => {
        const next = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", String(next));
        for (const p of item.prefs) { try { PREFS.setBoolPref(p, next); } catch (e) { /* pref missing in this build */ } }
        note(item.name + (next ? " is on." : " is off. Turn it back on any time in Settings."));
      });
      row.append(sw);
    } else {
      row.append(el("span", "disclose-tag", "Only if you sign in"));
    }
    box.append(row);
  }
  note("Everything else that used to phone Mozilla is switched off for good.");
  popIn(box.children);
}

// ---- Steps ------------------------------------------------------------------------

const steps = [
  { title: "Bring your stuff along", text: "Pick a browser, then choose what comes with you.", render: renderImport, commit: commitImport },
  { title: "Pick your search", text: "Sorted from private to nosy. Change it any time in Settings.", render: renderSearch },
  { title: "Pick your layout", text: "Tabs down a sidebar, or a bar across the top. Switch any time in Settings.", render: renderLayout },
  { title: "What reaches Mozilla", text: "Just these three, and only when you use them.", render: renderMozilla },
  { title: "Make Folio your default?", text: "Links you open from other apps will land here.", render: renderDefault, commit: commitDefault },
  { title: "You're all set", text: "Here's your Folio, set up your way.", render: renderDone, last: true },
];

let index = -1;
let busy = false;

async function leave() {
  const chars = $("step-title").querySelectorAll(".char");
  const rest = [$("step-hero"), $("step-text"), ...$("choices").children, ...($("bring")?.children ?? []), $("step-note")];
  await Promise.all([
    play(chars, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px)" }], { stagger: 8, duration: 240, easing: "ease-in" }),
    play(rest, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px)" }], { stagger: 15, duration: 220, easing: "ease-in" }),
  ]);
}

async function show(i) {
  index = i;
  const step = steps[i];
  $("bring")?.remove();
  $("step-hero").replaceChildren();
  const box = $("choices");
  box.replaceChildren();
  box.className = "";
  note("");
  $("back").hidden = i === 0;
  $("next").textContent = "";
  if (step.last) $("next").append("Start browsing");
  else $("next").append($("next-arrow").content.cloneNode(true));
  document.querySelectorAll("#dots span").forEach((d, n) => d.classList.toggle("on", n === i));

  // Build the whole step first (hidden), so the centered block has its final size
  // before anything animates. Then reveal title, text and choices together.
  $("step-title").replaceChildren();
  $("step-text").textContent = "";
  $("nav").style.visibility = "hidden"; // the block is briefly empty here; don't let the buttons jump
  box.style.display = "none";
  await Promise.resolve(step.render(box)).catch(e => note("Something went wrong: " + e.message));
  box.style.display = "";
  for (const n of [$("step-hero"), $("step-note"), $("step-text")]) n.getAnimations().forEach(a => a.cancel());
  const chars = letters($("step-title"), step.title);
  play(chars, [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], { stagger: 22, ...SPRING_TITLE });
  $("step-text").textContent = step.text;
  play($("step-text"), [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { delay: 200, duration: 500, easing: "ease-out" });
  $("nav").style.visibility = "";
  // Keep the arrow in the true middle (above the dots): an invisible spacer as wide as Back balances the row.
  $("nav").toggleAttribute("noback", $("back").hidden);
  $("nav").style.setProperty("--back-w", $("back").hidden ? "0px" : $("back").offsetWidth + "px");
  play($("nav"), [{ opacity: 0 }, { opacity: 1 }], { delay: 150, duration: 300, easing: "ease-out" });
}


async function next() {
  if (busy) return;
  const step = steps[index];
  if (step.last) return finish();
  busy = true;
  $("next").disabled = true;
  const ok = await Promise.resolve(step.commit ? step.commit() : true);
  $("next").disabled = false;
  if (ok) { await leave(); await show(index + 1); }
  busy = false;
}

async function back() {
  if (busy || index <= 0) return;
  busy = true;
  await leave();
  await show(index - 1);
  busy = false;
}

function finish() {
  try { Services.prefs.setBoolPref("folio.welcome.completed", true); } catch (e) { /* ignore */ }
  // First run: the tour is a tab in a normal window, so just go to the start page.
  const inTab = !!window.browsingContext?.embedderElement;
  if (inTab) { location.replace(START_PAGE); return; }
  // Opened on its own (launcher, --chrome): open a real Folio window, then close the tour.
  try {
    window.openDialog(AppConstants.BROWSER_CHROME_URL ?? "chrome://browser/content/browser.xhtml", "_blank", "chrome,all,dialog=no", START_PAGE);
    window.close();
  } catch (e) {
    note("Couldn't open a window: " + e.message);
  }
}

function startSteps() {
  const dots = $("dots");
  for (let n = 0; n < steps.length; n++) dots.append(el("span"));
  play(dots, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  $("steps").hidden = false;
  play($("nav"), [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { delay: 300, duration: 500, easing: "ease-out" });
  show(0);
  $("next").focus();
}

// The arrow icon, reused on every step.
const arrow = document.createElement("template");
arrow.id = "next-arrow";
arrow.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
document.body.append(arrow);

$("next").addEventListener("click", next);
$("back").addEventListener("click", back);
document.addEventListener("keydown", (e) => {
  if ($("start") && (e.key === "Enter" || e.key === "ArrowRight")) { $("go").click(); return; }
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") back();
});

// Opened as its own window on first run (BrowserContentHandler), the tour had no size of its own: on a floating
// window manager (GNOME, KDE, Windows) it came up as a 411x101 strip. Give it a real size, centered. In a tab
// (isContent) the browser decides the size, and a tiling WM simply overrides this.
(function sizeOwnWindow() {
  try {
    if (window.browsingContext?.isContent) return;
    const aw = screen.availWidth, ah = screen.availHeight;
    const w = Math.min(1280, Math.max(900, aw - 120)), h = Math.min(840, Math.max(620, ah - 120));
    if (window.outerWidth >= w - 40 && window.outerHeight >= h - 40) return;
    window.resizeTo(Math.min(w, aw), Math.min(h, ah));
    window.moveTo(screen.availLeft + Math.max(0, (aw - window.outerWidth) / 2), screen.availTop + Math.max(0, (ah - window.outerHeight) / 2));
  } catch (e) { /* keep whatever size the window got */ }
})();

// Seen once is enough: the first-run gate in BrowserContentHandler reads this.

try { Services.prefs.setBoolPref("folio.welcome.completed", true); } catch (e) { /* ignore */ }

intro();
