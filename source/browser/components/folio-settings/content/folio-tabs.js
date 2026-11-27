/* Folio: tab hibernation + what each tab costs (memory, CPU) shown when you hover its row.
   Hibernating = Firefox's own tab discard: the page's process is released, the tab stays in the sidebar with its title and
   icon, and loads again when you click it. Pages that would lose unsaved work (beforeunload), tabs playing sound, sharing
   the screen/camera, in picture-in-picture, loading, or selected are never hibernated automatically.
   Prefs: folio.hibernate.enabled (bool), folio.hibernate.minutes (int), folio.tabtip.enabled (bool). */
(() => {
  const prefs = Services.prefs;
  const HTML = "http://www.w3.org/1999/xhtml";
  const bool = (n, d) => prefs.getBoolPref(n, d);
  const mb = (bytes) => bytes >= 1024 ** 3 ? (bytes / 1024 ** 3).toFixed(2) + " GB" : Math.round(bytes / 1024 ** 2) + " MB";

  const FolioTabs = {
    // ---- Hibernation ----
    isHibernated(tab) { return tab.hasAttribute("pending") || tab.hasAttribute("discarded"); },

    // Tabs that must stay awake when nobody asked for them to sleep.
    mustStayAwake(tab) {
      return tab.selected || tab.closing || tab.pinned || tab.folioPlaceholder
        || tab.hasAttribute("soundplaying") || tab.hasAttribute("sharing") || tab.hasAttribute("pictureinpicture") || tab.hasAttribute("busy")
        || tab.hasAttribute("pendingicon") || this.keepsAwake(tab) || this.hasNotifications(tab);
    },

    // "Keep awake" from the tab menu (kept with the session).
    keepsAwake(tab) {
      if (tab.folioKeepAwake === undefined) {
        let v = null;
        try { v = SessionStore.getCustomTabValue(tab, "folioAwake"); } catch (e) { /* none */ }
        tab.folioKeepAwake = v === "1";
      }
      return tab.folioKeepAwake;
    },
    setKeepAwake(tab, on) {
      tab.folioKeepAwake = !!on;
      try { if (on) SessionStore.setCustomTabValue(tab, "folioAwake", "1"); else SessionStore.deleteCustomTabValue(tab, "folioAwake"); } catch (e) { /* kept for this session */ }
    },
    // A site you allowed to send notifications (WhatsApp, Gmail, Slack...) must stay loaded, or the messages would never arrive.
    hasNotifications(tab) {
      try {
        const principal = tab.linkedBrowser.contentPrincipal;
        return Services.perms.testPermissionFromPrincipal(principal, "desktop-notification") === Services.perms.ALLOW_ACTION;
      } catch (e) { return false; }
    },

    // ---- Spaces: tabs of a space you left go to sleep after a grace period, gradually ----
    // Leaving a space starts a timer (pref folio.hibernate.spaces.minutes, default 10; 0 = never). Coming back before it ends
    // reloads nothing, so someone just trying out spaces never sees a reload.
    _leftAt: new Map(),
    _startAt: Date.now(),
    spaceGraceMs() { return Math.max(0, prefs.getIntPref("folio.hibernate.spaces.minutes", 10)) * 60000; },
    spaceLeft(id) { if (id) this._leftAt.set(id, Date.now()); },
    spaceEntered(id) { this._leftAt.delete(id); },
    // Milliseconds until the grace period of this tab's space ends (0 = over), or null when it does not apply.
    spaceGraceLeft(tab) {
      const S = window.FolioSidebar;
      const grace = this.spaceGraceMs();
      if (!S || !grace || tab.folioPlaceholder) return null;
      const sp = S.tabSpace(tab);
      if (sp === S.currentSpaceId() || sp === S.SHARED) return null;
      const left = this._leftAt.get(sp) ?? this._startAt;
      return Math.max(0, grace - (Date.now() - left));
    },

    // Hibernate one tab. `manual` = the user asked: Firefox's own "Unload tab" path (forced).
    hibernate(tab, manual = false) {
      try {
        if (this.isHibernated(tab) || tab.selected) return false;
        if (!manual && this.mustStayAwake(tab)) return false;
        return !!gBrowser.discardBrowser(tab, manual);
      } catch (e) { return false; }
    },

    hibernateOthers(except) {
      let n = 0;
      for (const t of gBrowser.tabs) if (t !== except && !t.folioPlaceholder && this.hibernate(t, true)) n++;
      return n;
    },

    // Every minute: put tabs to sleep that nobody has looked at for N minutes.
    sweep() {
      if (!bool("folio.hibernate.enabled", true)) return 0;
      const limit = Math.max(1, prefs.getIntPref("folio.hibernate.minutes", 30)) * 60000;
      const now = Date.now();
      let n = 0, spaceTabs = [];
      for (const t of gBrowser.tabs) {
        const idle = now - (t.lastAccessed || now);
        if (idle >= limit) { if (this.hibernate(t, false)) n++; continue; }
        // A tab of a space we left: eligible once the grace period is over AND the tab itself has been idle as long.
        const graceLeft = this.spaceGraceLeft(t);
        if (graceLeft === 0 && idle >= this.spaceGraceMs()) spaceTabs.push([t, idle]);
      }
      // Gradually: the oldest first, a few per round, so memory comes down steadily and the computer never stalls.
      spaceTabs = spaceTabs.filter(([t]) => !this.isHibernated(t) && !this.mustStayAwake(t)).sort((a, b) => b[1] - a[1]);
      for (const [t] of spaceTabs.slice(0, 4)) if (this.hibernate(t, false)) n++;
      return n;
    },

    minutesLeft(tab) {
      if (!bool("folio.hibernate.enabled", true) || this.isHibernated(tab) || this.mustStayAwake(tab)) return null;
      const limit = Math.max(1, prefs.getIntPref("folio.hibernate.minutes", 30)) * 60000;
      let left = limit - (Date.now() - (tab.lastAccessed || Date.now()));
      const g = this.spaceGraceLeft(tab);
      if (g !== null) left = Math.min(left, Math.max(g, this.spaceGraceMs() - (Date.now() - (tab.lastAccessed || Date.now()))));
      return Math.max(0, Math.ceil(left / 60000));
    },

    // ---- What a tab costs ----
    _proc: null, _procAt: 0, _cpu: new Map(),
    async procInfo() {
      if (this._proc && performance.now() - this._procAt < 900) return this._proc;
      this._proc = await ChromeUtils.requestProcInfo();
      this._procAt = performance.now();
      return this._proc;
    },
    osPid(tab) {
      try { return tab.linkedBrowser.browsingContext?.currentWindowGlobal?.osPid || 0; } catch (e) { return 0; }
    },
    // { bytes, cpu (percent of one core, or null at first sample), sharedWith (other tabs in the same process) }
    async cost(tab) {
      if (this.isHibernated(tab)) return { bytes: 0, cpu: 0, sharedWith: 0, hibernated: true };
      const pid = this.osPid(tab);
      if (!pid) return null;
      const info = await this.procInfo();
      const proc = (info.children || []).find(c => c.pid === pid);
      if (!proc) return null;
      const sharers = gBrowser.tabs.filter(t => !this.isHibernated(t) && this.osPid(t) === pid).length || 1;
      const bytes = (proc.residentUniqueSize || proc.memory || 0) / sharers;
      let cpu = null;
      const prev = this._cpu.get(pid), now = performance.now();
      if (prev && now - prev.t > 300) cpu = Math.max(0, ((proc.cpuTime - prev.cpu) / 1e6) / (now - prev.t) * 100) / sharers;
      if (!prev || now - prev.t > 300) this._cpu.set(pid, { t: now, cpu: proc.cpuTime });
      return { bytes, cpu, sharedWith: sharers - 1, hibernated: false };
    },

    // ---- Hover card ----
    _tip: null, _tipTimer: 0, _tipLive: 0,
    ensureTip() {
      if (this._tip) return this._tip;
      const t = document.createElementNS(HTML, "div");
      t.id = "folio-tab-tip";
      t.hidden = true;
      (document.body || document.documentElement).append(t);
      return this._tip = t;
    },
    attachTip(row, tab) {
      row.addEventListener("mouseenter", () => {
        if (!bool("folio.tabtip.enabled", true)) return;
        clearTimeout(this._tipTimer);
        this._tipTimer = setTimeout(() => this.showTip(row, tab), 450);
      });
      for (const ev of ["mouseleave", "pointerdown", "wheel", "contextmenu"]) row.addEventListener(ev, () => this.hideTip());
    },
    async showTip(row, tab) {
      if (!row.isConnected) return;
      const tip = this.ensureTip();
      const r = row.getBoundingClientRect();
      tip.style.setProperty("top", Math.max(8, Math.min(r.top, window.innerHeight - 150)) + "px", "important");
      tip.style.setProperty("left", (r.right + 10) + "px", "important");
      const draw = async () => {
        if (tip.hidden || !tab.isConnected) return;
        const c = await this.cost(tab);
        const left = this.minutesLeft(tab);
        const host = (() => { try { return tab.linkedBrowser.currentURI.host; } catch (e) { return ""; } })();
        const lines = [];
        lines.push(["name", tab.label || "New Tab"]);
        if (host) lines.push(["sub", host]);
        if (!c) lines.push(["sub", "Reading..."]);
        else if (c.hibernated) lines.push(["row", "Hibernated", "0 MB, no CPU"]);
        else {
          lines.push(["row", "Memory", mb(c.bytes)]);
          lines.push(["row", "CPU", c.cpu == null ? "..." : (c.cpu < 1 ? "idle" : c.cpu.toFixed(0) + "%")]);
          if (c.sharedWith) lines.push(["sub", `Shares a process with ${c.sharedWith} other tab${c.sharedWith > 1 ? "s" : ""}; the memory is split.`]);
        }
        if (left != null && !(c && c.hibernated)) lines.push(["sub", left <= 1 ? "Hibernates in a minute." : `Hibernates in ${left} min if you leave it.`]);
        else if (tab.hasAttribute("soundplaying")) lines.push(["sub", "Playing sound: stays awake."]);
        tip.replaceChildren(...lines.map(([k, a, b]) => {
          const d = document.createElementNS(HTML, "div");
          d.className = "tt-" + k;
          if (k === "row") { const l = document.createElementNS(HTML, "span"); l.textContent = a; const v = document.createElementNS(HTML, "b"); v.textContent = b; d.append(l, v); }
          else d.textContent = a;
          return d;
        }));
      };
      tip.hidden = false;
      await draw();
      clearInterval(this._tipLive);
      this._tipLive = setInterval(draw, 1000);
    },
    hideTip() {
      clearTimeout(this._tipTimer);
      clearInterval(this._tipLive);
      if (this._tip) this._tip.hidden = true;
    },

    // ---- Total ----
    async totalBytes() {
      const info = await this.procInfo();
      return (info.children || []).reduce((s, c) => s + (c.residentUniqueSize || c.memory || 0), 0) + (info.residentUniqueSize || info.memory || 0);
    },
  };

  // ============================ Performance limits ============================
  // Memory: the "guard" works everywhere: when Folio nears the limit it puts the least recently used tabs to sleep, long before
  // the system has to squeeze it. Linux also gets the system's own enforcement (cgroups) when Folio was started by its launcher
  // (folio-launch): MemoryHigh (soft: throttles, never kills), CPUQuota (hard CPU cap), CPUWeight (yield to other apps).
  // Prefs: folio.limit.memoryMB (0 = off), folio.limit.cpuPercent (0 = off, percent of the whole CPU),
  //        folio.limit.lowPriority (bool).
  const FolioLimits = {
    lastGuard: null,   // { time, count }
    _unit: undefined,
    async unit() {
      if (this._unit !== undefined) return this._unit;
      this._unit = null;
      try {
        // /proc files report size 0, so ask for bytes explicitly.
        const txt = new TextDecoder().decode(await IOUtils.read("/proc/self/cgroup", { maxBytes: 8192 }));
        const m = /(folio-\d+\.scope)/.exec(txt);
        if (m) this._unit = m[1];
      } catch (e) { /* not Linux */ }
      return this._unit;
    },
    cores() { return Math.max(1, window.navigator.hardwareConcurrency || 1); },
    wanted() {
      const mem = prefs.getIntPref("folio.limit.memoryMB", 0);
      const cpu = prefs.getIntPref("folio.limit.cpuPercent", 0);
      const low = prefs.getBoolPref("folio.limit.lowPriority", false);
      return {
        mem, cpu, low,
        MemoryHigh: mem > 0 ? mem + "M" : "infinity",
        CPUQuota: cpu > 0 ? Math.max(1, Math.round(cpu * this.cores())) + "%" : "",
        CPUWeight: low ? "20" : "100",
      };
    },
    // Write the launcher's file (next start) and, if Folio is in its scope, apply it live.
    async apply() {
      const w = this.wanted();
      try {
        const dir = PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, ".config", "folio");
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        const env = [`MEMORY_HIGH=${w.mem > 0 ? w.MemoryHigh : ""}`, `CPU_QUOTA=${w.CPUQuota}`, `CPU_WEIGHT=${w.low ? w.CPUWeight : ""}`].join("\n") + "\n";
        await IOUtils.writeUTF8(PathUtils.join(dir, "limits.env"), env);
      } catch (e) { /* read-only home */ }
      const unit = await this.unit();
      if (!unit) return false;
      try {
        const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
        const p = await Subprocess.call({
          command: "/usr/bin/systemctl",
          arguments: ["--user", "set-property", "--runtime", unit, `MemoryHigh=${w.MemoryHigh}`, `CPUQuota=${w.CPUQuota || ""}`, `CPUWeight=${w.CPUWeight}`],
        });
        const r = await p.wait();
        return r.exitCode === 0;
      } catch (e) { return false; }
    },
    // The memory guard. Called every 20 seconds.
    async guard() {
      const limit = prefs.getIntPref("folio.limit.memoryMB", 0) * 1048576;
      if (!limit) return 0;
      let total;
      try { total = await FolioTabs.totalBytes(); } catch (e) { return 0; }
      if (total < limit * 0.85) return 0;
      // Oldest idle tabs first; about a quarter of them per round, at least one.
      // Tabs of the spaces you are not in go first, whatever the grace period says.
      const S = window.FolioSidebar;
      const cur = S?.currentSpaceId();
      const away = (t) => (S && !t.folioPlaceholder && !S.inSpace(t, cur) ? 0 : 1);
      const idle = gBrowser.tabs
        .filter(t => !FolioTabs.isHibernated(t) && !FolioTabs.mustStayAwake(t))
        .sort((a, b) => away(a) - away(b) || (a.lastAccessed || 0) - (b.lastAccessed || 0));
      const take = Math.max(1, Math.ceil(idle.length / 4));
      let n = 0;
      for (const t of idle.slice(0, take)) if (FolioTabs.hibernate(t, false)) n++;
      if (n) this.lastGuard = { time: Date.now(), count: n };
      return n;
    },
  };
  window.FolioLimits = FolioLimits;
  const guardTimer = setInterval(() => FolioLimits.guard(), 20000);
  window.addEventListener("unload", () => clearInterval(guardTimer), { once: true });
  // Apply the saved limits once the window is up, and whenever one changes.
  const limitObserver = { observe: () => FolioLimits.apply() };
  prefs.addObserver("folio.limit.", limitObserver);
  window.addEventListener("unload", () => prefs.removeObserver("folio.limit.", limitObserver), { once: true });
  setTimeout(() => FolioLimits.apply(), 3000);

  window.FolioTabs = FolioTabs;
  // The sweep runs only while a window is open; one timer per window is fine (hibernate() is idempotent).
  const timer = setInterval(() => FolioTabs.sweep(), 60000);
  window.addEventListener("unload", () => clearInterval(timer), { once: true });
})();

