/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Folio's built-in ad blocker, phase 2: hide the ad boxes the network blocker leaves behind (2026-11-24).
 * At document start the page's site-specific hide rules are applied as a USER sheet (beats the page's !important).
 * Generic rules (".ad-banner" style, keyed by class/id) are matched against the classes and ids actually on the
 * page at DOMContentLoaded, pageshow (after load) and once 3 s later. Deliberately NO MutationObserver: watching every DOM change
 * is what made uBlock cost CPU on app-like pages (measured 3% of Speedometer's page CPU). */

const SCAN_LIMIT = 20000;
// Per content process: the last answer per page origin+path, so later loads of the same page apply hide rules and
// scriptlets synchronously at document start (the first load waits one parent round trip).
const cache = new Map();
const CACHE_MAX = 200;
// Compiled scriptlet bundles per content process (a page's bundle is the same on every visit).
const compiled = new Map();
const compiling = new Map();
const COMPILED_MAX = 30;

export class FolioCosmeticChild extends JSWindowActorChild {
  handleEvent(event) {
    if (!Services.prefs.getBoolPref("folio.blocker.enabled", false)) return;
    const doc = this.document;
    if (!doc || !/^https?:/.test(doc.documentURI)) return;
    switch (event.type) {
      case "DOMDocElementInserted":
        if (event.target === doc) this.start();
        break;
      case "DOMContentLoaded":
        if (event.target === doc) this.scan();
        break;
      case "pageshow":
        if (event.target === doc) {
          this.scan();
          this.contentWindow?.setTimeout(() => this.scan(), 3000);
        }
        break;
    }
  }

  start() {
    if (this._ready) return this._ready;
    this._seen = new Set();
    const url = this.document.documentURI;
    const key = url.split(/[?#]/)[0];
    const hit = cache.get(key);
    if (hit) {
      this.apply(hit);
      this._ready = Promise.resolve(hit);
    }
    const fresh = this.sendQuery("get", { url }).then(res => {
      res = res || null;
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      if (res) cache.set(key, res); else cache.delete(key);
      if (!hit) this.apply(res);
      return (this._res = res);
    }, () => (this._res = hit || null));
    if (!hit) this._ready = fresh;
    this._res = hit || null;
    return this._ready;
  }

  apply(res) {
    if (!res) return;
    if (res.script) this.injectScript(res.script);
    if (res.hide) this.addSheet(res.hide.split("\n"));
  }

  // Phase 3: scriptlets (YouTube / anti-adblock fixes) run in the page's own JS world, like uBlock's.
  // Same mechanism as Firefox's own world:"MAIN" content scripts (ExtensionContent.sys.mjs): the code is compiled once
  // into a PrecompiledScript and executed in the page's global, which the page's CSP can't block. (Before 2026-11-26
  // this used evalInWindow, which no longer exists: scriptlets never ran at all.) Compiling is async, so it happens
  // once per content process per script; later page loads run it synchronously at document start.
  injectScript(code) {
    if (this._injected) return;
    this._injected = true;
    const run = script => {
      const win = this.contentWindow;
      if (!win || this.document?.documentURI !== this._url) return;
      try { script.executeInGlobal(win); } catch (e) {}
    };
    this._url = this.document?.documentURI;
    const ready = compiled.get(code);
    if (ready) { run(ready); return; }
    let pending = compiling.get(code);
    if (!pending) {
      pending = ChromeUtils.compileScript("data:text/javascript;charset=utf-8," + encodeURIComponent(code),
        { filename: "<anonymous code>", hasReturnValue: false }).then(script => {
        compiling.delete(code);
        if (compiled.size >= COMPILED_MAX) compiled.delete(compiled.keys().next().value);
        compiled.set(code, script);
        return script;
      }, () => { compiling.delete(code); return null; });
      compiling.set(code, pending);
    }
    pending.then(script => script && run(script));
  }

  async scan() {
    await this.start();
    const res = this._res;
    if (!res || res.generichide) return;
    const doc = this.document;
    if (!doc) return;
    const classes = new Set(), ids = new Set();
    let n = 0;
    for (const el of doc.querySelectorAll("[class],[id]")) {
      if (++n > SCAN_LIMIT) break;
      if (el.id && !this._seen.has("#" + el.id)) { ids.add(el.id); this._seen.add("#" + el.id); }
      for (const c of el.classList) if (!this._seen.has("." + c)) { classes.add(c); this._seen.add("." + c); }
    }
    if (!classes.size && !ids.size) return;
    let sel = "";
    try {
      sel = await this.sendQuery("classid", { classes: [...classes], ids: [...ids], exceptions: res.exceptions || "" });
    } catch (e) { return; }
    if (sel) this.addSheet(sel.split("\n"));
  }

  // One rule per selector: a single invalid selector would void a whole grouped rule.
  addSheet(selectors) {
    const css = selectors.filter(Boolean).map(s => s + "{display:none!important}").join("\n");
    if (!css) return;
    try {
      this.contentWindow.windowUtils.loadSheetUsingURIString(
        "data:text/css;charset=utf-8," + encodeURIComponent(css), Ci.nsIDOMWindowUtils.USER_SHEET);
    } catch (e) {}
  }
}
