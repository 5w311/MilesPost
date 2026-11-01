/* Prints the module closure of rig-ui/milespost.js, as sw.js wants it.
   Run it after adding a component import: `npm run rig:manifest`. It also names any
   file the closure needs that isn't vendered here yet, which is the one way this can
   go wrong — a missing module fails the service worker's addAll(), and the app then
   never installs offline at all. */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "rig-ui");
const ENTRY = resolve(ROOT, "milespost.js");
const seen = new Set(), missing = [];

function walk(abs){
  const rel = relative(ROOT, abs);
  if(seen.has(rel)) return;
  if(!existsSync(abs)){ missing.push(rel); return; }
  seen.add(rel);
  const src = readFileSync(abs, "utf8");
  const re = /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m;
  while((m = re.exec(src))){
    const spec = m[1] || m[2] || m[3];
    if(spec && spec.startsWith(".")) walk(resolve(dirname(abs), spec));
  }
}
walk(ENTRY);

const files = ["rig.css", ...[...seen].sort()];
console.log("// rig-ui, from rig-ui/milespost.js — regenerate with `npm run rig:manifest`");
for(const f of files) console.log(`  "./rig-ui/${f}",`);
console.error(`\n${files.length} files (${seen.size} modules + rig.css)`);
if(missing.length){
  console.error(`\nMISSING — copy these from a rig-ui clone before deploying:`);
  for(const m of missing) console.error("  rig-ui/" + m);
  process.exit(1);
}
