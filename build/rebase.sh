#!/bin/bash
# Rebase Folio onto a newer Firefox release (security updates).
#   ./rebase.sh 161.0          -> /mnt/ssd/firefox-build/src/firefox-161.0 with Folio applied, + a report of what didn't apply
# The source tarball is large (~700 MB): metered data, ask Sammy first.
set -u
VER=${1:?usage: rebase.sh <firefox version, e.g. 161.0>}
P=/mnt/ssd/firefox-build/patchset
SRC=/mnt/ssd/firefox-build/src
NEW=$SRC/firefox-$VER
TAR=$SRC/firefox-$VER.source.tar.xz
[ -d "$NEW" ] && { echo "$NEW already exists"; exit 1; }
if [ ! -f "$TAR" ]; then
  echo "downloading firefox-$VER source (~700 MB)..."
  curl -fL --retry 5 -C - -o "$TAR" "https://archive.mozilla.org/pub/firefox/releases/$VER/source/firefox-$VER.source.tar.xz" || exit 1
fi
mkdir -p "$NEW" && tar -xJf "$TAR" -C "$NEW" --strip-components=1 || exit 1
cd "$NEW"
# 1) Folio's changes to Mozilla's files. Rejected hunks land next to the file as .rej.
patch -p1 --forward --no-backup-if-mismatch -r - < $P/folio-upstream-changes.patch > $P/rebase-$VER.log 2>&1
rej=$(grep -c -E "FAILED|hunks? ignored" $P/rebase-$VER.log)
# 2) Folio's own folders and new files, unchanged.
tar -xzf $P/folio-own-files.tar.gz -C "$NEW"
cp $P/mozconfig "$NEW/mozconfig"
echo "rebased onto $VER: $(grep -c '^patching file' $P/rebase-$VER.log) files patched, $rej problem lines (see $P/rebase-$VER.log)"
grep -E "FAILED|hunks? ignored|can't find file" $P/rebase-$VER.log | head -20
echo "next: fix any rejects, then: source /mnt/ssd/firefox-build/env.sh && cd $NEW && unset WAYLAND_DISPLAY && GDK_BACKEND=x11 MOZ_ENABLE_WAYLAND=0 xvfb-run -a -s '-screen 0 1920x1080x24' ./mach build"
