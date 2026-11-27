/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Peek (hidden sidebar slides in) + exit motion. Split out of folio-sidebar.js 2026-11-26, no code change, same load order.

// ---- Peek: the hidden sidebar slides in from the left edge (night shift 2026-11-24; Arc's and Zen's compact mode) ----
// With the sidebar hidden (Compact layout, or Ctrl+Alt+S) there was no way to see your tabs: Firefox's own tab strip
// is replaced by Folio's list. Now touching the window's left edge floats the sidebar over the page; moving away hides
// it again after a short grace (not while one of its menus is open). Off in fullscreen.
const FolioPeek = {
  init() {
    if (typeof gBrowser == "undefined" || !document.getElementById("folio-sidebar") || !document.body) {
      setTimeout(() => this.init(), 200);
      return;
    }
    const side = document.getElementById("folio-sidebar");
    const edge = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    edge.id = "folio-edge";
    document.body.append(edge);
    // Helium's frameless reveal (imputnet/helium patches/helium/ui/layout/zen-mode.patch, 2026-11-24): a 6 px trigger
    // that opens with NO delay, and leaving the window through its left edge counts as the trigger too (a quick flick
    // to the side skips the 6 px, especially with Hyprland gaps). It closes 150 ms after the pointer is out of the
    // sidebar (+8 px leeway, the #folio-sidebar::after ring), but stays 3 s when the pointer left the window, so an
    // overshoot doesn't snap it shut. The window losing focus closes it at once.
    const hidden = () => document.documentElement.hasAttribute("folio-sidebar-hidden") && !document.documentElement.hasAttribute("inFullscreen");
    edge.addEventListener("mouseenter", () => this.schedule(true, 0));
    edge.addEventListener("mouseleave", () => { if (!this.on) this.cancel(); });
    window.addEventListener("mouseout", (e) => {
      if (e.relatedTarget || !hidden()) return; // still inside the window
      const out = e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
      const right = Services.prefs.getBoolPref("folio.sidebar.right", false);
      const atEdge = right ? e.clientX >= window.innerWidth - 6 : e.clientX < 6;
      if (!out && !atEdge) return;
      if (atEdge && e.clientY > 0 && e.clientY < window.innerHeight) this.schedule(true, 0);
      else if (this.on) this.schedule(false, this.EXIT_GRACE_MS);
    }, true);
    side.addEventListener("mouseenter", () => this.cancel());
    side.addEventListener("mouseleave", (e) => {
      if (!this.on) return;
      const left = !e.relatedTarget && (e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight);
      this.schedule(false, left ? this.EXIT_GRACE_MS : this.HOVER_GRACE_MS);
    });
    window.addEventListener("deactivate", () => { if (this.on) { this.cancel(); this.show(false); } });
    // Showing the sidebar for real ends the peek; so does fullscreen.
    new MutationObserver(() => {
      const root = document.documentElement;
      if (!root.hasAttribute("folio-sidebar-hidden") || root.hasAttribute("inFullscreen")) this.show(false, true);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["folio-sidebar-hidden", "inFullscreen"] });
  },
  on: false,
  _t: null,
  HOVER_GRACE_MS: 150, // Helium kZenModeHoverExitGracePeriod
  EXIT_GRACE_MS: 3000, // Helium kZenModeCursorExitGracePeriod (pointer left the window)
  SLIDE_MS: 200, // Helium kZenModeRevealAnimationDuration, show and hide
  cancel() { clearTimeout(this._t); this._t = null; },
  schedule(on, ms) {
    // Helium doesn't restart a running hide timer; neither do we (a 3 s exit grace isn't cut short by a later 150 ms one).
    if (!on && this._t && this._hiding) return;
    this.cancel();
    this._hiding = !on;
    if (on && ms === 0) { this.show(true); return; }
    this._t = setTimeout(() => {
      this._t = null;
      // Keep it open while a Folio menu (tab menu, space menu) or a sidebar popup is up.
      if (!on && (document.querySelector(".folio-menu:not(.folio-menu-closing)") || document.querySelector("#folio-sidebar menupopup[state=open]"))) {
        this.schedule(false, 400);
        return;
      }
      this.show(on);
    }, ms);
  },
  // Slides in from off the left edge (fast start, soft landing) and slides back out on leave. Moving back in while it
  // leaves reverses it from where it is. `instant` = no slide (the real sidebar is opening, or fullscreen).
  _anim: null,
  show(on, instant = false) {
    const root = document.documentElement;
    const side = document.getElementById("folio-sidebar");
    if (on && !root.hasAttribute("folio-sidebar-hidden")) return;
    const settle = () => {
      if (this._anim) {
        this._anim.onfinish = null;
        this._anim.cancel();
        this._anim = null;
      }
      if (!this.on) root.removeAttribute("folio-peek");
    };
    if (instant || !side) {
      this.on = on;
      settle();
      if (on) root.setAttribute("folio-peek", "");
      return;
    }
    if (on === this.on) return;
    this.on = on;
    if (on) {
      const top = Math.round(document.getElementById("navigator-toolbox")?.getBoundingClientRect().bottom || 0);
      root.style.setProperty("--folio-peek-top", (top + 6) + "px");
      root.style.setProperty("--folio-peek-w", Services.prefs.getIntPref("folio.sidebar.width", 260) + "px");
      root.setAttribute("folio-peek", "");
      // Wallpaper inside the floating sidebar: drawn at the window's "cover" size and shifted by where the panel
      // rests, so it is exactly the part of the wallpaper behind it, and it slides in already lined up (2026-11-26:
      // with background-attachment fixed it showed another part of the picture while moving, then snapped = a flash).
      const [iw, ih] = window.FolioTheme?._wallSize || [16, 9];
      const W = window.innerWidth, H = window.innerHeight, a = iw / ih;
      const cw = W / H > a ? W : H * a, ch = W / H > a ? W / a : H;
      const pw = Services.prefs.getIntPref("folio.sidebar.width", 260);
      const left = Services.prefs.getBoolPref("folio.sidebar.right", false) ? W - 8 - pw : 8;
      side.style.setProperty("--folio-peek-bgsize", `${cw}px ${ch}px`);
      side.style.setProperty("--folio-peek-bgpos", `${(W - cw) / 2 - left}px ${(H - ch) / 2 - (top + 6)}px`);
    }
    // Mid-slide: turn the running slide around instead of starting over.
    if (this._anim && this._anim.playState === "running") {
      this._anim.reverse();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settle();
      return;
    }
    // Helium: a pure slide from fully off the left edge (no fade), 200 ms both ways, gfx::Tween::FAST_OUT_SLOW_IN_3
    // = cubic-bezier(0.2, 0, 0, 1).
    const outside = { transform: Services.prefs.getBoolPref("folio.sidebar.right", false) ? "translateX(calc(100% + 10px))" : "translateX(calc(-100% - 10px))" };
    const inside = { transform: "translateX(0)" };
    const anim = side.animate(on ? [outside, inside] : [inside, outside], {
      duration: this.SLIDE_MS,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      fill: "forwards",
    });
    this._anim = anim;
    anim.onfinish = () => {
      if (this._anim === anim) settle();
    };
  },
};
window.FolioPeek = FolioPeek;
FolioPeek.init();

