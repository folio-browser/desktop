/* Folio: See-through window, the page half. A window actor: lives in each web page's process, asks nothing of any add-on.
   With folio.seethrough on, big opaque page backgrounds are made transparent so the window's glass shows through
   (idea from the Transparent Zen add-on, MIT: github.com/frostybiscuit/transparent-zen; this is our own small version).
   Inline !important styles are used because they beat every site rule and Dark Reader's. */
const PREF = "folio.seethrough";
const SKIP_HOSTS = ["web.whatsapp.com"]; // themed by the built-in site skin

export class FolioSeeThroughChild extends JSWindowActorChild {
  #on = false;
  #timer = 0;
  #obs = null;
  #lightSheet = false;

  handleEvent(event) {
    if (event.type === "DOMContentLoaded" || event.type === "pageshow") this.#sync();
  }

  // The browser sends this when the setting changes (pref observers do not reach web-content processes).
  receiveMessage(msg) {
    if (msg.name === "Folio:SeeThrough") this.#sync();
  }

  didDestroy() {
    this.#stop();
  }

  #eligible() {
    const doc = this.document;
    if (!doc || !doc.documentElement || doc.contentType !== "text/html") return false;
    try { if (SKIP_HOSTS.includes(doc.location.hostname)) return false; } catch (e) { return false; }
    return true;
  }

  #sync() {
    const want = Services.prefs.getBoolPref(PREF, false) && this.#eligible();
    if (want === this.#on) { if (want) this.#queue(); return; }
    this.#on = want;
    if (want) {
      this.#scan();
      const win = this.contentWindow;
      this.#obs = new win.MutationObserver(() => this.#queue());
      this.#obs.observe(this.document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    } else {
      this.#stop();
      this.#restore();
    }
  }

  #stop() {
    if (this.#obs) { this.#obs.disconnect(); this.#obs = null; }
    if (this.#timer) { this.contentWindow?.clearTimeout(this.#timer); this.#timer = 0; }
  }

  #queue() {
    if (this.#timer || !this.contentWindow) return;
    this.#timer = this.contentWindow.setTimeout(() => { this.#timer = 0; this.#scan(); }, 400);
  }

  static #clear(el) {
    el.style.setProperty("background-color", "transparent", "important");
    el.style.setProperty("background-image", "none", "important");
  }

  #big(el, win) {
    const r = el.getBoundingClientRect();
    return r.width >= win.innerWidth * 0.7 && r.height >= win.innerHeight * 0.55 && r.bottom > 0 && r.right > 0;
  }

  // Does the page's text read on dark glass? Sites without a dark mode keep dark text even when asked for dark; clearing
  // their background left dark text on dark glass (2026-11-26, Sammy: "the site is barely readable in Folio").
  // Majority vote over up to 40 visible text elements: light text (luminance > 0.45) = the page went dark = clear it.
  #readsDark() {
    const doc = this.document, win = this.contentWindow;
    const els = doc.querySelectorAll("p, li, h1, h2, h3, a, span, td, label");
    let light = 0, dark = 0, n = 0;
    for (const el of els) {
      if (n >= 40) break;
      if (!el.firstChild || el.firstChild.nodeType !== 3 || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > win.innerHeight * 2) continue;
      n++;
      if (FolioSeeThroughChild.#lum(win.getComputedStyle(el).color) > 0.45) light++; else dark++;
    }
    if (n < 3) return FolioSeeThroughChild.#lum(win.getComputedStyle(doc.body).color) > 0.45; // too little text: the body's color decides
    return light >= dark;
  }

  #scan() {
    if (!this.#on) return;
    const doc = this.document, win = this.contentWindow;
    if (!doc || !win || !doc.body) return;
    if (!this.#readsDark()) { this.#restore(); return; } // light-only site: keep its own background
    FolioSeeThroughChild.#clear(doc.documentElement);
    FolioSeeThroughChild.#clear(doc.body);
    let level = [doc.body], n = 0;
    for (let depth = 0; depth < 5 && level.length && n < 500; depth++) {
      const next = [];
      for (const parent of level) {
        for (const el of parent.children) {
          if (++n > 500) break;
          const cs = win.getComputedStyle(el);
          if (cs.display === "none") continue;
          if (!el.hasAttribute("data-folio-see") && cs.position !== "fixed" && this.#big(el, win)) {
            const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
            const parts = m ? m[1].split(",") : [];
            const alpha = m ? (parts.length > 3 ? parseFloat(parts[3]) : 1) : 0;
            if (alpha > 0) { el.setAttribute("data-folio-see", ""); FolioSeeThroughChild.#clear(el); }
          }
          next.push(el);
        }
      }
      level = next;
    }
    // (Light-mode frosted page controls were tried and removed 2026-11-26: sites theme their own search bars and
    // buttons through their own settings; Folio leaves them alone. #restoreLight still clears any leftovers.)
    this.#restoreLight();
  }

  // Light chosen (folio.seethrough.lightLook): the glass stays clear like dark, but search bars, text fields and solid
  // buttons become white frosted glass with dark text, so Light still looks like Light (2026-11-26).
  static #alpha(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return 0;
    const p = m[1].split(",").map(x => parseFloat(x));
    return p.length > 3 ? p[3] : 1;
  }
  static #lum(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return 0;
    const [r, g, b] = m[1].split(",").map(x => parseFloat(x) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  static #frost(el) {
    el.setAttribute("data-folio-lightctl", "");
    // Frosted, not paint: thin white + blur of what is behind + a bright hairline edge (2026-11-26, Sammy).
    el.style.setProperty("background-color", "rgba(255, 255, 255, 0.46)", "important");
    el.style.setProperty("backdrop-filter", "blur(18px) saturate(1.6)", "important");
    el.style.setProperty("box-shadow", "inset 0 1px 0 rgba(255, 255, 255, 0.35)", "important");
    el.style.setProperty("color", "#17141f", "important");
    el.style.setProperty("border-color", "rgba(255, 255, 255, 0.35)", "important");
  }
  #lightControls() {
    const doc = this.document, win = this.contentWindow;
    const light = Services.prefs.getBoolPref("folio.seethrough.lightLook", false);
    if (!light) { this.#restoreLight(); return; }
    // Pseudo-element fades (dark gradients drawn by ::before/::after inside a now-white pill) need a stylesheet.
    if (!this.#lightSheet) {
      this.#lightSheet = true;
      try {
        win.windowUtils.loadSheetUsingURIString("data:text/css," + encodeURIComponent(
          "[data-folio-lightctl]::before,[data-folio-lightctl]::after,[data-folio-lightctl] *::before,[data-folio-lightctl] *::after{background-image:none!important}"),
          Ci.nsIDOMWindowUtils.USER_SHEET);
      } catch (e) {}
    }
    const C = FolioSeeThroughChild;
    let n = 0;
    const fields = doc.querySelectorAll('input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], input[type=password], input[type=tel], input[type=number], textarea, [role=searchbox], [role=combobox][contenteditable]');
    for (const input of fields) {
      if (++n > 60) break;
      const r = input.getBoundingClientRect();
      if (r.width < 120 || r.height < 14) continue;
      // The visible pill: the field itself, or the nearest wrapper (up to 4 levels) that paints a background.
      let pill = null, el = input;
      for (let i = 0; i < 5 && el && el !== doc.body; i++, el = el.parentElement) {
        const cs = win.getComputedStyle(el);
        if (C.#alpha(cs.backgroundColor) > 0.15) {
          const er = el.getBoundingClientRect();
          if (er.height <= Math.max(r.height * 2.6, 72)) pill = el;
          break;
        }
      }
      if (pill && !pill.hasAttribute("data-folio-lightctl")) {
        C.#frost(pill);
        // Inside the pill: dark-theme fades (gradients) go, light icons and text turn dark.
        let k = 0;
        for (const d of pill.querySelectorAll("*")) {
          if (++k > 60) break;
          const ds = win.getComputedStyle(d);
          let touched = false;
          if (ds.backgroundImage.includes("gradient")) { d.style.setProperty("background-image", "none", "important"); touched = true; }
          if (C.#alpha(ds.backgroundColor) > 0.3 && C.#lum(ds.backgroundColor) < 0.4 && d.getBoundingClientRect().height < r.height * 1.5) {
            d.style.setProperty("background-color", "transparent", "important"); touched = true;
          }
          if (C.#lum(ds.color) > 0.55) { d.style.setProperty("color", "#3a3644", "important"); touched = true; }
          if (touched) d.setAttribute("data-folio-lightctl", "");
        }
      }
      if (!input.hasAttribute("data-folio-lightctl")) {
        input.setAttribute("data-folio-lightctl", "");
        if (!pill || pill !== input) input.style.setProperty("background-color", "transparent", "important");
        input.style.setProperty("color", "#17141f", "important");
        input.style.setProperty("caret-color", "#17141f", "important");
      }
    }
    n = 0;
    for (const b of doc.querySelectorAll("button, [role=button], input[type=submit], input[type=button]")) {
      if (++n > 300) break;
      if (b.hasAttribute("data-folio-lightctl")) continue;
      const r = b.getBoundingClientRect();
      if (r.height < 24 || r.height > 64 || r.width < 40) continue;
      const cs = win.getComputedStyle(b);
      if (C.#alpha(cs.backgroundColor) < 0.5 || C.#lum(cs.backgroundColor) > 0.6) continue; // clear or already light
      C.#frost(b);
    }
  }
  #restoreLight() {
    for (const el of this.document?.querySelectorAll("[data-folio-lightctl]") || []) {
      el.removeAttribute("data-folio-lightctl");
      for (const p of ["background-color", "background-image", "color", "border-color", "caret-color", "backdrop-filter", "box-shadow"]) el.style.removeProperty(p);
    }
  }

  #restore() {
    const doc = this.document;
    if (!doc) return;
    this.#restoreLight();
    for (const el of doc.querySelectorAll("[data-folio-see]")) {
      el.removeAttribute("data-folio-see");
      el.style.removeProperty("background-color");
      el.style.removeProperty("background-image");
    }
    for (const el of [doc.documentElement, doc.body]) {
      if (!el) continue;
      el.style.removeProperty("background-color");
      el.style.removeProperty("background-image");
    }
  }
}
