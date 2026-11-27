/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// "This site" in the Trust panel (FolioSite). Split out of folio-sidebar.js 2026-11-26, no code change, same load order.

// ---- "This site" in the Trust panel (2026-11-22): per-site permissions and page size in ONE place ----
// Firefox 160's Trust panel already shows who the site is, trackers blocked (+ the per-site switch) and clear-data.
// Folio adds what people ask for most and Firefox keeps elsewhere: this site's permissions (Ask / Allow / Block) and its
// page size. Built with Firefox's own SitePermissions and FullZoom, so it stays in sync with every other Firefox setting.
// Injected when the panel opens (no markup change); skipped on pages without a real web origin.
const FolioSite = {
  PERMS: [
    { id: "camera", label: "Camera" },
    { id: "microphone", label: "Microphone" },
    { id: "geo", label: "Location" },
    { id: "desktop-notification", label: "Notifications" },
    { id: "popup", label: "Pop-ups", noAsk: true },
    { id: "autoplay-media", label: "Autoplay", noAsk: true },
  ],
  principal() {
    const b = gBrowser.selectedBrowser;
    const p = b?.contentPrincipal;
    if (!p || !/^https?:/.test(b.currentURI?.spec || "")) return null;
    return p;
  },
  render() {
    const panel = document.getElementById("trustpanel-popup");
    const anchor = document.getElementById("trustpanel-clear-cookies-footer");
    if (!panel || !anchor) return;
    document.getElementById("folio-site-section")?.remove();
    const principal = this.principal();
    if (!principal) return;
    const browser = gBrowser.selectedBrowser;
    const NS = "http://www.w3.org/1999/xhtml";
    const h = (tag, cls, text) => { const n = document.createElementNS(NS, tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const box = h("div", "folio-site");
    box.id = "folio-site-section";
    box.append(h("div", "folio-site-head", "This site"));
    const SP = SitePermissions;
    for (const perm of this.PERMS) {
      const row = h("div", "folio-site-row");
      row.append(h("span", "folio-site-label", perm.label));
      const seg = h("div", "folio-site-seg");
      const states = perm.noAsk ? [["Allow", SP.ALLOW], ["Block", SP.BLOCK]] : [["Ask", SP.UNKNOWN], ["Allow", SP.ALLOW], ["Block", SP.BLOCK]];
      const draw = () => {
        let cur = SP.UNKNOWN;
        try { cur = SP.getForPrincipal(principal, perm.id, browser).state; } catch (e) {}
        if (perm.noAsk && (cur === SP.UNKNOWN || cur === SP.PROMPT)) cur = SP.getDefault?.(perm.id) === SP.BLOCK ? SP.BLOCK : (perm.id === "popup" ? SP.BLOCK : SP.ALLOW);
        if (cur === SP.PROMPT) cur = SP.UNKNOWN;
        for (const b of seg.children) b.setAttribute("aria-pressed", String(+b.dataset.state === cur));
      };
      for (const [label, state] of states) {
        const b = h("button", "folio-site-opt", label);
        b.dataset.state = String(state);
        b.addEventListener("click", () => {
          try {
            if (state === SP.UNKNOWN) SP.removeFromPrincipal(principal, perm.id, browser);
            else SP.setForPrincipal(principal, perm.id, state, SP.SCOPE_PERSISTENT, browser);
          } catch (e) { console.warn("Folio site permission:", e); }
          draw();
        });
        seg.append(b);
      }
      row.append(seg);
      box.append(row);
      draw();
    }
    // Page size for this site (Firefox remembers it per site).
    const zrow = h("div", "folio-site-row");
    zrow.append(h("span", "folio-site-label", "Page size"));
    const zseg = h("div", "folio-site-seg");
    const pct = h("button", "folio-site-opt folio-site-pct");
    const showZoom = () => { try { pct.textContent = Math.round(ZoomManager.getZoomForBrowser(browser) * 100) + "%"; } catch (e) { pct.textContent = "100%"; } };
    const minus = h("button", "folio-site-opt", "−"), plus = h("button", "folio-site-opt", "+");
    minus.addEventListener("click", async () => { await FullZoom.reduce(); showZoom(); });
    plus.addEventListener("click", async () => { await FullZoom.enlarge(); showZoom(); });
    pct.addEventListener("click", async () => { await FullZoom.reset(); showZoom(); });
    pct.title = "Back to the default size";
    zseg.append(minus, pct, plus);
    zrow.append(zseg);
    box.append(zrow);
    showZoom();
    anchor.before(box);
  },
};
window.FolioSite = FolioSite;
window.addEventListener("popupshowing", (e) => { if (e.target?.id === "trustpanel-popup") { try { FolioSite.render(); } catch (err) { console.warn("Folio site panel:", err); } } }, true);