// Idle trim (2026-11-24, memory work). When you leave Folio alone (no keyboard or mouse in any Folio window for
// folio.trim.idleSeconds, default 90, or Folio not focused for that long), every process is asked once to give memory
// back: garbage collection, compaction, caches dropped (what about:memory's "Minimize memory usage" does). It runs again
// only after you've come back and left again, so it never repeats while you're away and never runs while you work.
(() => {
  if (window.FolioIdleTrim) return;
  const PREF = "folio.trim.idleSeconds";
  const mm = Cc["@mozilla.org/memory-reporter-manager;1"].getService(Ci.nsIMemoryReporterManager);
  const T = {
    last: Date.now(),
    trimmedSince: 0,
    activity() { T.last = Date.now(); },
    check() {
      const secs = Services.prefs.getIntPref(PREF, 90);
      if (secs <= 0) return;
      // One window runs it for the whole app; activity in any window counts (each window updates its own T.last).
      const wins = [...Services.wm.getEnumerator("navigator:browser")];
      if (wins[0] !== window) return;
      const lastAny = Math.max(...wins.map(w => w.FolioIdleTrim?.last || 0));
      const focused = wins.some(w => w.document.hasFocus());
      const idleFor = (Date.now() - lastAny) / 1000;
      if (idleFor < secs && focused) return; // in use
      if (!focused && idleFor < Math.min(secs, 60)) return; // just switched away
      if (T.trimmedSince >= lastAny) return; // already trimmed for this idle period
      T.trimmedSince = Date.now();
      try { mm.minimizeMemoryUsage(() => {}); } catch (e) { console.warn("Folio idle trim:", e); }
    },
  };
  window.FolioIdleTrim = T;
  for (const ev of ["keydown", "mousedown", "wheel", "pointermove"]) window.addEventListener(ev, T.activity, { capture: true, passive: true });
  const timer = setInterval(T.check, 15000);
  window.addEventListener("unload", () => clearInterval(timer), { once: true });
})();
