#!/bin/bash
# New Firefox release -> tested Folio build, end to end (AUDIT P0-2). Stops at the first problem; never installs.
#   ./release.sh 161.0            rebase (downloads ~700 MB: ask Sammy first) -> build -> smoke test
#   ./release.sh 161.0 --build    after fixing rejects by hand: build -> smoke test
# Build: src/obj-<ver> (own objdir, so the current src/obj stays usable). Install afterwards with night/install.sh
# pointed at that objdir, then BASE is set to <ver> and make-patchset.sh regenerates the patch set from the new tree.
set -u
VER=${1:?usage: release.sh <version> [--build]}
P=/mnt/ssd/firefox-build/patchset; N=/mnt/ssd/firefox-build/night; NEW=/mnt/ssd/firefox-build/src/firefox-$VER
OBJ=/mnt/ssd/firefox-build/src/obj-$VER; LOG=$P/release-$VER.log
echo "release $VER start $(date)" > $LOG
if [ "${2:-}" != "--build" ]; then
  bash $P/rebase.sh "$VER" >> $LOG 2>&1 || { echo "rebase failed (see $LOG)"; exit 1; }
  rej=$(grep -c -E "FAILED|hunks? ignored|can't find file" $P/rebase-$VER.log)
  if [ "$rej" != 0 ]; then echo "$rej rejected hunks: fix them in $NEW (see $P/rebase-$VER.log), then: $0 $VER --build"; exit 2; fi
fi
sed -i "s#MOZ_OBJDIR=@TOPSRCDIR@/../obj\$#MOZ_OBJDIR=@TOPSRCDIR@/../obj-$VER#" "$NEW/mozconfig"
( cd /mnt/ssd/firefox-build && source ./env.sh && cd "$NEW" && unset WAYLAND_DISPLAY && export GDK_BACKEND=x11 MOZ_ENABLE_WAYLAND=0 &&
  nice -n 10 xvfb-run -a -s "-screen 0 1920x1080x24" ./mach --no-interactive build -j8 ) >> $LOG 2>&1 || { echo "build failed (see $LOG)"; exit 3; }
# Smoke test on the throwaway test profile (headless).
W=$(mktemp -d); echo "<title>t</title>ok" > $W/index.html
(cd $W && exec python3 -m http.server 18766 --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!
cd $N; ./fn.py stop >/dev/null 2>&1; rm -rf profile; cp -a tmpl profile; rm -rf profile/startupCache
FOLIO_BIN=$OBJ/dist/bin/firefox timeout 100 ./fn.py start --pref folio.welcome.completed=true --url http://127.0.0.1:18766/ >/dev/null 2>&1; sleep 8
S=$(timeout 120 ./fn.py js @smoke.js 2>&1 | tr -d '\n ')
./fn.py stop >/dev/null 2>&1; kill $SRV 2>/dev/null; rm -rf "$W"
echo "SMOKE $S" >> $LOG
case "$S" in *'"windowAlive":true'*'"about:folio":true'*) ;; *) echo "smoke test FAILED (see $LOG)"; exit 4;; esac
echo "Folio on Firefox $VER is built and passed the smoke test: $OBJ/dist/bin. Install = SRC=$OBJ/dist/bin night/install.sh;"
echo "then: echo $VER > $P/BASE && $P/make-patchset.sh"
