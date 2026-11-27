/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio "Zen" (2026-11-25; the element zapper from Sammy's Zen reference video, renamed "Zen" by Sammy): hide any part
 * of a page. In Zen mode, hovering outlines an element and a click makes it shrink and fade away; a pill at the bottom
 * ("✕ 2 · Click to Unzen") lists what's hidden: hovering a chip shows that element again in place, clicking brings it
 * back for good. Hidden elements are remembered per site (FolioZenParent) and hidden at document start through a USER
 * sheet, so they never flash. All UI lives in a closed shadow root so the page's CSS can't touch it. */

export class FolioZenChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "DOMDocElementInserted" && event.target === this.document) {
      this.loadRules();
      this.watchSwipe();
    }
  }

  // Shift + swipe left/right moves to the space on that side (Sammy, 2026-11-25). PASSIVE listener: it can never hold
  // up scrolling. Only clearly sideways movement counts; one swipe = one space (cooldown).
  // Shift + scroll (up/down) switches spaces, like Zen (Sammy, 2026-11-25; replaced the swipe/gesture). The page only
  // reports the scroll; the browser window draws the accent line and decides. PASSIVE: it never holds up scrolling.
  // Folio sets mousewheel.with_shift.action = 0, so Shift + scroll no longer scrolls pages sideways.
  watchSwipe() {
    const win = this.contentWindow;
    if (!win || this.browsingContext.parent) return;
    win.addEventListener("wheel", e => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1);
      // The browser window gets this same scroll event itself (folio-zen.js), so nothing is sent from here.
      void d;
    }, { passive: true, capture: true });
  }

  receiveMessage(msg) {
    if (msg.name === "Start") {
      this.sendQuery("Accent").then(a => { if (a) this._accent = a; }, () => {}).finally(() => this.start());
    }
    else if (msg.name === "Stop") this.stop();
    return null;
  }

  get host() {
    try { return this.document.location.host; } catch (e) { return ""; }
  }

  async loadRules() {
    if (!/^https?:/.test(this.document?.documentURI || "")) return;
    this._rules = (await this.sendQuery("Get", { host: this.host })) || [];
    this.applySheet();
  }

  // One rule per selector: an invalid selector must not void the others.
  applySheet() {
    const win = this.contentWindow;
    if (!win) return;
    const u = win.windowUtils;
    if (this._sheet) { try { u.removeSheetUsingURIString(this._sheet, u.USER_SHEET); } catch (e) {} this._sheet = null; }
    const shown = new Set(this._peekAll || []);
    const rules = (this._rules || []).filter(s => !shown.has(s));
    if (!rules.length) return;
    this._sheet = "data:text/css;charset=utf-8," + encodeURIComponent(rules.map(s => s + "{display:none!important}").join("\n"));
    try { u.loadSheetUsingURIString(this._sheet, u.USER_SHEET); } catch (e) {}
  }

  // A selector that finds this element again on the next visit: an id, or a short path of tag + stable classes +
  // :nth-of-type from the nearest ancestor with an id (or the body).
  selectorFor(el) {
    const doc = this.document;
    const esc = s => this.contentWindow.CSS.escape(s);
    const stable = c => c && c.length < 40 && !/\d{3,}|^(is-|has-|js-)|active|hover|open|show|visible/i.test(c);
    if (el.id && !/\d{4,}/.test(el.id) && doc.querySelectorAll("#" + esc(el.id)).length === 1) return "#" + esc(el.id);
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== doc.body && parts.length < 6) {
      let part = n.localName;
      const cls = [...n.classList].filter(stable).slice(0, 2);
      if (cls.length) part += "." + cls.map(esc).join(".");
      const sibs = n.parentElement ? [...n.parentElement.children].filter(x => x.localName === n.localName) : [];
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(part);
      if (n.parentElement?.id && !/\d{4,}/.test(n.parentElement.id)) { parts.unshift("#" + esc(n.parentElement.id)); break; }
      n = n.parentElement;
    }
    return parts.join(" > ");
  }

  // ---- Zen mode UI ----
  // Built with createElement + element.style + Element.animate only: no HTML strings (YouTube enforces Trusted Types,
  // which blocked the first version's innerHTML) and no <style> (page CSPs can block those). Lives in a closed shadow
  // root so the page's CSS can't reach it.
  mk(tag, style = {}, text = "") {
    const n = this.document.createElement(tag);
    Object.assign(n.style, style);
    if (text) n.textContent = text;
    return n;
  }

  start() {
    if (this._ui) return;
    const doc = this.document;
    const win = this.contentWindow;
    if (!doc?.documentElement) return;
    const ACCENT = this._accent || "#9d8cff";
    const host = doc.createElement("folio-zen");
    Object.assign(host.style, { all: "initial", position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483646" });
    const root = host.attachShadow({ mode: "closed" });
    const box = this.mk("div", { position: "fixed", pointerEvents: "none", borderRadius: "8px", display: "none",
      outline: `2px solid ${ACCENT}`, background: "rgba(157,140,255,0.12)", boxShadow: `0 0 0 4px rgba(157,140,255,0.18), 0 0 24px rgba(157,140,255,0.35)`,
      transition: "left .12s cubic-bezier(.2,0,0,1), top .12s cubic-bezier(.2,0,0,1), width .12s cubic-bezier(.2,0,0,1), height .12s cubic-bezier(.2,0,0,1)" });
    const ghosts = this.mk("div", { position: "fixed", inset: "0", pointerEvents: "none" });
    const pill = this.mk("div", { position: "fixed", left: "50%", bottom: "22px", transform: "translateX(-50%)", pointerEvents: "auto",
      display: "flex", alignItems: "center", gap: "8px", padding: "6px 16px 6px 6px", borderRadius: "999px",
      font: "600 13px/1 system-ui, sans-serif", color: "#f1f1f4", background: "rgba(24,24,30,0.94)",
      boxShadow: "0 12px 36px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08)", backdropFilter: "blur(14px)" });
    pill.setAttribute("role", "toolbar");
    pill.setAttribute("aria-label", "Zen");
    const x = this.mk("button", { all: "unset", width: "26px", height: "26px", borderRadius: "999px", display: "grid", placeItems: "center",
      background: "rgba(255,255,255,.1)", fontSize: "12px", cursor: "default" }, "✕");
    x.title = "Done (Esc)";
    x.addEventListener("mouseenter", () => { x.style.background = "rgba(255,255,255,.22)"; });
    x.addEventListener("mouseleave", () => { x.style.background = "rgba(255,255,255,.1)"; });
    x.addEventListener("click", e => { e.stopPropagation(); this.stop(); });
    const chips = this.mk("span", { display: "flex", gap: "5px" });
    const hint = this.mk("span", { opacity: ".78", fontWeight: "500", whiteSpace: "nowrap" });
    pill.append(x, chips, hint);
    root.append(ghosts, box, pill);
    doc.documentElement.append(host);
    this._ui = { host, root, box, pill, chips, hint, ghosts, accent: ACCENT };
    pill.animate([{ opacity: 0, transform: "translate(-50%, 14px) scale(.96)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }],
      { duration: 260, easing: "cubic-bezier(.2,0,0,1)" });
    // Hovering the pill (not a chip) shows EVERY hidden element as a ghost in place, like the video's unzap bar.
    pill.addEventListener("mouseenter", () => this.showGhosts(true));
    pill.addEventListener("mouseleave", () => this.showGhosts(false));
    this.renderPill();

    const target = e => {
      const el = doc.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === host || el === doc.documentElement || el === doc.body) return null;
      return el;
    };
    this._move = e => {
      if (e.composedPath().includes(host)) return;
      const el = target(e);
      if (!el) { box.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    };
    this._click = e => {
      if (e.composedPath().includes(host)) return;
      const el = target(e);
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (!el) return;
      box.style.display = "none";
      const sel = this.selectorFor(el);
      this.sparks(e.clientX, e.clientY);
      // Dissolve: shrink toward the click, blur and fade; then the site's sheet hides it for good.
      const r = el.getBoundingClientRect();
      el.style.transformOrigin = `${e.clientX - r.left}px ${e.clientY - r.top}px`;
      const a = el.animate([
        { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
        { transform: "scale(.96)", opacity: .8, filter: "blur(1px)", offset: .25 },
        { transform: "scale(.6)", opacity: 0, filter: "blur(8px)" },
      ], { duration: 380, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
      a.onfinish = async () => {
        this._rules = (await this.sendQuery("Add", { host: this.host, selector: sel })) || this._rules;
        this.applySheet();
        a.cancel();
        el.style.transformOrigin = "";
        this.renderPill(true);
      };
    };
    this._keys = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.stop(); } };
    this._block = e => { if (!e.composedPath().includes(host)) { e.preventDefault(); e.stopPropagation(); } };
    win.addEventListener("mousemove", this._move, true);
    win.addEventListener("click", this._click, true);
    win.addEventListener("mousedown", this._block, true);
    win.addEventListener("keydown", this._keys, true);
  }

  // A small burst of accent sparks at the click point (the "ooh" moment from the video).
  sparks(cx, cy) {
    const ui = this._ui;
    if (!ui || this.contentWindow.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
      const dist = 26 + Math.random() * 30;
      const size = 3 + Math.random() * 4;
      const d = this.mk("div", { position: "fixed", left: cx - size / 2 + "px", top: cy - size / 2 + "px", width: size + "px", height: size + "px",
        borderRadius: "999px", background: i % 3 ? ui.accent : "#ffffff", pointerEvents: "none" });
      ui.root.append(d);
      d.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(.2)`, opacity: 0 }],
        { duration: 420 + Math.random() * 160, easing: "cubic-bezier(.2,0,0,1)" }).onfinish = () => d.remove();
    }
  }

  // Ghosts: hidden elements shown faintly in place with a dashed accent outline (while hovering the pill).
  showGhosts(on, only = null) {
    const ui = this._ui;
    if (!ui) return;
    ui.ghosts.replaceChildren();
    this._peekAll = on ? (only ? [only] : [...(this._rules || [])]) : null;
    this.applySheet();
    if (!on) return;
    for (const sel of this._peekAll) {
      let el = null;
      try { el = this.document.querySelector(sel); } catch (e) {}
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const g = this.mk("div", { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
        borderRadius: "8px", outline: `2px dashed ${ui.accent}`, background: only ? "rgba(157,140,255,.22)" : "rgba(157,140,255,.10)" });
      ui.ghosts.append(g);
      g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    }
  }

  renderPill(bump = false) {
    const ui = this._ui;
    if (!ui) return;
    ui.chips.replaceChildren();
    const rules = this._rules || [];
    rules.forEach((sel, i) => {
      const c = this.mk("button", { all: "unset", minWidth: "24px", height: "24px", padding: "0 7px", boxSizing: "border-box", borderRadius: "999px",
        display: "grid", placeItems: "center", background: ui.accent, color: "#15121f", fontWeight: "700", cursor: "default",
        transition: "transform .12s ease, background-color .12s ease" }, String(i + 1));
      c.title = "Bring it back";
      c.addEventListener("mouseenter", e => { e.stopPropagation(); c.style.transform = "scale(1.12)"; c.style.background = "#ffffff"; this.showGhosts(true, sel); });
      c.addEventListener("mouseleave", () => { c.style.transform = ""; c.style.background = ui.accent; this.showGhosts(true); });
      c.addEventListener("click", async e => {
        e.stopPropagation();
        this._rules = (await this.sendQuery("Remove", { host: this.host, selector: sel })) || this._rules;
        this.showGhosts(false);
        this.applySheet();
        // It grows back into place.
        let el = null;
        try { el = this.document.querySelector(sel); } catch (err) {}
        el?.animate([{ transform: "scale(.85)", opacity: 0, filter: "blur(6px)" }, { transform: "scale(1)", opacity: 1, filter: "blur(0px)" }],
          { duration: 360, easing: "cubic-bezier(.2,0,0,1)" });
        this.renderPill();
      });
      ui.chips.append(c);
      if (bump && i === rules.length - 1) c.animate([{ transform: "scale(.3)", opacity: 0 }, { transform: "scale(1.25)", opacity: 1, offset: .6 }, { transform: "scale(1)" }],
        { duration: 340, easing: "cubic-bezier(.2,0,0,1)" });
    });
    ui.hint.textContent = rules.length ? (rules.length === 1 ? "1 element hidden · Click to Unzen" : `${rules.length} elements hidden · Click to Unzen`) : "Click anything to hide it";
  }

  stop() {
    const ui = this._ui;
    if (!ui) return;
    const win = this.contentWindow;
    win?.removeEventListener("mousemove", this._move, true);
    win?.removeEventListener("click", this._click, true);
    win?.removeEventListener("mousedown", this._block, true);
    win?.removeEventListener("keydown", this._keys, true);
    this._ui = null;
    this._peekAll = null;
    this.applySheet();
    const out = ui.pill.animate([{ opacity: 1, transform: "translate(-50%, 0)" }, { opacity: 0, transform: "translate(-50%, 14px)" }],
      { duration: 180, easing: "ease-in", fill: "forwards" });
    out.onfinish = () => ui.host.remove();
  }

  didDestroy() { this._ui = null; }
}
