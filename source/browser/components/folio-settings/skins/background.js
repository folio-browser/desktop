// Folio build: wallpaper + Folio's own palette (same as the sidebar) from Folio (folioTheme API); lib/folio-palette.js expands it into roles.
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
let last = null;
async function sync() {
  try {
    const st = await Bridge.state();
    if (!st.wallpaper && !st.seethrough) { if (last !== "") { last = ""; browser.storage.local.remove("theme"); } return; }
    if (!FolioPal.ok(st.colors)) return; // Folio's palette is published right after the wallpaper changes: wait for it
    const rev = (st.seethrough ? "see:" : st.wallpaper) + FolioPal.key(st.colors);
    if (rev === last) return;
    // See-through space (2026-11-26): no wallpaper image at all; WhatsApp becomes clear glass over the desktop's blur,
    // colored with Folio's palette (the desktop wallpaper's, published by FolioTheme.applyDesktop).
    if (st.seethrough) {
      last = rev;
      browser.storage.local.set({ theme: { wallpaper: "", seethrough: true, colors: FolioPal.roles(st.colors), image: "" } });
      return;
    }
    const blob = await Bridge.wallpaper();
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1920 / bmp.width), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    const image = cv.toDataURL("image/jpeg", 0.86);
    const img = new Image(); img.src = image; await img.decode();
    const colors = FolioPal.roles(st.colors);
    last = rev;
    browser.storage.local.set({ theme: { wallpaper: st.wallpaper, seethrough: false, colors, image } });
  } catch (e) { /* bridge not up yet */ }
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
browser.runtime.onMessage.addListener((m) => {
  if (m === "refresh") sync();
  else if (m && m.type === "wtdump" && browser.folioTheme?.debugWrite) browser.folioTheme.debugWrite(m.name, m.text).catch(() => {});
});