// ---- Exit motion for things that used to vanish in one frame (2026-11-24) ----
// 1. The floating address bar (sidebar layout): it lifts out to the middle of the page with an ease-in (CSS), but
//    closing snapped it back into the sidebar. Now it glides from where it floated into its slot (FLIP: measure the
//    floating box while open, then animate the docked bar from that offset to zero).
// 2. Find in page: Firefox's findbar.close() hides it at once. Wrapped so it fades and lifts away first (140 ms);
//    opening again mid-fade cancels the close. close(true) ("no animation") stays instant.
const FolioExitMotion = {
  reduced: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  init() {
    const urlbar = document.getElementById("urlbar");
    if (!urlbar || typeof customElements == "undefined") {
      setTimeout(() => this.init(), 200);
      return;
    }
    const root = document.documentElement;
    const floating = () => root.hasAttribute("folio-sidebar-toolbar") && !root.hasAttribute("folio-sidebar-toolbar-bottom");
    let last = null;
    const remember = () => {
      if (urlbar.hasAttribute("open") && floating()) last = urlbar.getBoundingClientRect();
    };
    new ResizeObserver(remember).observe(urlbar);
    window.addEventListener("resize", remember);
    new MutationObserver(() => {
      if (urlbar.hasAttribute("open")) {
        requestAnimationFrame(remember);
        return;
      }
      const from = last;
      last = null;
      if (!from || !floating() || this.reduced()) return;
      const to = urlbar.getBoundingClientRect();
      const dx = from.left - to.left, dy = from.top - to.top;
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      urlbar.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.4 }, { transform: "none", opacity: 1 }],
        { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    }).observe(urlbar, { attributes: true, attributeFilter: ["open"] });

    // findbar is a lazily defined custom element, and whenDefined() never fires for it in this window (tested), so wrap
    // it when Firefox creates a tab's find bar (TabFindInitialized, sent before the bar opens) and on the off chance
    // it is already defined.
    window.addEventListener("TabFindInitialized", () => this.wrapFindbar(), true);
    this.wrapFindbar();
  },
  wrapFindbar() {
    const Findbar = customElements.get("findbar");
    if (Findbar && !Findbar.prototype._folioClose) {
      const proto = Findbar.prototype;
      proto._folioClose = proto.close;
      proto._folioOpen = proto.open;
      proto.close = function (noAnim) {
        if (this.hidden || noAnim || this._folioLeaving || FolioExitMotion.reduced()) {
          if (noAnim && this._folioLeaving) { this._folioLeaving.cancel(); this._folioLeaving = null; }
          if (!this._folioLeaving) return this._folioClose(noAnim);
          return undefined; // already fading out
        }
        const a = this.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px) scale(0.98)" }],
          { duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
        this._folioLeaving = a;
        a.finished.then(() => {
          if (this._folioLeaving !== a) return;
          this._folioLeaving = null;
          this._folioClose(noAnim);
          a.cancel();
        }, () => {});
        return undefined;
      };
      proto.open = function (...args) {
        if (this._folioLeaving) { const a = this._folioLeaving; this._folioLeaving = null; a.cancel(); }
        return this._folioOpen(...args);
      };
    }
  },
};
window.FolioExitMotion = FolioExitMotion;
FolioExitMotion.init();

