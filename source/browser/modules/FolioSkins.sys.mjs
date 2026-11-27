/* Folio site skins bridge: gives the built-in "Folio Site Skins" + "Folio Pages" add-ons the current wallpaper and
 * Folio's palette. Default: in-process only, through the add-ons' privileged folioTheme API (api/parent.js in each
 * add-on calls state()/wallpaper()/waitForChange() below), so NO listening socket exists and nothing on the PC or the
 * web can probe for Folio. The old HTTP server on 127.0.0.1:8791 is kept behind folio.skins.http (default false) as a
 * rollback for one release. */
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const PORT = 8791;
const PREF = "folio.theme.wallpaper.path";
let server = null;

function respond(transport, status, ctype, bytes, origin) {
  const cors = origin ? `Access-Control-Allow-Origin: ${origin}\r\n` : "";
  const head = `HTTP/1.1 ${status}\r\n${cors}Content-Type: ${ctype}\r\nContent-Length: ${bytes.length}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`;
  const all = new Uint8Array(head.length + bytes.length);
  for (let i = 0; i < head.length; i++) all[i] = head.charCodeAt(i);
  all.set(bytes, head.length);
  const out = transport.openOutputStream(0, 0, 0);
  const src = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
  src.setData(all.buffer, 0, all.length);
  const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
  NetUtil.asyncCopy(src, out, () => { setTimeout(() => { try { transport.close(0); } catch (e) {} }, 5000); });
}

// Folio's own palette (written by FolioTheme in the browser window); null = no wallpaper theme.
function folioColors() {
  try { return JSON.parse(Services.prefs.getStringPref("folio.theme.palette", "")) || null; } catch (e) { return null; }
}

async function handle(transport, req) {
  const line = req.split("\r\n")[0];
  // CORS only for Folio's own extensions: web pages must never read the wallpaper.
  const om = /\r\norigin: (moz-extension:\/\/[^\r\n]+)/i.exec(req);
  const origin = om ? om[1] : "";
  const [path, query = ""] = (line.split(" ")[1] || "").split("?");
  const file = Services.prefs.getStringPref(PREF, "");
  const enc = new TextEncoder();
  if (path === "/state") {
    // Long poll: "?v=<version the add-on already has>" is held until the theme changes (or WAIT_MS passes), so the
    // add-ons no longer ask every 3 s (that woke Folio ~60 times per 90 s at idle). Plain /state answers at once.
    const v = /(?:^|&)v=([^&]*)/.exec(query)?.[1];
    if (v === String(version)) {
      watchThemePrefs();
      const w = { transport, origin, timer: null };
      w.timer = setTimeout(() => { waiters.delete(w); sendState(w.transport, w.origin); }, WAIT_MS);
      waiters.add(w);
      return undefined;
    }
    return sendState(transport, origin);
  }
  if (path === "/wallpaper" && file) {
    try { return respond(transport, "200 OK", "image/jpeg", await IOUtils.read(file), origin); } catch (e) {}
  }
  respond(transport, "404 Not Found", "text/plain", enc.encode("no"), origin);
}

// Theme version for the long poll: bumped whenever something the add-ons read changes. Starts at a random value so an
// add-on still holding a version from another Folio run never matches by accident.
const WAIT_MS = 55000;
const THEME_PREFS = [PREF, "folio.theme.palette", "folio.seethrough"];
let version = Math.floor(Math.random() * 1e9);
const waiters = new Set();
const apiWaiters = new Set();
function sendState(transport, origin) {
  const body = stateObj();
  respond(transport, "200 OK", "application/json", new TextEncoder().encode(JSON.stringify(body)), origin);
}
let watching = false;
function watchThemePrefs() {
  if (watching) return;
  watching = true;
  const bump = () => {
    version++;
    for (const w of waiters) { clearTimeout(w.timer); sendState(w.transport, w.origin); }
    waiters.clear();
    for (const w of apiWaiters) { clearTimeout(w.timer); w.resolve(stateObj()); }
    apiWaiters.clear();
  };
  for (const p of THEME_PREFS) Services.prefs.addObserver(p, bump);
}

const { setInterval, clearInterval, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

function stateObj() {
  const file = Services.prefs.getStringPref(PREF, "");
  return { v: String(version), wallpaper: file.split("/").pop(), colors: folioColors(), seethrough: Services.prefs.getBoolPref("folio.seethrough", false) };
}

export const FolioSkins = {
  state() { return stateObj(); },
  async wallpaper() {
    const file = Services.prefs.getStringPref(PREF, "");
    if (!file) return null;
    try { return await IOUtils.read(file); } catch (e) { return null; }
  },
  // Resolves with the new state once the theme changes, or with the same state after `ms` (callers loop).
  waitForChange(v, ms = 25000) {
    watchThemePrefs();
    if (v !== String(version)) return Promise.resolve(stateObj());
    return new Promise(resolve => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => { apiWaiters.delete(w); resolve(stateObj()); }, ms);
      apiWaiters.add(w);
    });
  },
  start() {
    watchThemePrefs();
    if (!Services.prefs.getBoolPref("folio.skins.http", false)) return;
    if (server) return;
    try {
      server = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
      server.init(PORT, true, -1); // loopback only
      server.asyncListen({
        onSocketAccepted(srv, transport) {
          const inp = transport.openInputStream(0, 0, 0).QueryInterface(Ci.nsIAsyncInputStream);
          const sis = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream);
          sis.init(inp);
          inp.asyncWait({
            onInputStreamReady() {
              let req = "";
              try { req = sis.read(Math.min(sis.available(), 2048)); } catch (e) {}
              handle(transport, req).catch(e => dump('FolioSkins handle: ' + e + '\n'));
            },
          }, 0, 0, Services.tm.mainThread);
        },
        onStopListening() {},
      });
    } catch (e) {
      // Port taken (another Folio: a test or PGO-training instance): keep retrying instead of giving up, so this
      // window's site skins come back as soon as the port frees. Without the bridge WhatsApp stays unthemed.
      server = null;
      if (!retryTimer) {
        console.warn("FolioSkins bridge: port busy, retrying every 10 s:", e);
        retryTimer = setInterval(() => { FolioSkins.start(); if (server) { clearInterval(retryTimer); retryTimer = null; } }, 10000);
      }
    }
  },
};
let retryTimer = null;
