// Converts uBlock Origin's bundled scriptlets (js/resources/scriptlets.js, uBO 1.77) to adblock-rust Resource JSON.
// requiresTrust -> permission 1 (Folio marks its lists as trusted, like uBO trusts its own lists).
// ISOLATED-world scriptlets are skipped: Folio injects in the page's MAIN world only.
import { pathToFileURL } from "node:url";
const [, , resDir, out] = process.argv;
const { builtinScriptlets } = await import(pathToFileURL(resDir + "/scriptlets.js").href);
const fs = await import("node:fs");
const list = [];
let skipped = 0;
for (const s of builtinScriptlets) {
  if (s.world && s.world.toUpperCase() === "ISOLATED") { skipped++; continue; }
  const src = s.fn.toString();
  if (!/^function\s+[^\s(]+\s*\(/.test(src)) { skipped++; continue; }
  const isHelper = s.name.endsWith(".fn");
  list.push({
    name: s.name,
    aliases: (s.aliases || []).filter(a => a !== s.name),
    kind: { mime: isHelper ? "fn/javascript" : "application/javascript" },
    content: Buffer.from(src).toString("base64"),
    ...(s.dependencies?.length ? { dependencies: s.dependencies } : {}),
    ...(s.requiresTrust ? { permission: 1 } : {}),
  });
}
fs.writeFileSync(out, JSON.stringify(list));
console.log(`converted ${list.length}, skipped ${skipped}, trusted ${list.filter(r => r.permission).length}`);
console.log(["set-constant.js","set.js","json-prune.js","trusted-replace-xhr-response.js","trusted-rpfr.js","json-edit-fetch-response.js"].map(n => n + ":" + list.some(r => r.name === n || r.aliases.includes(n))).join(" "));
