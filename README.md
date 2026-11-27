# Folio

The last browser you'll try. Folio is a desktop browser built on Firefox: tabs in a sidebar, spaces, a floating
peek at links, split view, and a whole browser that takes its colors from your wallpaper. Private by default,
with no telemetry.

**Website:** https://sammynashed.github.io/Folio
**Downloads:** [Releases](https://github.com/SammyNashed/Folio/releases) (Windows 10/11 and 64-bit Linux)

## What's in this repository

Folio is Firefox plus a set of changes. This repository holds those changes, so anyone can see exactly what
Folio does and rebuild it.

| Path | What it is |
| --- | --- |
| `source/` | Folio's own code (the sidebar, settings, new tab, theming, welcome tour, branding, blocker) and the few new files Folio adds inside Firefox's folders. Copied into the Firefox tree as-is. |
| `patches/` | Every change Folio makes to Firefox's own files, one patch per file. |
| `folio-upstream-changes.patch` | The same patches as one file. |
| `build/` | The build config (`mozconfig`) and the scripts that apply the changes to a Firefox release and build it. |
| `build/BASE` | The Firefox version this release is built on. |

## Building

1. Download the Firefox source for the version in `build/BASE` from
   `https://archive.mozilla.org/pub/firefox/releases/<version>/source/` and unpack it.
2. Copy `source/` over the unpacked tree, then apply the patches:
   `patch -p1 < folio-upstream-changes.patch`
3. Copy `build/mozconfig` to the tree as `mozconfig` and build with `./mach build` (see
   [Firefox's build docs](https://firefox-source-docs.mozilla.org/setup/)).

`build/rebase.sh` and `build/release.sh` do this automatically when moving Folio onto a new Firefox release.
They point at the author's own folders; change the paths at the top of each script for your machine.

## License

Folio's code is under the [Mozilla Public License 2.0](LICENSE), the same license as Firefox.
Folio ships uBlock Origin, which is under the GPLv3: its package is in
`source/browser/app/distribution/extensions/`, and its source is at https://github.com/gorhill/uBlock.

Folio is not made by or affiliated with Mozilla. Firefox is a trademark of the Mozilla Foundation.
