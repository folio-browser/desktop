/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio Share (2026-11-25, Zen's tab sharing from Sammy's reference video): a small card from the tab menu with a QR code
 * of the page (Firefox's own generator, nothing leaves the computer), Copy link, Copy as Markdown, and Copy all links
 * of the tab's folder. */

var FolioShare = {
  open(tab) {
    document.getElementById("folio-share-card")?.remove();
    const url = tab?.linkedBrowser?.currentURI?.displaySpec || "";
    if (!/^https?:/.test(url)) return;
    const S = window.FolioSidebar;
    const NS = "http://www.w3.org/1999/xhtml";
    const el = (tag, attrs = {}, ...kids) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
      n.append(...kids);
      return n;
    };
    const copy = (text, toast) => {
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
      window.FolioToast?.show(toast);
      close();
    };
    const title = (tab.label || url).replace(/[\[\]]/g, "\\$&");
    const qr = el("img", { class: "folio-share-qr", alt: "QR code of this page" });
    const folderId = S?.tabFolder?.(tab);
    const folderTabs = folderId ? S.realTabs().filter(t => S.tabFolder(t) === folderId && /^https?:/.test(t.linkedBrowser?.currentURI?.spec || "")) : [];
    const card = el("div", { id: "folio-share-card", role: "dialog", "aria-label": "Share" },
      el("div", { class: "folio-share-head" }, el("div", { class: "folio-route-title" }, "Share"), el("div", { class: "folio-share-url" }, url.replace(/^https?:\/\//, ""))),
      qr,
      el("div", { class: "folio-share-actions" },
        el("button", { type: "button", onclick: () => copy(url, "Copied link!") }, "Copy link"),
        el("button", { type: "button", onclick: () => copy(`[${title}](${url})`, "Copied as Markdown!") }, "Copy as Markdown"),
        ...(folderTabs.length > 1 ? [el("button", { type: "button", onclick: () => copy(folderTabs.map(t => t.linkedBrowser.currentURI.displaySpec).join("\n"), `Copied ${folderTabs.length} links!`) }, `Copy all ${folderTabs.length} links in this folder`)] : [])));
    const close = () => { card.remove(); window.removeEventListener("keydown", keys, true); window.removeEventListener("pointerdown", off, true); };
    const keys = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const off = e => { if (!card.contains(e.target)) close(); };
    window.addEventListener("keydown", keys, true);
    setTimeout(() => window.addEventListener("pointerdown", off, true), 0);
    document.body.append(card);
    ChromeUtils.importESModule("moz-src:///browser/components/qrcode/QRCodeGenerator.sys.mjs").QRCodeGenerator
      .generateQRCode(url).then(src => { if (card.isConnected) qr.src = src; }, () => qr.remove());
  },
};
window.FolioShare = FolioShare;
