#!/bin/bash
# Folio's changes to Firefox, as a patch set that can be re-applied to a newer Firefox (see README.md).
# Upstream originals come from github.com/mozilla-firefox/firefox at the release tag.
set -u
P=/mnt/ssd/firefox-build/patchset
# The Firefox version Folio is built on lives in BASE (release.sh updates it after a successful rebase).
VER=$(cat $P/BASE)
S=/mnt/ssd/firefox-build/src/firefox-$VER
TAG=FIREFOX_$(echo $VER | tr . _)_RELEASE
OWN='^(browser/components/folio-settings|browser/components/folio-welcome|browser/branding/folio)/'
# "Changed since" is per base version (2026-11-26: Firefox 161's own files are dated Nov 19, the old fixed cutoff, so every
# file in the tree looked changed). SINCE-<ver> = a moment after the tree was extracted and before Folio was applied.
touch -d "$(cat $P/SINCE-$VER 2>/dev/null || echo '2026-11-19 00:00')" $P/.since
cd $S
{
  find . -newer $P/.since -type f -not -name "*.pyc" -not -path "*/__pycache__/*" -not -name "*.bak*" -not -name "*.orig" -not -name "mozconfig*" -not -name "*.log"
  # Folio's own folders whole, and the files Folio already added or changed (a file from the tarball keeps its old date).
  find browser/components/folio-settings browser/components/folio-welcome browser/branding/folio -type f -not -name "*.pyc" 2>/dev/null
  cat $P/upstream-files.txt $P/new-upstream-files.txt 2>/dev/null
} | sed 's#^\./##' | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done > $P/changed.txt
grep -E "$OWN" $P/changed.txt > $P/own-files.txt
grep -v -E "$OWN" $P/changed.txt > $P/upstream-files.txt
rm -f $P/patches/*.patch; : > $P/new-upstream-files.txt
n=0; new=0
while read -r f; do
  o="$P/upstream/$f"; mkdir -p "$(dirname "$o")"
  code=$(curl -s -o "$o" -w "%{http_code}" --retry 3 "https://raw.githubusercontent.com/mozilla-firefox/firefox/$TAG/$f")
  if [ "$code" = 404 ]; then rm -f "$o"; echo "$f" >> $P/new-upstream-files.txt; new=$((new+1)); continue; fi
  [ "$code" = 200 ] || { echo "FETCH FAILED $code $f"; continue; }
  name=$(echo "$f" | tr '/' '_')
  (cd $P && diff -u --label "a/$f" --label "b/$f" "upstream/$f" "$S/$f" > "patches/$name.patch") ; [ -s "$P/patches/$name.patch" ] && n=$((n+1)) || rm -f "$P/patches/$name.patch"
done < $P/upstream-files.txt
# Folio's own folders + new files placed inside Mozilla's folders: shipped whole.
tar -czf $P/folio-own-files.tar.gz -C $S -T $P/own-files.txt -T $P/new-upstream-files.txt
cp $S/mozconfig $P/mozconfig
cat $P/patches/*.patch > $P/folio-upstream-changes.patch 2>/dev/null
echo "patched upstream files: $n, new files inside upstream folders: $new, own files: $(wc -l < $P/own-files.txt)"
