// Folio's own palette (FolioTheme in folio-sidebar.js, served by the bridge at /state as `colors`) -> the Material-style
// roles the site skins use. primary = the sidebar's accent and surface = the sidebar's color, exactly, so the browser
// chrome, WhatsApp and every themed site share one palette (no matugen, no second extraction). Needs lib/mcu.js first.
// Same file lives in skins/lib/ and pages/lib/: keep both copies identical.
const FolioPal = (() => {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => "#" + a.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => hex(rgb(a).map((x, i) => x + (rgb(b)[i] - x) * t));
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ok = (c) => c && /^#[0-9a-f]{6}$/i.test(c.accent) && /^#[0-9a-f]{6}$/i.test(c.sidebarBg);
  return {
    ok,
    // Stable key: the extensions recompile when this changes (new wallpaper, or the same wallpaper read differently).
    key: (c) => (ok(c) ? c.accent + c.sidebarBg : ""),
    roles(c) {
      const base = MCU.paletteFromArgb(parseInt("ff" + c.accent.slice(1), 16) >>> 0); // fills every role the styles do not override
      const text = "#f2f0f6";
      return Object.assign(base, {
        primary: c.accent,
        on_primary: lum(c.accent) > 0.35 ? "#14121a" : "#ffffff",
        primary_container: mix(c.sidebarBg, c.accent, 0.3),
        on_primary_container: mix(c.accent, "#ffffff", 0.55),
        surface: c.sidebarBg,
        surface_container_high: mix(c.sidebarBg, "#ffffff", 0.1),
        on_surface: text,
        on_surface_variant: mix(c.sidebarBg, text, 0.6),
      });
    },
  };
})();
