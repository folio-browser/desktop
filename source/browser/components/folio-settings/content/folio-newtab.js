/* Folio's new tab page: the F logo and the search box, on the wallpaper. Search goes to the default
   engine (or opens an address). Chrome page: Services and IOUtils are available. */
const prefs = globalThis.Services?.prefs ?? ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services.prefs;

// Wallpaper: the image file the browser window saved (folio.theme.wallpaper.path), read here as a blob.
let wallpaperUrl = "";
let wallpaperGen = 0;
async function applyWallpaper() {
  const gen = ++wallpaperGen;
  const seeThrough = prefs.getBoolPref("folio.seethrough", false);  // see-through window: the desktop is the background
  document.body.classList.toggle("seethrough", seeThrough);
  const path = seeThrough ? "" : prefs.getStringPref("folio.theme.wallpaper.path", "");
  let url = "";
  if (path) {
    try { url = URL.createObjectURL(new Blob([await IOUtils.read(path)], { type: "image/jpeg" })); } catch (e) {}
    // Decode before swapping (2026-11-26: a big wallpaper showed an empty dark page for ~0.5 s while it decoded).
    if (url) { const img = new Image(); img.src = url; try { await img.decode(); } catch (e) {} }
  }
  if (gen !== wallpaperGen) { if (url) URL.revokeObjectURL(url); return; } // a newer change won
  const old = wallpaperUrl;
  wallpaperUrl = url;
  if (old) setTimeout(() => URL.revokeObjectURL(old), 1000); // keep the old picture until the new one has painted
  if (url) {
    document.documentElement.style.setProperty("--wallpaper", `url("${url}")`);
    document.body.classList.add("has-wallpaper");
  } else {
    document.documentElement.style.removeProperty("--wallpaper");
    document.body.classList.remove("has-wallpaper");
  }
}

// Where this page sits inside the browser window, so the wallpaper can continue from the sidebar.
function placeWallpaper() {
  try {
    const top = window.browsingContext?.topChromeWindow;
    if (!top) return;
    const root = document.documentElement.style;
    root.setProperty("--win-x", (window.mozInnerScreenX - top.mozInnerScreenX) + "px");
    root.setProperty("--win-y", (window.mozInnerScreenY - top.mozInnerScreenY) + "px");
    root.setProperty("--win-w", top.innerWidth + "px");
    root.setProperty("--win-h", top.innerHeight + "px");
  } catch (e) {}
}
// The accent comes from the browser window (the wallpaper's colors), so the glass F is tinted with it.
function syncAccent() {
  try {
    const top = window.browsingContext?.topChromeWindow;
    // The inline value is the target; the computed one is mid-transition (the root eases --folio-accent over 0.35 s).
    const a = top && top.document.documentElement.style.getPropertyValue("--folio-accent").trim();
    if (a) document.documentElement.style.setProperty("--accent", a);
    // A wallpaper on the WINDOW shows through this page too: light mode must keep light text then (2026-11-25).
    document.body?.classList.toggle("win-wallpaper", !!top?.document.documentElement.hasAttribute("folio-wallpaper"));
  } catch (e) {}
}
try {
  const top = window.browsingContext?.topChromeWindow;
  if (top) new top.MutationObserver(syncAccent).observe(top.document.documentElement, { attributes: true, attributeFilter: ["style", "folio-wallpaper"] });
} catch (e) {}
syncAccent();
placeWallpaper();
window.addEventListener("resize", placeWallpaper);
new ResizeObserver(placeWallpaper).observe(document.documentElement);

applyWallpaper();
prefs.addObserver("folio.theme.wallpaper.path", () => applyWallpaper());
prefs.addObserver("folio.seethrough", () => applyWallpaper());
window.addEventListener("unload", () => prefs.removeObserver("folio.theme.wallpaper.path", applyWallpaper));

// Clock + date under the logo (2026-11-25, Sammy picked it over a search box: search lives in the real address bar,
// which gets focus on a new tab). Updates exactly on the minute, and only while the page is visible: no busy timer.
const timeEl = document.getElementById("time");
const dateEl = document.getElementById("date");
const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
// folio.newtab.clock: "auto" (the system's habit), "12" or "24" (Settings > Appearance).
function timeFormat() {
  const mode = prefs.getStringPref("folio.newtab.clock", "auto");
  const opts = { hour: "numeric", minute: "2-digit" };
  if (mode === "12") opts.hour12 = true; else if (mode === "24") { opts.hour12 = false; opts.hour = "2-digit"; }
  return new Intl.DateTimeFormat(undefined, opts);
}
let fmtTime = timeFormat();
prefs.addObserver("folio.newtab.clock", () => { fmtTime = timeFormat(); tickClock(); });
let clockTimer = 0;
function tickClock() {
  clearTimeout(clockTimer);
  const now = new Date();
  // Only the digits are centered under the logo; AM/PM sits small beside them without pushing them off-center.
  const parts = fmtTime.formatToParts(now);
  const digits = parts.filter(p => p.type !== "dayPeriod").map(p => p.value).join("").trim();
  const period = parts.find(p => p.type === "dayPeriod")?.value || "";
  timeEl.replaceChildren(document.createTextNode(digits));
  if (period) { const s = document.createElement("span"); s.className = "period"; s.textContent = period; timeEl.append(s); }
  dateEl.textContent = fmtDate.format(now);
  if (document.visibilityState === "visible") {
    clockTimer = setTimeout(tickClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }
}
document.addEventListener("visibilitychange", tickClock);
tickClock();

// Right-click menu: anywhere on the page opens it at the pointer.
const menu = document.getElementById("menu");
const fileInput = document.getElementById("wallpaper-file");
function closeMenu() { menu.hidden = true; }
document.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  menu.hidden = false;
  const x = Math.min(ev.clientX, window.innerWidth - menu.offsetWidth - 8);
  const y = Math.min(ev.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = Math.max(8, x) + "px";
  menu.style.top = Math.max(8, y) + "px";
});
document.addEventListener("pointerdown", (ev) => { if (!menu.contains(ev.target)) closeMenu(); });
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeMenu(); });
window.addEventListener("blur", closeMenu);
document.getElementById("menu-wallpaper").addEventListener("click", () => { closeMenu(); fileInput.click(); });
fileInput.addEventListener("change", async () => {
  const f = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  const theme = window.browsingContext?.topChromeWindow?.FolioTheme;
  if (f && theme) await theme.setWallpaper(f);
});

// Private windows: same page, plus a small "Private" badge under the logo and a private tab name + icon.
(function markPrivate() {
  let isPrivate = false;
  try { isPrivate = !!window.browsingContext?.usePrivateBrowsing; } catch (e) {}
  if (!isPrivate) return;
  document.body.classList.add("private");
  document.title = "Private tab";
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = "chrome://browser/skin/privatebrowsing/favicon.svg";
  const badge = document.createElement("div");
  badge.className = "private-badge";
  badge.textContent = "Private";
  badge.title = "History, cookies and searches from this window are forgotten when you close it.";
  document.querySelector(".mark")?.after(badge);
})();
