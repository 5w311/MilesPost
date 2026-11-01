# Rig UI, vendored

From [5w311/rig-ui](https://github.com/5w311/rig-ui) at commit `c0d4124`, MIT (see `LICENSE`).

Not the whole library. `milespost.js` imports the fifteen components this app renders,
and only the transitive closure of those imports is copied here — 37 modules out of 153,
plus `rig.css`. The whole library is 2.2 MB; this is 696 KB. That matters because every
file the page imports has to go in the service worker's precache, and this app has to
come up with no bars.

`rig.css` is the upstream file unchanged. MilesPost repoints the `--rig-*` tokens at the
highway palette in `index.html` rather than editing it, so re-vendoring is a straight copy.

## Adding a component

1. Add its import to `rig-ui/milespost.js`.
2. `npm run rig:manifest` — prints the new module closure, and tells you if a file it
   needs isn't vendored yet.
3. Copy any missing files from a clone of rig-ui, keeping the same paths.
4. Paste the printed list into `ASSETS` in `sw.js`, and bump `CACHE`.

## Re-vendoring from upstream

```sh
git clone --depth 1 https://github.com/5w311/rig-ui /tmp/rig-ui
cp /tmp/rig-ui/rig.css /tmp/rig-ui/LICENSE rig-ui/
npm run rig:manifest     # lists the modules to copy, and flags any that are missing
```
