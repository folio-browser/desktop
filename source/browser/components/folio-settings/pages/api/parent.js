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
        getWallpaper: async () => {
          const b = await FolioSkins.wallpaper();
          return b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null;
        },
      },
    };
  }
};
