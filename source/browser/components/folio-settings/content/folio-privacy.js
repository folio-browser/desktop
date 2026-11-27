/* Folio: privacy kill switches that have no settings toggle (they must stay off).
   An older profile can hold a user value that beats Folio's default (e.g. showSponsored=true was saved by Firefox
   before Folio existed), so these are written at every start. */
(() => {
  const FORCED = {
    "datareporting.healthreport.uploadEnabled": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "app.shield.optoutstudies.enabled": false,
    "browser.newtabpage.activity-stream.showSponsored": false,
    "browser.newtabpage.activity-stream.showSponsoredTopSites": false,
    "browser.urlbar.quicksuggest.enabled": false,
    "browser.urlbar.suggest.quicksuggest.sponsored": false,
    "browser.urlbar.suggest.quicksuggest.nonsponsored": false,
    "browser.urlbar.suggest.trending": false,
    "browser.safebrowsing.malware.enabled": false,
    "browser.safebrowsing.phishing.enabled": false,
    "browser.safebrowsing.downloads.enabled": false,
    "browser.safebrowsing.downloads.remote.enabled": false,
    "browser.tabs.crashReporting.sendReport": false,
  };
  const prefs = Services.prefs;
  for (const [name, value] of Object.entries(FORCED)) {
    try { if (prefs.getBoolPref(name, !value) !== value) prefs.setBoolPref(name, value); } catch (e) { /* pref missing in this build */ }
  }
})();
