/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Import from Arc (FolioArc). Split out of folio-sidebar.js 2026-11-26, no code change, same load order.

// ---- Import from Arc (2026-11-22): Arc's spaces, folders, pinned tabs and Favorites, in one click ----
// Arc keeps its whole sidebar in StorableSidebar.json (Windows: %LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_*\LocalCache\
// Local\Arc\, macOS: ~/Library/Application Support/Arc/). Format, as read by the open-source converters (ivnvxd/arc-export):
// sidebar.containers[] has a {global} marker; the container after it holds `spaces` and `items`, both lists that may
// alternate id strings with objects. A space's newContainerIDs pairs {pinned}/{unpinned} markers with container ids; an
// item has id, parentID, childrenIds, title and, for a tab, data.tab.savedURL/savedTitle. Favorites (the icon grid) sit in
// a container listed in topAppsContainerIDs: imported as Essentials when present, skipped when not.
// Arc spaces become Folio spaces, Arc folders become Folio folders (nested ones flattened as "Parent / Child"), pinned tabs
// become lazy tabs (they load only when opened: no memory or data spent on import). Importing twice adds nothing twice.
const FolioArc = {
  async findFile() {
    const cands = [];
    try {
      const local = Services.env.get("LOCALAPPDATA");
      if (local) {
        const pk = PathUtils.join(local, "Packages");
        for (const d of await IOUtils.getChildren(pk).catch(() => [])) {
          if (PathUtils.filename(d).startsWith("TheBrowserCompany.Arc")) cands.push(PathUtils.join(d, "LocalCache", "Local", "Arc", "StorableSidebar.json"));
        }
      }
    } catch (e) { /* not Windows */ }
    try { cands.push(PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, "Library", "Application Support", "Arc", "StorableSidebar.json")); } catch (e) {}
    for (const p of cands) if (await IOUtils.exists(p).catch(() => false)) return p;
    return null;
  },

  // Arc's lists alternate "id", {object}: keep the objects.
  objs(list) { return (list || []).filter(x => x && typeof x === "object"); },
  // [{marker}, "id", {marker}, "id"] -> { marker: id }
  pairs(list) {
    const out = {};
    const a = list || [];
    for (let i = 0; i + 1 < a.length; i++) {
      if (a[i] && typeof a[i] === "object" && typeof a[i + 1] === "string") for (const k of Object.keys(a[i])) out[k] = a[i + 1];
    }
    return out;
  },
  emojiOf(space) {
    const it = space?.customInfo?.iconType || {};
    for (const k of ["emoji_v2", "emoji"]) if (typeof it[k] === "string" && it[k]) return it[k];
    return null;
  },

  // -> { spaces: [{ name, icon, folders: [{ name, tabs }], tabs }], favorites: [{ url, title }] }
  parse(json) {
    const containers = json?.sidebar?.containers;
    if (!Array.isArray(containers)) throw new Error("not an Arc sidebar file");
    const gi = containers.findIndex(c => c && typeof c === "object" && "global" in c);
    const box = containers[gi + 1];
    if (!box || typeof box !== "object") throw new Error("no Arc data found in the file");
    const items = new Map(this.objs(box.items).filter(i => i.id).map(i => [i.id, i]));
    const kids = (id) => {
      const p = items.get(id);
      const order = Array.isArray(p?.childrenIds) ? p.childrenIds.filter(k => items.has(k)) : [];
      const rest = [...items.values()].filter(i => i.parentID === id && !order.includes(i.id)).map(i => i.id);
      return [...order, ...rest].map(k => items.get(k));
    };
    const asTab = (i) => {
      const t = i?.data?.tab;
      if (!t?.savedURL || !/^https?:/i.test(t.savedURL)) return null;
      return { url: t.savedURL, title: i.title || t.savedTitle || t.savedURL };
    };
    // A container's tabs and folders; nested folders flattened into "Parent / Child".
    const collect = (id, path, folders, loose) => {
      for (const i of kids(id)) {
        const tab = asTab(i);
        if (tab) { (path ? folders.get(path) : loose).push(tab); continue; }
        if (!i.data?.tab && (i.title || kids(i.id).length)) {
          const name = path ? `${path} / ${i.title || "Folder"}` : (i.title || "Folder");
          if (!folders.has(name)) folders.set(name, []);
          collect(i.id, name, folders, loose);
        }
      }
    };
    const spaces = [];
    let n = 1;
    for (const s of this.objs(box.spaces)) {
      const ids = this.pairs(s.newContainerIDs || s.containerIDs);
      if (!ids.pinned) continue;
      const folders = new Map(), loose = [];
      collect(ids.pinned, "", folders, loose);
      spaces.push({ name: s.title || `Space ${n++}`, icon: this.emojiOf(s),
        folders: [...folders].map(([name, tabs]) => ({ name, tabs })).filter(f => f.tabs.length), tabs: loose });
    }
    const favorites = [];
    for (const fid of Object.values(this.pairs(box.topAppsContainerIDs))) {
      for (const i of kids(fid)) { const t = asTab(i); if (t) favorites.push(t); }
    }
    return { spaces, favorites };
  },

  // Creates everything in this window. Returns counts.
  apply(data) {
    const S = window.FolioSidebar;
    const res = { spaces: 0, folders: 0, tabs: 0, favorites: 0 };
    const spaces = S.spaces();
    const folders = S.folders();
    const seen = new Set(gBrowser.tabs.map(t => `${S.tabSpace(t)}|${t.linkedBrowser?.currentURI?.spec || ""}`));
    for (const s of data.spaces) {
      // A space with the same name (imported before, or the user's own "Personal") is merged into, not duplicated.
      let sp = spaces.find(x => x.importedFrom === "arc" && x.name === s.name) || spaces.find(x => x.name.toLowerCase() === s.name.toLowerCase());
      if (!sp) {
        sp = { id: "s" + Math.random().toString(36).slice(2, 10), name: s.name, color: S.SPACE_COLORS[spaces.length % S.SPACE_COLORS.length], importedFrom: "arc" };
        if (s.icon) sp.icon = s.icon;
        spaces.push(sp);
        res.spaces++;
      }
      const add = (t, folderId) => {
        const key = `${sp.id}|${t.url}`;
        if (seen.has(key)) return;
        seen.add(key);
        const tab = gBrowser.addTrustedTab(t.url, { createLazyBrowser: true, inBackground: true, lazyTabTitle: t.title });
        S.setTabSpace(tab, sp.id);
        if (folderId) S.setTabFolder(tab, folderId);
        res.tabs++;
      };
      for (const t of s.tabs) add(t, "");
      for (const f of s.folders) {
        let fo = folders.find(x => x.spaceId === sp.id && x.name === f.name);
        if (!fo) { fo = { id: "f" + Math.random().toString(36).slice(2, 10), name: f.name, spaceId: sp.id, open: false }; folders.push(fo); res.folders++; }
        for (const t of f.tabs) add(t, fo.id);
      }
    }
    S.setSpaces(spaces);
    S.setFolders(folders);
    const ess = S.essEntries();
    for (const f of data.favorites) {
      if (ess.some(e => S.hostOf(e.url) === S.hostOf(f.url))) continue;
      ess.push({ url: f.url, color: null, icon: null });
      res.favorites++;
    }
    S.setEssEntries(ess);
    S.applySpaces();
    S.renderTabs(); // also redraws Essentials (the folio.essentials pref observer does too)
    return res;
  },

  async importFrom(path) {
    const data = this.parse(await IOUtils.readJSON(path));
    return { ...this.apply(data), file: path };
  },
};
window.FolioArc = FolioArc;

