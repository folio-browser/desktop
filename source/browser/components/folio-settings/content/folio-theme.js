/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Folio wallpaper theme (FolioTheme): palette from the space's wallpaper or the desktop wallpaper (see-through),
// published to the sidebar, pages and built-in add-ons. Split out of folio-sidebar.js 2026-11-26 (no code change);
// loaded right after it by global-scripts.js, so everything runs in the same order as before.

// ---- Wallpaper theme: colors come from an image the user picks (no matugen needed) ----------
// The image is kept as a small JPEG in folio.theme.wallpaper. Colors are read from it here, in the
// browser window, and applied as --folio-* variables. The sidebar gets a blurred copy of the image.
const FolioTheme = {
  PREF: "folio.theme.wallpaper.path",
  FILE: "folio-wallpaper.jpg",

  // A blob URL for a wallpaper file (or "" when it is missing).
  async urlFor(path) {
    if (!path) return "";
    try {
      const bytes = await IOUtils.read(path);
      return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    } catch (e) { return ""; }
  },
  // The current space's wallpaper (the pref always holds it). Used by both pages.
  urlForSaved() {
    return this.urlFor(Services.prefs.getStringPref(this.PREF, ""));
  },

  // Scale the picked image to fit `max` px on its long side (full quality by default) and return a JPEG blob.
  downscale(file, max = 2560) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const src = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(src);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode"))), "image/jpeg", 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("Not an image")); };
      img.src = src;
    });
  },

  // Read the image's colors. Hue buckets, weighted by how colorful and how common each pixel is.
  // The accent is the strongest bucket, lifted to a readable lightness for a dark UI.
  palette(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const N = 48;
        const c = document.createElement("canvas");
        c.width = c.height = N;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, N, N);
        const px = ctx.getImageData(0, 0, N, N).data;
        const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
          ar += r; ag += g; ab += b; n++;
          const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
          const l = (max + min) / 2;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
          if (s < 0.12 || l < 0.12 || l > 0.92) continue;
          let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
          const bk = buckets[Math.floor(h / 30)];
          const w = s * (1 - Math.abs(2 * l - 1) * 0.5);
          bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        const toRgb = (r, g, b) => [r, g, b].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
        // A black-and-white image has no colorful pixels: its own grays are the accent (a soft silver on
        // the dark UI) instead of Folio's purple. A handful of stray colored pixels counts as none too.
        const mono = best.w / n < 0.01;
        let accent = mono ? [212, 212, 216] : toRgb(best.r / best.w, best.g / best.w, best.b / best.w);
        // Lift the accent so it reads on a dark surface.
        const lift = (rgb) => {
          const [r, g, b] = rgb.map(v => v / 255);
          const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
          let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
          // Keep the wallpaper's own saturation (clamped), and a lightness that reads on a dark surface.
          const L = 0.64, S = Math.max(0.55, Math.min(0.95, s));
          const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = L - C / 2;
          const [r1, g1, b1] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
          return toRgb(r1 + m, g1 + m, b1 + m);
        };
        if (!mono) accent = lift(accent);
        // The sidebar: the image's average color, pushed toward a dark base so text stays readable.
        const avg = [ar / n, ag / n, ab / n];
        const base = [16, 15, 20];
        const side = avg.map((v, i) => Math.round(v * 255 * 0.28 + base[i] * 0.72));
        // The accent must read on this sidebar: lift it toward white until its contrast is at least 4.5:1.
        const lum = (rgb) => {
          const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
        for (let i = 0; i < 20 && contrast(accent, side) < 4.5; i++) accent = accent.map(v => Math.round(v + (255 - v) * 0.1));
        // The sidebar is glass over the blurred wallpaper, so what its text really sits on is the wallpaper, not the dark
        // sidebar color. Look at the bright pixels of the left strip in 6 height bands and tint each band just enough
        // (never below the old 14%) for the text to reach 6:1 and the accent 3:1. Dark parts keep the clear glass look.
        const TEXT = [242, 240, 246], BANDS = 6, COLS = Math.round(N * 0.3);
        // One scrim per side: the left strip, and the right strip for a sidebar on the right (2026-11-26).
        const scrimFor = (x0, x1) => {
          let tint = [];
          for (let k = 0; k < BANDS; k++) {
            const cells = [];
            for (let y = Math.floor(k * N / BANDS); y < Math.floor((k + 1) * N / BANDS); y++) {
              for (let x = x0; x < x1; x++) { const i = (y * N + x) * 4, p = [px[i], px[i + 1], px[i + 2]]; cells.push([lum(p), p]); }
            }
            cells.sort((a, b) => a[0] - b[0]);
            const worst = cells[Math.floor(cells.length * 0.8)][1];
            let a = 0.14;
            while (a < 0.85) {
              const under = worst.map((v, i) => v * (1 - a) + side[i] * a);
              if (contrast(TEXT, under) >= 6 && contrast(accent, under) >= 3) break;
              a += 0.03;
            }
            tint.push(Math.min(a, 0.85));
          }
          tint = tint.map((v, k) => Math.max(v, (tint[k - 1] ?? v) * 0.25 + v * 0.5 + (tint[k + 1] ?? v) * 0.25)); // soften steps
          return `linear-gradient(to bottom, ${tint.map((a, k) => `rgba(${side.join(",")},${a.toFixed(2)}) ${Math.round(k / (BANDS - 1) * 100)}%`).join(", ")})`;
        };
        const scrim = scrimFor(0, COLS);
        const scrimRight = scrimFor(N - COLS, N);
        const hex = (rgb) => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
        const rgba = (rgb, a) => `rgba(${rgb.join(",")},${a})`;
        resolve({
          imgW: img.naturalWidth, imgH: img.naturalHeight,
          scrim,
          scrimRight,
          accent: hex(accent),
          accentSoft: rgba(accent, 0.24),
          sidebarBg: hex(side),
          text: "#f2f0f6",
          muted: "rgba(242,240,246,0.6)",
          surface: "rgba(255,255,255,0.07)",
          grid: "rgba(255,255,255,0.1)",
        });
      };
      img.onerror = () => reject(new Error("Wallpaper could not be read"));
      img.src = url;
    });
  },

  // See-through (2026-11-26, Sammy: "it should change color based on my DESKTOP wallpaper"): what shows behind the
  // window is the desktop, so the palette comes from the desktop's wallpaper, in dark or light like the rest of Folio.
  // Linux: awww / swww / hyprpaper / GNOME / KDE; Windows: the wallpaper copy Windows keeps (TranscodedWallpaper).
  async desktopWallpaperPath() {
    const run = async (cmd, args) => {
      try {
        const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
        const bin = await Subprocess.pathSearch(cmd);
        const p = await Subprocess.call({ command: bin, arguments: args, stderr: "pipe" });
        let out = "", chunk;
        while ((chunk = await p.stdout.readString())) out += chunk;
        await p.wait();
        return out;
      } catch (e) { return ""; }
    };
    const exists = async (f) => { try { return f && (await IOUtils.stat(f)).type === "regular"; } catch (e) { return false; } };
    if (AppConstants.platform === "win") {
      const f = PathUtils.join(Services.dirsvc.get("AppData", Ci.nsIFile).path, "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
      return (await exists(f)) ? f : "";
    }
    if (AppConstants.platform !== "linux") return "";
    for (const daemon of ["awww", "swww"]) {
      const m = /image:\s*(.+?)\s*$/m.exec(await run(daemon, ["query"]));
      if (m && await exists(m[1])) return m[1];
    }
    const hp = /=\s*(\/.+?)\s*$/m.exec(await run("hyprctl", ["hyprpaper", "listactive"]));
    if (hp && await exists(hp[1])) return hp[1];
    for (const key of ["picture-uri-dark", "picture-uri"]) {
      const g = /file:\/\/([^'"\s]+)/.exec(await run("gsettings", ["get", "org.gnome.desktop.background", key]));
      if (g && await exists(decodeURIComponent(g[1]))) return decodeURIComponent(g[1]);
    }
    try {
      const kde = await IOUtils.readUTF8(PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".config", "plasma-org.kde.plasma.desktop-appletsrc"));
      const k = /^Image=(?:file:\/\/)?(\/.+)$/m.exec(kde);
      if (k && await exists(k[1])) return k[1];
    } catch (e) {}
    return "";
  },
  // Dark palette from the image, or its light version (white frost, dark text, a deeper accent) in light mode.
  lightVersion(p) {
    const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const hex = (a) => "#" + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    const side = rgb(p.sidebarBg), acc = rgb(p.accent);
    // Sidebar: mostly white with a hint of the wallpaper's own color.
    const light = side.map(v => 246 * 0.9 + Math.min(255, v * 2.2) * 0.1);
    // Accent deep enough to read on white (about 4.5:1).
    const lum = (c) => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    let a = acc;
    for (let i = 0; i < 24 && (lum(light) + 0.05) / (lum(a) + 0.05) < 4.5; i++) a = a.map(v => v * 0.9);
    return { ...p, accent: hex(a), accentSoft: `rgba(${a.map(Math.round).join(",")},0.18)`, sidebarBg: hex(light),
      text: "#1c1a23", muted: "rgba(28,26,35,0.6)", surface: "rgba(0,0,0,0.055)", grid: "rgba(0,0,0,0.09)" };
  },
  async applyDesktop(gen = this._gen) {
    const root = document.documentElement;
    const path = await this.desktopWallpaperPath();
    if (gen !== this._gen) return;
    let stat = null;
    try { stat = path && await IOUtils.stat(path); } catch (e) {}
    const sig = path + "|" + (stat?.lastModified || 0) + "|" + root.hasAttribute("folio-light");
    this._desktopSig = sig;
    root.removeAttribute("folio-wallpaper");
    root.style.removeProperty("--folio-wallpaper");
    root.style.removeProperty("--folio-sidebar-scrim");
    root.style.removeProperty("--folio-sidebar-scrim-r");
    let p = null;
    if (path) {
      const url = await this.urlFor(path);
      try { p = url && await this.palette(url); } catch (e) { p = null; }
      if (url) URL.revokeObjectURL(url);
    }
    if (this._desktopSig !== sig || gen !== this._gen) return; // a newer call won
    if (!p) {
      for (const v of ["--folio-sidebar-bg", "--folio-text", "--folio-muted", "--folio-surface", "--folio-grid", "--folio-accent-soft"]) root.style.removeProperty(v);
      root.removeAttribute("folio-desktop-palette");
      this._holdAccent = false;
      FolioSidebar.applyAccent();
      return;
    }
    if (root.hasAttribute("folio-light")) p = this.lightVersion(p);
    root.setAttribute("folio-desktop-palette", "");
    root.style.setProperty("--folio-accent", p.accent);
    root.style.setProperty("--folio-accent-soft", p.accentSoft);
    root.style.setProperty("--folio-sidebar-bg", p.sidebarBg);
    root.style.setProperty("--folio-text", p.text);
    root.style.setProperty("--folio-muted", p.muted);
    root.style.setProperty("--folio-surface", p.surface);
    root.style.setProperty("--folio-grid", p.grid);
    document.getElementById("folio-sidebar")?.style.setProperty("--folio-tint", p.accent + "26");
    this._holdAccent = false;
    this.remember(this.cacheKey(true), p);
    this.publish(p);
  },
  // While see-through is on, notice a new desktop wallpaper (checked every 15 s, and when the window comes back).
  watchDesktop() {
    if (this._desktopWatch) return;
    const check = async () => {
      if (!Services.prefs.getBoolPref("folio.seethrough", false)) return;
      const path = await this.desktopWallpaperPath();
      let stat = null;
      try { stat = path && await IOUtils.stat(path); } catch (e) {}
      const sig = path + "|" + (stat?.lastModified || 0) + "|" + document.documentElement.hasAttribute("folio-light");
      if (sig !== this._desktopSig) this.apply();
    };
    this._desktopWatch = setInterval(() => { if (document.hasFocus()) check(); }, 15000);
    window.addEventListener("focus", check);
    new MutationObserver(() => { if (Services.prefs.getBoolPref("folio.seethrough", false)) this.apply(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["folio-light"] });
    window.addEventListener("unload", () => clearInterval(this._desktopWatch), { once: true });
  },

  // ---- Palette cache (2026-11-26 fix: orange flash at startup) ----
  // Reading a palette is async (awww query + image decode, ~200 ms). Until it finished, applyAccent() painted the SPACE
  // color (Space 2 = #f7a27a) into the see-through glass, so every launch flashed orange. The last palette of each
  // wallpaper / of the desktop is kept in a pref and painted synchronously first; the async read only corrects it.
  CACHE: "folio.theme.paletteCache",
  cacheKey(seethrough) {
    const light = document.documentElement.hasAttribute("folio-light") ? "1" : "0";
    return seethrough ? `d|${light}` : `w|${Services.prefs.getStringPref(this.PREF, "")}`;
  },
  readCache() {
    try { return JSON.parse(Services.prefs.getStringPref(this.CACHE, "{}")) || {}; } catch (e) { return {}; }
  },
  remember(key, p) {
    const keep = ["accent", "accentSoft", "sidebarBg", "text", "muted", "surface", "grid", "scrim", "scrimRight", "imgW", "imgH"];
    const entry = Object.fromEntries(keep.filter(k => p[k] != null).map(k => [k, p[k]]));
    const cache = this.readCache();
    if (JSON.stringify(cache[key]) === JSON.stringify(entry)) return; // unchanged: no pref write
    delete cache[key];
    cache[key] = entry;
    const keys = Object.keys(cache);
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete cache[k]; // newest 12 only
    try { Services.prefs.setStringPref(this.CACHE, JSON.stringify(cache)); } catch (e) {}
  },
  // Paint the cached colors now (no await). Returns true when something was painted.
  applyCached(seethrough) {
    const root = document.documentElement;
    const p = this.readCache()[this.cacheKey(seethrough)];
    if (!p?.accent) return false;
    for (const [v, k] of [["--folio-accent", "accent"], ["--folio-accent-soft", "accentSoft"], ["--folio-sidebar-bg", "sidebarBg"],
      ["--folio-text", "text"], ["--folio-muted", "muted"], ["--folio-surface", "surface"], ["--folio-grid", "grid"]]) {
      if (p[k]) root.style.setProperty(v, p[k]);
    }
    document.getElementById("folio-sidebar")?.style.setProperty("--folio-tint", p.accent + "26");
    if (seethrough) {
      root.removeAttribute("folio-wallpaper");
      root.style.removeProperty("--folio-wallpaper");
      root.style.removeProperty("--folio-sidebar-scrim");
      root.style.removeProperty("--folio-sidebar-scrim-r");
      root.setAttribute("folio-desktop-palette", "");
    } else {
      if (p.scrim) root.style.setProperty("--folio-sidebar-scrim", p.scrim);
      if (p.scrim || p.scrimRight) root.style.setProperty("--folio-sidebar-scrim-r", p.scrimRight || p.scrim);
      if (p.imgW) this._wallSize = [p.imgW, p.imgH || 9];
    }
    return true;
  },

  // Apply the saved wallpaper (or clear it back to Folio's own colors).
  async apply() {
    const root = document.documentElement;
    // Only the newest call may paint (2026-11-26 bug: switching from a see-through space to a wallpaper space sets two
    // prefs = two calls; the slower desktop one finished last and painted Space 2's purple over Space 1).
    const gen = this._gen = (this._gen || 0) + 1;
    this.watchDesktop();
    const seethrough = Services.prefs.getBoolPref("folio.seethrough", false);
    // Wallpaper spaces: the image itself still loads async; until then the space color must not take the accent.
    this._holdAccent = !!(seethrough || Services.prefs.getStringPref(this.PREF, "")) && this.applyCached(seethrough);
    if (seethrough) return this.applyDesktop(gen);
    if (root.hasAttribute("folio-desktop-palette")) {
      root.removeAttribute("folio-desktop-palette");
      for (const v of ["--folio-sidebar-bg", "--folio-text", "--folio-muted", "--folio-surface", "--folio-grid", "--folio-accent-soft"]) root.style.removeProperty(v);
    }
    this._desktopSig = null;
    const url = await this.urlForSaved();
    if (gen !== this._gen) { if (url) URL.revokeObjectURL?.(url); return; }
    const vars = ["--folio-accent", "--folio-accent-soft", "--folio-sidebar-bg", "--folio-text", "--folio-muted", "--folio-surface", "--folio-grid", "--folio-sidebar-scrim", "--folio-sidebar-scrim-r"];
    if (!url) {
      root.removeAttribute("folio-wallpaper");
      root.style.removeProperty("--folio-wallpaper");
      for (const v of vars) root.style.removeProperty(v);
      this._holdAccent = false;
      FolioSidebar.applyAccent();
      this.publish(null);
      return;
    }
    try {
      const p = await this.palette(url);
      // Decode before the swap, or the window shows no wallpaper for a moment (2026-11-26, big images).
      try { const img = new Image(); img.src = url; await img.decode(); } catch (e) {}
      if (gen !== this._gen) return;
      this.publish(p);
      root.style.setProperty("--folio-accent", p.accent);
      root.style.setProperty("--folio-accent-soft", p.accentSoft);
      root.style.setProperty("--folio-sidebar-bg", p.sidebarBg);
      root.style.setProperty("--folio-text", p.text);
      root.style.setProperty("--folio-muted", p.muted);
      root.style.setProperty("--folio-surface", p.surface);
      root.style.setProperty("--folio-grid", p.grid);
      this._wallSize = [p.imgW || 16, p.imgH || 9];
      root.style.setProperty("--folio-sidebar-scrim", p.scrim);
      root.style.setProperty("--folio-sidebar-scrim-r", p.scrimRight || p.scrim);
      root.style.setProperty("--folio-wallpaper", `url("${url}")`);
      root.setAttribute("folio-wallpaper", "");
      this._holdAccent = false;
      this.remember(this.cacheKey(false), p);
    } catch (e) {
      this._holdAccent = false;
      // The colors could not be read: still show the image, with Folio's own accent (never keep a stale one).
      console.warn("Folio theme:", e);
      for (const v of vars) root.style.removeProperty(v);
      root.style.setProperty("--folio-accent", "#9d8cff");
      root.style.setProperty("--folio-wallpaper", `url("${url}")`);
      root.setAttribute("folio-wallpaper", "");
      this.publish({ accent: "#9d8cff", sidebarBg: "#100f14" });
    }
  },

  // The site skins (WhatsApp, Folio Pages) read this through the bridge (FolioSkins.sys.mjs /state) so every themed
  // site uses the same accent and sidebar color as the browser. Cleared when there is no wallpaper theme.
  publish(p) {
    try {
      if (p) Services.prefs.setStringPref("folio.theme.palette", JSON.stringify({ accent: p.accent, sidebarBg: p.sidebarBg }));
      else Services.prefs.clearUserPref("folio.theme.palette");
    } catch (e) { /* the skins keep their last palette */ }
  },

  // Scale an image and save it as a new wallpaper file; returns its path. A new file name every time: the pref value
  // must change, or the observers (sidebar, new tab) never fire.
  async newWallpaperFile(file) {
    const blob = await this.downscale(file);
    const path = PathUtils.join(PathUtils.profileDir, `folio-wallpaper-${Date.now()}-${Math.floor(Math.random() * 1e4)}.jpg`);
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  },
  // The settings page and the new tab menu set the wallpaper of the CURRENT space.
  async setWallpaper(file) {
    const path = await this.newWallpaperFile(file);
    const old = Services.prefs.getStringPref(this.PREF, "");
    Services.prefs.setStringPref(this.PREF, path);
    FolioSidebar.syncCurrentSpaceFromPrefs();
    FolioSidebar.gcWallpapers([old]);
  },
  clearWallpaper() {
    const old = Services.prefs.getStringPref(this.PREF, "");
    Services.prefs.clearUserPref(this.PREF);
    FolioSidebar.syncCurrentSpaceFromPrefs();
    FolioSidebar.gcWallpapers([old]);
  },
};

window.FolioTheme = FolioTheme;

