/* Folio actions that Zen has on keys: copy the page link (also as Markdown), close all unpinned tabs, pin or unpin a tab,
   show history. Plus FolioToast: the small animated notice at the top right ("Copied current URL!"). The keys live in
   browser-sets.inc.xhtml (key_folio*), are listed in Settings > Keyboard Shortcuts, and can be changed there. */
(() => {
  let makeIcon = null;
  try { makeIcon = ChromeUtils.importESModule("chrome://browser/content/folio-settings/folio-icons.mjs").makeIcon; } catch (e) { /* the CSS check stays */ }
  const FolioToast = {
    _el: null,
    _timer: null,
    // parts: strings, or { key: "Ctrl+Shift+T" } for a key cap. opts: { timeout, action: { label, run } }
    show(parts, opts = {}) {
      this.hide(true);
      const root = document.documentElement;
      const node = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      node.id = "folio-notice";
      const icon = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
      icon.className = "folio-notice-icon";
      const tick = makeIcon?.(document, "check", { size: 12, strokeWidth: 3.4 });
      if (tick) icon.append(tick); else icon.setAttribute("css-check", "");
      node.append(icon);
      const text = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
      for (const p of [].concat(parts)) {
        if (typeof p === "string") text.append(document.createTextNode(p));
        else {
          const k = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
          k.className = "folio-notice-key";
          k.textContent = p.key;
          text.append(k);
        }
      }
      node.append(text);
      if (opts.action) {
        const b = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
        b.className = "folio-notice-btn";
        b.textContent = opts.action.label;
        b.addEventListener("click", () => { this.hide(); opts.action.run(); });
        node.append(b);
      }
      root.append(node);
      this._el = node;
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        node.animate([
          { opacity: 0, transform: "translateY(-16px) scale(0.93)" },
          { opacity: 1, transform: "none" },
        ], { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        icon.animate([{ transform: "scale(0.3)", opacity: 0 }, { transform: "scale(1.15)", opacity: 1, offset: 0.7 }, { transform: "scale(1)", opacity: 1 }],
          { duration: 420, delay: 110, easing: "ease-out", fill: "backwards" });
      }
      setTimeout(() => icon.firstChild?.folioPlay?.(), 160); // the check draws itself right after the notice lands
      this._timer = setTimeout(() => this.hide(), opts.timeout || 2600);
    },
    hide(now) {
      clearTimeout(this._timer);
      const node = this._el;
      this._el = null;
      if (!node) return;
      if (now || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { node.remove(); return; }
      node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px) scale(0.96)" }],
        { duration: 190, easing: "ease-in", fill: "forwards" }).onfinish = () => node.remove();
    },
  };

  const keyText = (id) => {
    const el = document.getElementById(id);
    try { return el ? ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs").ShortcutUtils.prettifyShortcut(el) : ""; } catch (e) { return ""; }
  };

  const FolioActions = {
    // Copy the current page's address (all selected tabs, one per line). markdown = [title](address).
    copyURL(markdown) {
      const tabs = (gBrowser.selectedTabs?.length ? gBrowser.selectedTabs : [gBrowser.selectedTab]).filter(Boolean);
      const lines = tabs.map((t) => {
        let url = t.linkedBrowser?.currentURI?.displaySpec || "";
        if ((!url || url === "about:blank") && !t.selected) {
          try { url = JSON.parse(SessionStore.getTabState(t)).entries.at(-1).url || url; } catch (e) { /* keep */ }
        }
        const title = (t.label || url).replace(/[\[\]]/g, "\\$&");
        return markdown ? `[${title}](${url})` : url;
      });
      Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(lines.join("\n"));
      const n = lines.length;
      FolioToast.show(markdown
        ? (n === 1 ? "Copied current URL as Markdown!" : `Copied ${n} URLs as Markdown!`)
        : (n === 1 ? "Copied current URL!" : `Copied ${n} URLs!`));
      return lines;
    },

    // Close every tab of this space that is not pinned. Undo puts them all back.
    closeUnpinned() {
      const S = window.FolioSidebar;
      const tabs = S.liveTabs(S.currentSpaceId()).filter((t) => !t.pinned);
      if (!tabs.length) { FolioToast.show("No unpinned tabs to close."); return 0; }
      const n = tabs.length;
      for (const t of tabs) S.closeTabSafely(t);
      S.renderTabs();
      FolioToast.show(n === 1 ? "Tab closed!" : `${n} tabs closed!`, {
        timeout: 6500,
        action: { label: "Undo", run: () => { for (let i = 0; i < n; i++) { try { SessionStore.undoCloseTab(window, 0); } catch (e) { break; } } } },
      });
      return n;
    },

    togglePin() {
      const t = gBrowser.selectedTab;
      if (!t || t.folioPlaceholder) return;
      if (t.pinned) gBrowser.unpinTab(t); else gBrowser.pinTab(t);
      window.FolioSidebar?.renderTabs();
    },

    toggleHistory() { window.FolioSidebar?.toggleView("history"); },
  };
  window.FolioToast = FolioToast;
  window.FolioActions = FolioActions;

  // Ctrl+T again on a fresh new tab closes it (Sammy, 2026-11-25): the second press is "never mind".
  window.addEventListener("keydown", (e) => {
    if (e.key?.toLowerCase() !== "t" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    const t = gBrowser.selectedTab;
    if (t?.linkedBrowser?.currentURI?.spec !== "about:folio-newtab") return;
    // Only when this space has another tab to go back to: closing a space's only tab quit Folio (2026-11-26).
    const S = window.FolioSidebar;
    const inSpace = S ? S.liveTabs(S.currentSpaceId()) : [...gBrowser.visibleTabs];
    if (inSpace.filter(x => x !== t).length < 1) return;
    if (t.linkedBrowser.canGoBack) return;
    e.preventDefault(); e.stopPropagation();
    gBrowser.removeTab(t, { animate: true });
  }, true);

  const set = document.getElementById("mainCommandSet") || document.documentElement;
  const mk = (id, fn) => {
    if (document.getElementById(id)) return;
    const c = document.createXULElement("command");
    c.id = id;
    c.addEventListener("command", fn);
    set.append(c);
  };
  mk("Folio:CopyURL", () => FolioActions.copyURL(false));
  mk("Folio:CopyURLMarkdown", () => FolioActions.copyURL(true));
  mk("Folio:CloseUnpinned", () => FolioActions.closeUnpinned());
  mk("Folio:TogglePin", () => FolioActions.togglePin());
  mk("Folio:ToggleHistory", () => FolioActions.toggleHistory());
})();
