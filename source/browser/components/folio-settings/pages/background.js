// Folio Pages: Folio's own palette, the same as the sidebar (folioTheme API), Catppuccin site styles compiled with less.js right here.
// Theme bridge: Folio's in-process folioTheme API (no local server). Falls back to the old HTTP bridge only if the API
// is missing (rollback pref folio.skins.http on an older Folio).
const API = "http://127.0.0.1:8791";
const Bridge = browser.folioTheme ? {
  state: () => browser.folioTheme.getState(),
  wait: v => browser.folioTheme.waitForChange(v),
  wallpaper: async () => new Blob([await browser.folioTheme.getWallpaper()], { type: "image/jpeg" }),
  poll: false,
} : {
  state: async () => (await fetch(API + "/state", { cache: "no-store" })).json(),
  wait: async v => (await fetch(API + "/state?v=" + v, { cache: "no-store" })).json(),
  wallpaper: async () => (await fetch(API + "/wallpaper", { cache: "no-store" })).blob(),
};
let rules = null, last = null, compiling = null;

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a => "#" + a.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => hex(rgb(a).map((x, i) => x + (rgb(b)[i] - x) * t));
function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return hex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
function flavor(p) {
  const base = p.surface, text = mix(p.on_surface, "#ffffff", 0.4);
  const n = t => mix(base, text, t);
  const hue = { rosewater: 10, flamingo: 0, pink: 320, red: 355, maroon: 350, peach: 25, yellow: 45, green: 125, teal: 170, sky: 195, sapphire: 205, blue: 215, lavender: 250 };
  const c = { mauve: mix(p.primary, base, 0.28) };
  for (const [k, h] of Object.entries(hue)) c[k] = hsl(h, 0.36, 0.58);
  Object.assign(c, {
    text, subtext1: n(0.82), subtext0: n(0.70), overlay2: n(0.55), overlay1: n(0.46), overlay0: n(0.38),
    surface2: n(0.24), surface1: n(0.16), surface0: n(0.09), base, mantle: mix(base, "#000000", 0.25), crust: mix(base, "#000000", 0.45),
  });
  return c;
}
function stdLib(src, c) {
  const body = Object.entries(c).map(([k, v]) => `@${k}: ${v};`).join(" ");
  src = src.replace("@catppuccin: {", `@catppuccin: {\n  @matugen: { ${body} };`);
  const mocha = src.match(/@catppuccin-filters: \{[\s\S]*?\n  @mocha: (\{[^\n]*\})/)[1];
  return src.replace("@catppuccin-filters: {", `@catppuccin-filters: {\n  @matugen: ${mocha};`);
}
function defaults(header) {
  const out = { lightFlavor: "matugen", darkFlavor: "matugen", accentColor: "mauve" };
  for (const m of header.matchAll(/^@var\s+(\w+)\s+(\w+)\s+"[^"]*"\s+(.+)$/gm)) {
    const [, type, name, rest] = m;
    if (name in out) continue;
    if (type === "select") {
      const opts = [...rest.matchAll(/"([^":]*):[^"]*?(\*?)"/g)];
      const pick = opts.find(o => o[2]) || opts[0]; if (pick) out[name] = pick[1];
    } else if (type === "checkbox") out[name] = rest.trim().split(/\s+/).pop();
    else { const q = rest.match(/"([^"]*)"\s*$/); if (q) out[name] = `"${q[1]}"`; else out[name] = rest.trim(); }
  }
  return Object.entries(out).map(([k, v]) => `@${k}: ${v};`).join("\n");
}
function unwrap(css) {
  const out = []; let i = 0;
  while ((i = css.indexOf("@-moz-document", i)) !== -1) {
    const open = css.indexOf("{", i); let depth = 1, j = open + 1;
    while (depth && j < css.length) { const ch = css[j++]; if (ch === "{") depth++; else if (ch === "}") depth--; }
    const head = css.slice(i + 14, open), body = css.slice(open + 1, j - 1);
    const matchers = [...head.matchAll(/(domain|url-prefix|url|regexp)\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/g)]
      .map(m => ({ t: m[1], v: m[2].slice(1, -1).replace(/\\([\s\S])/g, "$1") }));
    out.push({ matchers, css: body }); i = j;
  }
  return out;
}

// ChatGPT has its own theme engine: derive its native variable block from accent / surface / ink.
async function chatgptCss(p) {
  const GPT = await (await fetch(browser.runtime.getURL("chatgpt_recipe.json"))).json();
  const R = { A: rgb(p.primary), S: rgb(p.surface), I: rgb(p.on_surface), W: [255, 255, 255], K: [0, 0, 0] };
  const col = c => {
    let v = c.r ? R[c.r] : R[c.m[0]].map((x, i) => x + (R[c.m[1]][i] - x) * c.t);
    v = v.map(x => Math.max(0, Math.min(255, Math.round(x))));
    return "a" in c ? `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${c.a})` : hex(v);
  };
  const body = GPT.map(g => `${g.v}:${g.t.replace(/\x01(\d+)\x02/g, (_, i) => col(g.c[+i]))};`).join("");
  return `html[data-theme="dark"]{--codex-base-accent:${p.primary};--codex-base-ink:${p.on_surface};--codex-base-surface:${p.surface};${body}}`;
}

