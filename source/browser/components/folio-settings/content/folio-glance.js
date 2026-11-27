/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio Glance (2026-11-25, Zen's Glance as seen in Sammy's reference video): Alt+click a link and it opens in a
 * floating card over the current page; the page behind dims. Round buttons on the card's left edge: close, open as a
 * tab. Esc or a click on the dimmed area closes it. The card grows out of the click point.
 * The link reaches us from ClickHandlerChild/Parent (data.folioGlance). The preview is a standalone content browser
 * made by gBrowser.createBrowser, so it gets the right process and site isolation like a tab. v1 "open as tab" loads
 * the URL in a new tab (a reload); moving the live page over without a reload is a follow-up. */

var FolioGlance = {
  _box: null,
  _browser: null,
  _keys: null,

  open(url, opts = {}) {
    if (!url || !/^https?:/i.test(url)) return;
    this.close(true);
    const NS = "http://www.w3.org/1999/xhtml";
    const tabbox = document.getElementById("tabbrowser-tabbox");
    const r = tabbox?.getBoundingClientRect() || { left: 0, top: 0, width: innerWidth, height: innerHeight };

    const box = document.createElementNS(NS, "div");
    box.id = "folio-glance";
    box.style.left = r.left + "px";
    box.style.top = r.top + "px";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    const shade = document.createElementNS(NS, "div");
    shade.className = "folio-glance-shade";
    shade.addEventListener("click", () => this.close());
    const card = document.createElementNS(NS, "div");
    card.className = "folio-glance-card";
    const rail = document.createElementNS(NS, "div");
    rail.className = "folio-glance-rail";
    const button = (cls, label, fn) => {
      const b = document.createElementNS(NS, "button");
      b.className = "folio-glance-btn " + cls;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", fn);
      return b;
    };
    rail.append(button("close", "Close", () => this.close()), button("expand", "Open as a tab (Ctrl+Enter)", () => this.expand()));

    // Starts in the default web process; with maychangeremoteness the first load moves it to the site's own isolated
    // process, exactly like a tab (Firefox 160 picks processes in C++). Same container as the page it came from.
    const { E10SUtils } = ChromeUtils.importESModule("resource://gre/modules/E10SUtils.sys.mjs");
    const userContextId = opts.userContextId || 0;
    const b = gBrowser.createBrowser({ remoteType: E10SUtils.DEFAULT_REMOTE_TYPE, userContextId });
    b.setAttribute("maychangeremoteness", "true");
    b.classList.add("folio-glance-browser");
    card.append(b);
    box.append(shade, card, rail);
    document.body.append(box);
    this._box = box;
    this._browser = b;

    b.docShellIsActive = true;
    b.fixupAndLoadURIString(url, {
      triggeringPrincipal: opts.triggeringPrincipal || Services.scriptSecurityManager.createNullPrincipal({ userContextId }),
    });

    // Grow out of the click point (screen -> window coordinates), Helium/Zen-style easing.
    const ox = (opts.screenX ?? (window.screenX + r.left + r.width / 2)) - window.mozInnerScreenX - r.left;
    const oy = (opts.screenY ?? (window.screenY + r.top + r.height / 2)) - window.mozInnerScreenY - r.top;
    box.style.setProperty("--glance-ox", Math.round(ox) + "px");
    box.style.setProperty("--glance-oy", Math.round(oy) + "px");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.animate([{ transform: "scale(0.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
        { duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      rail.animate([{ opacity: 0, transform: "translateX(8px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, delay: 120, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" });
    }
    requestAnimationFrame(() => card.setAttribute("open", ""));

    this._keys = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
      // Ctrl+Enter (Cmd+Enter): open the card as a tab.
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); e.stopPropagation(); this.expand(); }
    };
    window.addEventListener("keydown", this._keys, true);
  },

  // Open what the card shows (its current URL, after any navigation inside it) as a normal tab next to this one.
  // The card's page becomes a real tab WITHOUT reloading (same page, same scroll, same video position): a new tab is
  // made in the same process and the two browsers swap their pages. If anything about that fails, it falls back to
  // opening the URL in a tab (a reload).
  expand() {
    const b = this._browser;
    if (!b) return;
    const url = b.currentURI?.spec;
    if (!url || url === "about:blank") { this.close(true); return; }
    let tab = null;
    try {
      tab = gBrowser.addTab("about:blank", {
        skipLoad: true, relatedToCurrent: true, ownerTab: gBrowser.selectedTab,
        remoteType: b.remoteType, userContextId: b.getAttribute("usercontextid") | 0,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      gBrowser._insertBrowser?.(tab);
      const nb = tab.linkedBrowser;
      if (!nb) throw new Error("no browser");
      nb.swapDocShells(b);
      gBrowser.selectedTab = tab;
      try { gBrowser.setTabTitle?.(tab); } catch (e) {}
      if (nb.contentTitle) tab.setAttribute("label", nb.contentTitle);
      gURLBar.setURI?.();
      this.close(true);
      return;
    } catch (e) {
      console.warn("Folio Glance: swap failed, reopening", e);
      if (tab) try { gBrowser.removeTab(tab, { animate: false }); } catch (e2) {}
    }
    this.close(true);
    openTrustedLinkIn(url, "tab", { relatedToCurrent: true });
  },

  close(instant = false) {
    const box = this._box;
    if (!box) return;
    this._box = null;
    const b = this._browser;
    this._browser = null;
    if (this._keys) window.removeEventListener("keydown", this._keys, true);
    this._keys = null;
    const done = () => box.remove(); // removing the <browser> tears down its content process side
    if (instant || matchMedia("(prefers-reduced-motion: reduce)").matches) { done(); return; }
    box.style.pointerEvents = "none";
    b?.parentNode?.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.94)", opacity: 0 }],
      { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
    const a = box.querySelector(".folio-glance-shade")?.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: 170, easing: "ease-in", fill: "forwards" });
    if (a) a.onfinish = done; else done();
  },
};
window.FolioGlance = FolioGlance;
