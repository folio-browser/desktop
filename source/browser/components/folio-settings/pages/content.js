// Applies Dark Reader with colours derived from the wallpaper palette (same maths as the old gen.py).
(() => {
  if (typeof DarkReader === "undefined") return;
  // After the extension is reloaded, scripts already injected into open tabs are orphaned; their chrome.* calls throw.
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const host = location.hostname;
  // Sites that ship their own theme (or are themed by another extension of mine): recoloring them breaks it.
  const SELF_THEMED = ["web.whatsapp.com", "127.0.0.1"];

  DarkReader.setFetchMethod(async url => {
    if (!alive()) throw new Error("extension reloaded");
    // callback form on purpose: Dark Reader wraps sendMessage and drops the native promise, so `await` would always get undefined
    const r = await new Promise(res => chrome.runtime.sendMessage({ type: "fetch", url }, r => { void chrome.runtime.lastError; res(r); }));
    if (!r || r.error) throw new Error((r && r.error) || "no reply from background for " + url);
    const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
    return new Response(bytes, { status: r.status, headers: { "content-type": r.type } });
  });

  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, "0")).join("");

  // Site-specific userstyles (Catppuccin structure, wallpaper colours) win over the generic Dark Reader pass.
  const sheet = new CSSStyleSheet();
  let attached = false;
  const setSheet = css => {
    const has = !!css;
    if (has) sheet.replaceSync(css.replace(/@import[^;]+;/g, ""));
    if (has && !attached) { document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; attached = true; }
    if (!has && attached) { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet); attached = false; }
  };

  const mark = v => { try { document.documentElement.dataset.mp = v; } catch (e) {} };
  async function apply({ palette, off, disabledHosts }) {
    if (!alive()) return;
    mark("start");
    // Light look (Folio set to Light, or System on a light desktop): the site keeps its own light theme. These styles are
    // dark ones; on a light page they left near-white text on white (2026-11-26).
    const light = matchMedia("(prefers-color-scheme: light)").matches;
    if (off || light || !palette || SELF_THEMED.includes(host) || (disabledHosts || []).includes(host)) { DarkReader.disable(); setSheet(""); mark(light ? "light" : "off"); return; }
    const css = await new Promise(res => chrome.runtime.sendMessage({ type: "styles", url: location.href }, r => { void chrome.runtime.lastError; res(r || ""); }));
    if (css) { DarkReader.disable(); try { setSheet(css); mark("css " + css.length); } catch (e) { mark("err " + e.message); } return; }
    mark("dr");
    setSheet("");
    const bg = palette.surface, fg = palette.on_surface, acc = palette.primary;
    const text = mix(fg, "#ffffff", 0.4), link = mix(acc, "#ffffff", 0.3), sel = mix(bg, acc, 0.3);
    DarkReader.enable({
      mode: 1, brightness: 100, contrast: 100, sepia: 0, grayscale: 0,
      darkSchemeBackgroundColor: bg, darkSchemeTextColor: text,
      scrollbarColor: "auto", selectionColor: "auto", styleSystemControls: true,
    }, { css: `
      ::selection { background: ${sel} !important; color: ${mix(text, "#ffffff", 0.3)} !important; }
      :root { accent-color: ${acc}; caret-color: ${acc}; }
      a:link, a:visited { color: ${link} !important; }
      *:focus-visible { outline-color: ${acc} !important; }`,
      invert: [], ignoreInlineStyle: [], ignoreImageAnalysis: [] });
  }

  const load = () => !alive() ? 0 : chrome.storage.local.get(["palette", "off", "disabledHosts"]).then(apply).catch(e => mark("err " + e.message));
  load();
  chrome.storage.onChanged.addListener(load);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", load);
})();