async function compile(p) {
  const get = async path => (await fetch(browser.runtime.getURL(path))).text();
  const sites = await (await fetch(browser.runtime.getURL("sites.json"))).json();
  const std = stdLib(await get("styles/lib/std/v1.less"), flavor(p)), mw = await get("styles/lib/mediawiki/v1.less");
  class FM extends less.AbstractFileManager {
    supports(f) { return f === "std-lib" || f === "mw-lib"; }
    supportsSync() { return false; }
    loadFile(f) { return Promise.resolve({ filename: f, contents: f === "std-lib" ? std : mw }); }
  }
  const plugins = [{ install(_, pm) { pm.addFileManager(new FM()); } }];
  const out = [];
  for (const site of sites) {
    try {
      let src = await get(`styles/${site}/catppuccin.user.less`);
      const header = src.match(/==UserStyle==([\s\S]*?)==\/UserStyle==/)[1];
      src = src.replace(/@import\s+"https:\/\/userstyles\.catppuccin\.com\/lib\/std\/v1\.less";?/, '@import (reference) "std-lib";');
      src = src.replace(/@import\s+"https:\/\/userstyles\.catppuccin\.com\/lib\/mediawiki\/v1\.less";?/, '@import "mw-lib";');
      const res = await less.render(defaults(header) + "\n" + src, { filename: site + ".less", plugins });
      for (const r of unwrap(res.css)) out.push({ site, ...r });
    } catch (e) { /* one site failing must not stop the rest */ }
  }
  const gpt = out.filter(x => !x.matchers.some(m => m.v === "chatgpt.com" || m.v === "chat.openai.com"));
  gpt.push({ matchers: [{ t: "domain", v: "chatgpt.com" }], css: await chatgptCss(p) });
  return gpt;
}

const KEY = "http://folio.invalid/rules"; // Cache API only takes http(s) keys
let syncAgain = false;
async function sync() {
  // A change that arrives mid-compile used to be dropped (the page kept the previous space's colors, 2026-11-26):
  // remember it and compile again as soon as this one finishes.
  if (compiling) { syncAgain = true; return compiling; }
  return compiling = (async () => {
    try {
      const st = await Bridge.state();
      const see = !!st.seethrough;  // (the flag itself is pushed to the pages by syncSee, below, so it never waits on a compile)
      // See-through without a wallpaper still needs dark sites, so it falls back to Folio's own purple.
      if (!st.wallpaper && !see) { if (last !== "") { last = ""; rules = null; await browser.storage.local.remove(["palette", "rev"]); } return; }
      // The palette is Folio's own (same as the sidebar), published by the browser right after the wallpaper changes.
      if (st.wallpaper && !FolioPal.ok(st.colors)) return;
      const rev = (st.wallpaper || "folio-default") + (st.wallpaper ? FolioPal.key(st.colors) : "");
      if (rev === last) return;
      // The background sleeps when idle; what was compiled for this wallpaper is saved, so waking up costs nothing.
      if (last === null) {
        const saved = await browser.storage.local.get(["rev", "palette"]);
        if (saved.rev === rev && saved.palette && (await caches.open("rules").then(c => c.match(KEY)))) { last = rev; return; }
      }
      const p = FolioPal.roles(st.wallpaper ? st.colors : { accent: "#9d8cff", sidebarBg: "#100f14" });
      const compiledRules = await compile(p);
      rules = compiledRules;
      await (await caches.open("rules")).put(KEY, new Response(JSON.stringify(compiledRules)));
      last = rev;
      await browser.storage.local.set({ palette: p, rev });
    } catch (e) { /* bridge not up yet, keep the last palette and styles */ }
  })().finally(() => { compiling = null; if (syncAgain) { syncAgain = false; sync(); } });
}
sync();
// Waits on the bridge (long poll) instead of asking every 3 s: Folio answers the moment the theme changes.
(async function watch() {
  let v = "";
  for (;;) {
    try {
      const st = await Bridge.wait(v);
      if (st.v == null) { await new Promise(r => setTimeout(r, 3000)); sync(); continue; } // older bridge: poll
      if (st.v !== v) { v = st.v; sync(); }
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); } // bridge not up yet
  }
})();

function hit(m, u) {
  try {
    if (m.t === "domain") return u.hostname === m.v || u.hostname.endsWith("." + m.v);
    if (m.t === "url-prefix") return u.href.startsWith(m.v);
    if (m.t === "url") return u.href === m.v;
    if (m.t === "regexp") return new RegExp("^(?:" + m.v + ")$").test(u.href);
  } catch (e) {}
  return false;
}
async function stylesFor(href) {
  if (!rules) { const r = await (await caches.open("rules")).match(KEY); rules = r ? await r.json() : []; }
  const u = new URL(href);
  return rules.filter(r => r.matchers.some(m => hit(m, u))).map(r => r.css).join("\n");
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "proxy") {
    if (sender.tab) chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, world: "MAIN", injectImmediately: true, func: injectProxy, args: [msg.sheets, msg.ce] }).catch(() => {});
    return;
  }
  if (msg.type === "styles") { stylesFor(msg.url).then(reply, () => reply("")); return true; }
  if (msg.type === "fetch") {
    fetch(msg.url, { credentials: "omit" }).then(async r => {
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      reply({ ok: r.ok, status: r.status, type: r.headers.get("content-type") || "", b64: btoa(bin) });
    }).catch(e => reply({ ok: false, error: String(e) }));
    return true;
  }
});
