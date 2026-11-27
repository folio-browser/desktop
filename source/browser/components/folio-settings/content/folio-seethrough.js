/* Folio: See-through window (Zen-style transparency).
   The window itself is transparent; the OS (Hyprland/KDE blur, Windows Mica/Acrylic) blurs what is behind it.
   Two tint layers: the whole window at "sidebar opacity", and the page card on top, sized so that the page's
   TOTAL opacity equals "page opacity" (never less than the sidebar's, like Zen).
   Prefs: folio.seethrough (bool), .sidebar / .page (int 0-100), .accent (bool: tint with the space color),
          .material ("acrylic" | "mica", Windows only). */
(() => {
  const P = "folio.seethrough";
  const prefs = Services.prefs;
  const root = document.documentElement;
  const getInt = (n, d) => prefs.getIntPref(`${P}.${n}`, d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Once: page/sidebar values saved with the old heavy look come down to the new defaults (a later choice is kept).
  if (!prefs.getBoolPref(`${P}.tzLook2`, false)) {
    prefs.setBoolPref(`${P}.tzLook2`, true);
    prefs.clearUserPref(`${P}.page`);
    prefs.clearUserPref(`${P}.sidebar`);
  }

  function apply() {
    const on = prefs.getBoolPref(P, false);
    // Transparent Zen's look (2026-11-26, Sammy: "Folio is VERY white, and very dark in dark mode"): thin glass that keeps
    // the wallpaper's colors, tinted with the space color, in both modes. The old light floor (72/82% white) washed the
    // wallpaper out and the old dark page (62% black) buried it. Light keeps a small floor so dark text still reads.
    const light = root.hasAttribute("folio-light");
    // Measured against Zen + the Transparent Zen mod on the same compositor: its chrome has almost no tint (the blur does
    // the work) and the page area adds nothing on top. Dark defaults 8% / 10%. Light needs a frost for dark text over a dark wallpaper: 16% / 24% (no lower).
    const sidebar = clamp(Math.max(clamp(getInt("sidebar", 8), 0, 95) / 100, light ? 0.16 : 0), 0, light ? 0.3 : 0.95);
    const page = clamp(Math.max(clamp(getInt("page", 10), 0, 100) / 100, light ? 0.24 : 0), 0, light ? 0.34 : 1);
    // Layer maths: total = s + c * (1 - s)  =>  c = (total - s) / (1 - s)
    const card = sidebar >= 1 ? 0 : clamp((Math.max(page, sidebar) - sidebar) / (1 - sidebar), 0, 1);
    root.toggleAttribute("folio-seethrough", on);
    root.style.setProperty("--folio-st-sidebar", String(sidebar));
    root.style.setProperty("--folio-st-card", card.toFixed(4));
    root.style.setProperty("--folio-st-accentmix", prefs.getBoolPref(`${P}.accent`, true) ? (light ? "16%" : "22%") : "0%");

    // Tell every open page (their processes do not see pref changes).
    try {
      for (const b of gBrowser.browsers) {
        try { b.browsingContext?.currentWindowGlobal?.getActor("FolioSeeThrough").sendAsyncMessage("Folio:SeeThrough"); } catch (e) { /* page without the actor: about:, chrome, file */ }
      }
    } catch (e) { /* tabbrowser not ready yet: pages read the pref when they load */ }

    // Websites follow the dark glass too (a light site on dark glass = dark text on dark). Per tab, so the saved
    // website appearance (Light / Dark / System) is untouched and returns when see-through is off.
    syncScheme(on);

    // Let web pages show through (they only do where the page itself paints no background).
    if (prefs.getBoolPref("browser.tabs.allow_transparent_browser", false) !== on) {
      prefs.setBoolPref("browser.tabs.allow_transparent_browser", on);
    }
    try {
      for (const b of gBrowser.browsers) {
        if (on) b.setAttribute("transparent", "true");
        else b.removeAttribute("transparent");
      }
    } catch (e) { /* tabbrowser not ready yet; new tabs read the pref */ }

    // Windows: Mica / Acrylic is the OS blur. (Linux: the compositor does it, nothing to set here.)
    if (AppConstants.platform === "win") {
      const acrylic = prefs.getStringPref(`${P}.material`, "acrylic") === "acrylic";
      prefs.setBoolPref("widget.windows.mica", on);
      prefs.setIntPref("widget.windows.mica.toplevel-backdrop", acrylic ? 2 : 1);
    }
  }

  function schemeFor(browser, on) {
    try {
      const bc = browser?.browsingContext;
      const want = on ? "dark" : "none";
      if (bc && bc.prefersColorSchemeOverride !== want) bc.prefersColorSchemeOverride = want;
    } catch (e) { /* not a top-level content browser */ }
  }
  function syncScheme(on) {
    try { for (const b of gBrowser.browsers) schemeFor(b, on); } catch (e) { /* tabbrowser not ready yet */ }
  }
  // New tabs and pages that changed process get a new browsing context: set it again when they navigate.
  const schemeListener = {
    onLocationChange(browser) { schemeFor(browser, prefs.getBoolPref(P, false)); },
  };
  const hookTabs = () => { try { gBrowser.addTabsProgressListener(schemeListener); syncScheme(prefs.getBoolPref(P, false)); } catch (e) {} };
  if (document.readyState === "complete") hookTabs(); // never touch gBrowser before load (lazy getters cache null)
  else window.addEventListener("load", hookTabs, { once: true });

  // Websites: a window actor (no add-on involved) makes big opaque page backgrounds transparent while this is on.
  try {
    ChromeUtils.registerWindowActor("FolioSeeThrough", {
      parent: { esModuleURI: "resource:///modules/FolioSeeThroughParent.sys.mjs" },
      child: { esModuleURI: "resource:///modules/FolioSeeThroughChild.sys.mjs", events: { DOMContentLoaded: {}, pageshow: {} } },
      allFrames: false,
      matches: ["http://*/*", "https://*/*"],
      safeForUntrustedWebProcess: true,  // it only edits its own page's styles and has no parent side to attack
    });
  } catch (e) { /* another window registered it already */ }

  const observer = { observe: () => apply() };
  prefs.addObserver(P, observer);
  // browser.tabs.allow_transparent_browser is written by apply() itself, so it is not observed (no loop).
  window.addEventListener("unload", () => prefs.removeObserver(P, observer), { once: true });
  window.FolioSeeThrough = { apply };
  new MutationObserver(() => apply()).observe(root, { attributes: true, attributeFilter: ["folio-light"] });
  apply();
})();
