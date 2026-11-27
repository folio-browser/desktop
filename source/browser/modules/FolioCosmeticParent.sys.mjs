/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Parent side of Folio's cosmetic filtering (see FolioCosmeticChild.sys.mjs): asks Firefox's native filter engine
 * (ContentClassifierService, "test_block" = Folio's lists) for the page's hide rules. Honors the shield's
 * "turn off protection for this site" (ContentBlockingAllowList). */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ContentBlockingAllowList: "resource://gre/modules/ContentBlockingAllowList.sys.mjs",
});
ChromeUtils.defineLazyGetter(lazy, "svc", () =>
  Cc["@mozilla.org/content-classifier-service;1"].getService(Ci.nsIContentClassifierService));

export class FolioCosmeticParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (!Services.prefs.getBoolPref("folio.blocker.enabled", false)) return null;
    const browser = this.browsingContext.top?.embedderElement;
    try {
      if (browser && lazy.ContentBlockingAllowList.includes(browser)) return null;
    } catch (e) {}
    try {
      if (msg.name === "get") {
        const hide = {}, exceptions = {}, script = {}, generichide = {};
        lazy.svc.folioCosmetic(String(msg.data.url), hide, exceptions, script, generichide);
        return { hide: hide.value, exceptions: exceptions.value, script: script.value, generichide: generichide.value };
      }
      if (msg.name === "classid") {
        const d = msg.data;
        return lazy.svc.folioClassIdSelectors(
          (d.classes || []).slice(0, 20000).join("\n"), (d.ids || []).slice(0, 20000).join("\n"), String(d.exceptions || ""));
      }
    } catch (e) {
      // Engine not built yet (lists still loading) or the service is off.
    }
    return null;
  }
}
