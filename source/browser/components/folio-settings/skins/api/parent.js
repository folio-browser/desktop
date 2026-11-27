"use strict";
/* globals ExtensionAPI, ChromeUtils */
// Folio's own add-ons read the theme straight from the browser (FolioSkins.sys.mjs), no local server.
this.folioTheme = class extends ExtensionAPI {
  getAPI() {
    const { FolioSkins } = ChromeUtils.importESModule("resource:///modules/FolioSkins.sys.mjs");
    return {
      folioTheme: {
        getState: async () => FolioSkins.state(),
        waitForChange: v => FolioSkins.waitForChange(v),
        // Layout snapshots from the WhatsApp skin (debugging only): <profile>/folio-wa-<name>.txt, names/sizes, no text.
        debugWrite: async (name, text) => {
          const safe = String(name).replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "dump";
          await IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, `folio-wa-${safe}.txt`), String(text).slice(0, 400000));
        },
        getWallpaper: async () => {
          const b = await FolioSkins.wallpaper();
          return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null;
        },
      },
    };
  }
};
