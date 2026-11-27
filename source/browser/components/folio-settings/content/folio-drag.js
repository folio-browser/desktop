/* Folio: drag any UI item anytime, like Vivaldi.
 * Grab a button anywhere (top toolbar, sidebar, bookmarks bar, overflow menu), move it a few pixels:
 * it lifts and follows the pointer, a magenta line shows where it lands, the area it lands in glows.
 * Drop in an area to move it there; drop away from every area to remove it (with Undo).
 * Drag the address bar to the far window edge to move the whole toolbar there.
 * Uses Firefox's own layout API (CustomizableUI), so layouts are saved like any customization. */
(function () {
  const THRESHOLD = 6;        // px before a press becomes a drag
  const SLOP = 10;            // px around an area that still counts as inside it
  const EDGE = 90;            // px from the window's top/bottom edge for the toolbar-move zone
  const BOTTOM_PREF = "folio.toolbar.bottom";
  const SIDEBAR_PREF = "folio.toolbar.sidebar"; // Zen/Vivaldi layout: the toolbar lives in the sidebar
  const SIDEBAR_BOTTOM_PREF = "folio.toolbar.sidebarBottom"; // ...at the sidebar's bottom instead of its top
  const ACCENT = "#ce5caa";
  const NEVER_DRAG = new Set(["tabbrowser-tabs"]); // the tab list itself has its own dragging
  const style = (n, css) => { for (const [k, v] of Object.entries(css)) n.style.setProperty(k, v, "important"); return n; };
  const layer = () => document.body || document.documentElement;

  let press = null;  // { node, id, x, y }
  let drag = null;   // { node, id, ghost, marker, edge, toEdge, drop, remove, glow, offsetX, offsetY }
  let swallowClick = false;

  // ---- Areas -------------------------------------------------------------------
  function areas() {
    const list = [];
    for (const id of CustomizableUI.areas) {
      let target = null;
      try { target = CustomizableUI.getCustomizeTargetForArea(id, window); } catch (e) { continue; }
      if (!target || !target.isConnected) continue;
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden area (closed panel, hidden toolbar)
      const vertical = id === CustomizableUI.AREA_VERTICAL_TABSTRIP || id === CustomizableUI.AREA_FIXED_OVERFLOW_PANEL;
      list.push({ id, target, rect: r, vertical });
    }
    return list;
  }

  function areaOf(node) {
    for (const a of areas()) if (a.target.contains(node)) return a;
    return null;
  }

  function widgetFor(node, area) {
    while (node && node.parentNode !== area.target) node = node.parentNode;
    if (!node || !node.id || NEVER_DRAG.has(node.id)) return null;
    if (!CustomizableUI.getPlacementOfWidget(node.id)) return null;
    return node;
  }

  function areaAt(x, y) {
    for (const a of areas()) {
      const r = a.rect;
      if (x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP) return a;
    }
    return null;
  }

  function skipPress(node) {
    return !!node.closest?.("input, textarea, .tabbrowser-tab, #tabbrowser-tabs, [contenteditable]");
  }

  // ---- Toolbar in the sidebar (like Zen and Vivaldi) ----------------------------------
  // The toolbar stays where Firefox expects it (moving the node scrambles its button list);
  // CSS only draws it over the top of the sidebar, at the sidebar's width, and the sidebar
  // content starts below it. Observers keep both sizes in step.
  let sizeObserver = null;
  function applySidebarToolbar() {
    // The address bar can't live in a 56 px icons-only sidebar: then it goes to the top bar.
    const on = Services.prefs.getBoolPref(SIDEBAR_PREF, false) && !Services.prefs.getBoolPref("folio.sidebar.hidden", false) &&
      !Services.prefs.getBoolPref("folio.sidebar.icons", false);
    const root = document.documentElement;
    const nav = document.getElementById("nav-bar");
    const main = document.getElementById("folio-sidebar"); // our own sidebar (folio-sidebar.js)
    const toolbox = document.getElementById("navigator-toolbox");
    if (!nav || !main || !toolbox) return;
    root.toggleAttribute("folio-sidebar-toolbar", on);
    root.toggleAttribute("folio-sidebar-toolbar-bottom", on && Services.prefs.getBoolPref(SIDEBAR_BOTTOM_PREF, false));
    nav.overflowable?.folioSetOverflowEnabled?.(!on); // no "»" overflow menu in the sidebar: buttons wrap instead
    sizeObserver?.disconnect();
    sizeObserver = null;
    if (on) {
      const sync = () => {
        const r = main.getBoundingClientRect();
        root.style.setProperty("--folio-sidebar-left", r.left + "px");
        root.style.setProperty("--folio-sidebar-width", r.width + "px");
        root.style.setProperty("--folio-toolbar-height", toolbox.getBoundingClientRect().height + "px");
        // Bottom placement sits just above the bookmarks / history icons, so measure that row.
        const tools = main.querySelector("#folio-sidebar-bottom");
        root.style.setProperty("--folio-tools-height", (tools ? tools.getBoundingClientRect().height : 0) + "px");
        // Spaces now sit at the top of the list, so the bottom address bar only clears the tool icons.
        root.style.setProperty("--folio-spaces-height", "0px");
      };
      // A move without a size change (sidebar switched to the right, window resized) must re-measure too:
      // ResizeObserver only reports size, so the toolbar stayed on the left over the page (2026-11-25).
      if (!window.folioSidebarPosHooked) {
        window.folioSidebarPosHooked = true;
        const again = () => setTimeout(() => window.folioSidebarSync?.(), 60);
        Services.prefs.addObserver("folio.sidebar.right", again);
        window.addEventListener("resize", again);
        window.addEventListener("unload", () => Services.prefs.removeObserver("folio.sidebar.right", again), { once: true });
      }
      window.folioSidebarSync = sync;
      sizeObserver = new ResizeObserver(sync);
      sizeObserver.observe(main);
      sizeObserver.observe(toolbox);
      const tools = main.querySelector("#folio-sidebar-bottom");
      if (tools) sizeObserver.observe(tools);
      const spacesEl = main.querySelector("#folio-spaces");
      if (spacesEl) sizeObserver.observe(spacesEl);
      sync();
    } else {
      window.folioSidebarSync = null;
      for (const v of ["--folio-sidebar-left", "--folio-sidebar-width", "--folio-toolbar-height", "--folio-tools-height", "--folio-spaces-height"]) root.style.removeProperty(v);
    }
    // The address bar measures its own width with a script; make it measure again.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }
  const sidebarRect = () => document.getElementById("folio-sidebar")?.getBoundingClientRect();

  // ---- Sidebar tool icons (bookmarks, history, ...) -------------------------------
  // They live in <sidebar-main>'s shadow DOM and come from SidebarController.toolsAndExtensions,
  // shown in that Map's order. Firefox doesn't save an order, so Folio does.
  const TOOL_ORDER_PREF = "folio.sidebar.toolOrder";
  const toolsBox = () => document.querySelector("sidebar-main")?.shadowRoot?.querySelector(".tools-and-extensions");
  function toolButtonFrom(e) {
    for (const n of e.composedPath()) {
      if (n.localName === "moz-button" && n.getAttribute?.("view") && n.parentNode?.classList?.contains("tools-and-extensions")) return n;
    }
    return null;
  }
  function applyToolOrder(ids) {
    const map = window.SidebarController?.toolsAndExtensions;
    if (!map) return;
    const next = new Map();
    for (const k of ids) if (map.has(k)) next.set(k, map.get(k));
    for (const [k, v] of map) if (!next.has(k)) next.set(k, v);
    window.SidebarController._toolsAndExtensions = next;
    window.dispatchEvent(new CustomEvent("SidebarItemChanged"));
  }
  function moveTool(id, beforeId) {
    const ids = [...window.SidebarController.toolsAndExtensions.keys()].filter(k => k !== id);
    const i = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(i < 0 ? ids.length : i, 0, id);
    applyToolOrder(ids);
    Services.prefs.setStringPref(TOOL_ORDER_PREF, ids.join(","));
  }

  // ---- Pointer ------------------------------------------------------------------
  function onPointerDown(e) {
    if (e.button !== 0 || CustomizationHandler.isCustomizing()) return;
    const tool = toolButtonFrom(e);
    if (tool) { press = { node: tool, id: tool.getAttribute("view"), tool: true, x: e.screenX, y: e.screenY }; return; }
    if (skipPress(e.target)) return;
    const area = areaOf(e.target);
    if (!area) return;
    const node = widgetFor(e.target, area);
    if (!node) return;
    press = { node, id: node.id, x: e.screenX, y: e.screenY };
  }

  function onPointerMove(e) {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.screenX - press.x, e.screenY - press.y) < THRESHOLD) return;
      startDrag(e);
    }
    moveDrag(e);
  }

  function startDrag(e) {
    const node = press.node;
    const rect = node.getBoundingClientRect();
    const ghost = node.cloneNode(true);
    ghost.removeAttribute("id");
    style(ghost, { position: "fixed", "z-index": "2147483647", "pointer-events": "none", margin: "0",
      width: rect.width + "px", height: rect.height + "px", "border-radius": "8px",
      background: "rgba(40, 38, 44, 0.95)", "box-shadow": "0 8px 24px rgba(0,0,0,0.45)",
      transition: "opacity 0.15s ease, scale 0.15s ease", scale: "1.06" });
    const marker = style(document.createElement("div"), {
      position: "fixed", "z-index": "2147483646", "border-radius": "2px", "pointer-events": "none",
      background: ACCENT, "box-shadow": "0 0 8px " + ACCENT, display: "none" });
    layer().append(ghost, marker);

    let edge = null;
    if (press.id === "urlbar-container" && !Services.prefs.getBoolPref(SIDEBAR_PREF, false)) {
      const bottom = Services.prefs.getBoolPref(BOTTOM_PREF, false);
      edge = style(document.createElement("div"), {
        position: "fixed", left: "8px", right: "8px", height: "6px", "border-radius": "3px",
        [bottom ? "top" : "bottom"]: "6px", "z-index": "2147483646", "pointer-events": "none",
        background: ACCENT, opacity: "0.35", transition: "opacity 0.15s ease, height 0.15s ease" });
      edge.dataset.toBottom = String(!bottom);
      layer().append(edge);
    }
    node.classList.add("folio-dragging");
    document.documentElement.setAttribute("folio-dragging", "true");
    drag = { node, id: press.id, tool: !!press.tool, ghost, marker, edge, toEdge: false, drop: null, remove: false, glow: null,
             offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
  }

  function setGlow(area) {
    const node = area ? (area.target.closest("toolbar, #vertical-tabs, panelview") || area.target) : null;
    if (drag.glow === node) return;
    drag.glow?.removeAttribute("folio-drop-target");
    node?.setAttribute("folio-drop-target", "true");
    drag.glow = node;
  }

  function moveDrag(e) {
    const { ghost, marker } = drag;
    ghost.style.setProperty("left", (e.clientX - drag.offsetX) + "px", "important");
    ghost.style.setProperty("top", (e.clientY - drag.offsetY) + "px", "important");
    drag.drop = null;
    drag.toEdge = false;

    // Address bar over the sidebar: put the whole toolbar at the top of the sidebar (and back).
    if (drag.id === "urlbar-container") {
      const inSidebar = Services.prefs.getBoolPref(SIDEBAR_PREF, false);
      const sr = sidebarRect();
      const overSidebar = sr && e.clientX < sr.right && e.clientX > sr.left;
      // Upper half of the sidebar = toolbar at its top, lower half = at its bottom.
      const wantBottom = sr ? e.clientY > sr.top + sr.height / 2 : false;
      drag.sidebarBottom = wantBottom;
      const sameSpot = inSidebar && overSidebar && wantBottom === Services.prefs.getBoolPref(SIDEBAR_BOTTOM_PREF, false);
      drag.toSidebar = inSidebar ? ((!overSidebar && e.clientY < EDGE) || (overSidebar && !sameSpot)) : overSidebar;
      drag.leaveSidebar = inSidebar && !overSidebar;
      if (drag.toSidebar) {
        setGlow(null);
        drag.glow = inSidebar ? document.getElementById("tabbrowser-tabbox") : document.getElementById("folio-sidebar");
        drag.glow?.setAttribute("folio-drop-target", "true");
        drag.edge && drag.edge.style.setProperty("opacity", "0.35", "important");
        marker.style.setProperty("display", "none", "important");
        drag.remove = false;
        return;
      }
    }
    // Address bar over the far edge: move the whole toolbar there.
    if (drag.edge) {
      const toBottom = drag.edge.dataset.toBottom === "true";
      drag.toEdge = toBottom ? e.clientY > window.innerHeight - EDGE : e.clientY < EDGE;
      drag.edge.style.setProperty("opacity", drag.toEdge ? "1" : "0.35", "important");
      drag.edge.style.setProperty("height", drag.toEdge ? "10px" : "6px", "important");
    }

    if (drag.tool) { moveTool_(e); return; }
    const area = drag.toEdge ? null : areaAt(e.clientX, e.clientY);
    setGlow(area);
    drag.remove = !area && !drag.toEdge && CustomizableUI.isWidgetRemovable(drag.id);
    ghost.style.setProperty("opacity", drag.remove ? "0.45" : "1", "important");
    ghost.style.setProperty("scale", drag.remove ? "0.9" : "1.06", "important");
    if (!area) { marker.style.setProperty("display", "none", "important"); return; }

    // Insert before the first item past the pointer, along the area's direction.
    const items = [...area.target.children].filter(c => c !== drag.node && !c.hidden && c.id && c.getBoundingClientRect().width);
    let before = null;
    for (const c of items) {
      const r = c.getBoundingClientRect();
      if (area.vertical ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) { before = c; break; }
    }
    drag.drop = { area: area.id, beforeId: before ? before.id : null };

    const R = area.rect;
    if (area.vertical) {
      const y = before ? before.getBoundingClientRect().top - 2 : (items.length ? items.at(-1).getBoundingClientRect().bottom + 1 : R.top + 4);
      style(marker, { display: "block", left: (R.left + 4) + "px", top: y + "px", width: Math.max(R.width - 8, 16) + "px", height: "3px" });
    } else {
      const x = before ? before.getBoundingClientRect().left - 2 : (items.length ? items.at(-1).getBoundingClientRect().right + 1 : R.left + 4);
      style(marker, { display: "block", left: x + "px", top: (R.top + 4) + "px", width: "3px", height: Math.max(R.height - 8, 16) + "px" });
    }
  }

  // Sidebar tools: reorder inside their own row, or drop away to remove.
  function moveTool_(e) {
    const { ghost, marker } = drag;
    const box = toolsBox();
    const R = box?.getBoundingClientRect();
    const inside = R && e.clientX >= R.left - SLOP && e.clientX <= R.right + SLOP && e.clientY >= R.top - SLOP && e.clientY <= R.bottom + SLOP;
    drag.remove = !inside;
    ghost.style.setProperty("opacity", drag.remove ? "0.45" : "1", "important");
    ghost.style.setProperty("scale", drag.remove ? "0.9" : "1.06", "important");
    if (!inside) { drag.drop = null; marker.style.setProperty("display", "none", "important"); return; }
    const horizontal = R.width >= R.height;
    const items = [...box.children].filter(c => c.localName === "moz-button" && c !== drag.node && c.getBoundingClientRect().width);
    let before = null;
    for (const c of items) {
      const r = c.getBoundingClientRect();
      if (horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2) { before = c; break; }
    }
    drag.drop = { tool: true, beforeId: before ? before.getAttribute("view") : null };
    if (horizontal) {
      const x = before ? before.getBoundingClientRect().left - 2 : (items.length ? items.at(-1).getBoundingClientRect().right + 1 : R.left + 4);
      style(marker, { display: "block", left: x + "px", top: (R.top + 2) + "px", width: "3px", height: Math.max(R.height - 4, 16) + "px" });
    } else {
      const y = before ? before.getBoundingClientRect().top - 2 : (items.length ? items.at(-1).getBoundingClientRect().bottom + 1 : R.top + 4);
      style(marker, { display: "block", left: (R.left + 2) + "px", top: y + "px", width: Math.max(R.width - 4, 16) + "px", height: "3px" });
    }
  }

  function finishDrag(cancel) {
    const d = drag;
    drag = null;
    d.ghost.remove(); d.marker.remove(); d.edge?.remove();
    d.glow?.removeAttribute("folio-drop-target");
    d.node.classList.remove("folio-dragging");
    document.documentElement.removeAttribute("folio-dragging");
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    if (cancel) return;

    if (d.tool) {
      if (d.remove) {
        window.SidebarController.toggleTool(d.id);
        showUndo("Icon removed", () => window.SidebarController.toggleTool(d.id));
      } else if (d.drop) {
        moveTool(d.id, d.drop.beforeId);
      }
      return;
    }
    const old = CustomizableUI.getPlacementOfWidget(d.id);
    if (d.toSidebar) {
      if (d.leaveSidebar) { Services.prefs.setBoolPref(SIDEBAR_PREF, false); return; }
      Services.prefs.setBoolPref(SIDEBAR_BOTTOM_PREF, !!d.sidebarBottom);
      Services.prefs.setBoolPref(BOTTOM_PREF, false);
      Services.prefs.setBoolPref(SIDEBAR_PREF, true);
      return;
    }
    if (d.toEdge) { Services.prefs.setBoolPref(BOTTOM_PREF, d.edge.dataset.toBottom === "true"); return; }
    if (d.remove) {
      CustomizableUI.removeWidgetFromArea(d.id);
      showUndo("Button removed", () => { if (old) CustomizableUI.addWidgetToArea(d.id, old.area, old.position); });
      return;
    }
    if (!d.drop) return; // dropped nowhere and can't be removed: snap back
    const pos = d.drop.beforeId ? CustomizableUI.getPlacementOfWidget(d.drop.beforeId)?.position : undefined;
    try {
      if (old && old.area === d.drop.area) CustomizableUI.moveWidgetWithinArea(d.id, pos);
      else CustomizableUI.addWidgetToArea(d.id, d.drop.area, pos);
    } catch (e) {
      console.error("folio-drag: that item can't go there", e); // some items only fit certain areas
    }
  }

  function onPointerUp() { if (drag) finishDrag(false); press = null; }
  function onClick(e) { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }
  function onKey(e) { if (e.key === "Escape" && drag) { finishDrag(true); press = null; } }

  // ---- Undo after removing --------------------------------------------------------
  let toast = null;
  function showUndo(text, undoFn) {
    toast?.remove();
    toast = document.createElement("div");
    toast.className = "folio-toast";
    const label = document.createElement("span");
    label.textContent = text;
    const undo = document.createElement("button");
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      undoFn();
      toast?.remove(); toast = null;
    });
    toast.append(label, undo);
    layer().append(toast);
    setTimeout(() => { toast?.remove(); toast = null; }, 6000);
  }

  window.addEventListener("load", () => {
    // Capture presses anywhere in the browser chrome; areaOf() decides if it's a draggable item.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    setTimeout(applySidebarToolbar, 0);
    if (!Services.prefs.getBoolPref("folio.defaults.reloadAdded", false)) {
      Services.prefs.setBoolPref("folio.defaults.reloadAdded", true);
      if (!CustomizableUI.getPlacementOfWidget("stop-reload-button")) {
        const fwd = CustomizableUI.getPlacementOfWidget("forward-button");
        CustomizableUI.addWidgetToArea("stop-reload-button", "nav-bar", fwd && fwd.area === "nav-bar" ? fwd.position + 1 : undefined);
      }
      // A new profile came out as forward, reload, back (the placements got reversed on the way in). Put the
      // navigation buttons first in the usual order: back, forward, reload. Only on a new profile: an existing
      // one keeps whatever the user dragged.
      ["back-button", "forward-button", "stop-reload-button"].forEach((id, i) => {
        const p = CustomizableUI.getPlacementOfWidget(id);
        if (p && p.area === "nav-bar") CustomizableUI.moveWidgetWithinArea(id, i);
      });
    }

    Services.prefs.addObserver(SIDEBAR_PREF, applySidebarToolbar);
    Services.prefs.addObserver(SIDEBAR_BOTTOM_PREF, applySidebarToolbar);
    Services.prefs.addObserver("sidebar.verticalTabs", applySidebarToolbar);
    Services.prefs.addObserver("folio.sidebar.hidden", applySidebarToolbar);
    Services.prefs.addObserver("folio.sidebar.icons", applySidebarToolbar);
    window.addEventListener("unload", () => {
      Services.prefs.removeObserver(SIDEBAR_PREF, applySidebarToolbar);
      Services.prefs.removeObserver(SIDEBAR_BOTTOM_PREF, applySidebarToolbar);
      Services.prefs.removeObserver("sidebar.verticalTabs", applySidebarToolbar);
      Services.prefs.removeObserver("folio.sidebar.hidden", applySidebarToolbar);
      Services.prefs.removeObserver("folio.sidebar.icons", applySidebarToolbar);
    }, { once: true });
    const saved = Services.prefs.getStringPref(TOOL_ORDER_PREF, "");
    if (saved) {
      let tries = 0;
      const wait = setInterval(() => {
        if (window.SidebarController?.toolsAndExtensions?.size || ++tries > 40) {
          clearInterval(wait);
          applyToolOrder(saved.split(","));
        }
      }, 250);
    }
  }, { once: true });
})();
