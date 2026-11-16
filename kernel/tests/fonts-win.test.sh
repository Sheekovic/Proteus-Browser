# Patches 0008 and 0009 on Windows: font allow-list and substitutes, with fonts every
# Windows installation has. Sourced by win-test.sh.

CANDIDATES='Arial|Arial Bold|Segoe UI|Segoe UI Light|Calibri|Calibri Light|Consolas|Times New Roman|Verdana|Verdana Bold|Helvetica Neue|Menlo|Menlo Bold|Proteus Missing Font'
PAGE="fonts.html?candidates=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$CANDIDATES")"

cat > "$WORK/winfonts.json" <<'EOF'
{
  "seed": "1111111111111111111",
  "fonts": ["Arial", "Calibri", "Helvetica Neue", "Menlo"],
  "fontAliases": {
    "Helvetica Neue": ["Font Not Installed Anywhere", "Verdana"],
    "Menlo": ["Consolas"],
    "Arial": ["Segoe UI"]
  }
}
EOF

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
has() { case "|$1|" in *"|$2|"*) echo yes ;; *) echo no ;; esac; }
sizeof() { echo "$1" | tr '|' '\n' | grep "^$2:" | cut -d: -f2; }

PLAIN=$(run "$PAGE")
PROF=$(run "$PAGE" --proteus-config="$WORK/winfonts.json")
PM=$(decode "$(field "$PLAIN" measured)"); PL=$(decode "$(field "$PLAIN" local)")
SM=$(decode "$(field "$PROF" measured)");  SL=$(decode "$(field "$PROF" local)")
PS=$(decode "$(field "$PLAIN" sizes)");    SS=$(decode "$(field "$PROF" sizes)")
echo "plain   measured: $PM"
echo "plain   local():  $PL"
echo "profile measured: $SM"
echo "profile local():  $SL"
echo "generic sizes plain/profile: $(field "$PLAIN" bases) / $(field "$PROF" bases)"

for font in "Arial" "Segoe UI" "Calibri" "Consolas" "Verdana" "Times New Roman"; do
  check "control: plain browser detects $font" "$(has "$PM" "$font")" yes
done
for font in "Helvetica Neue" "Menlo" "Proteus Missing Font"; do
  check "control: plain browser does not have $font" "$(has "$PM" "$font")" no
done

for font in "Arial" "Calibri" "Helvetica Neue" "Menlo"; do
  check "profile shows $font" "$(has "$SM" "$font")" yes
done
for font in "Segoe UI" "Consolas" "Verdana" "Proteus Missing Font"; do
  check "profile hides $font" "$(has "$SM" "$font")" no
done
# The fonts browsers use as defaults are never hidden, listed or not.
check  "Times New Roman stays available"          "$(has "$SM" "Times New Roman")" yes
check  "local(Verdana) is hidden"                 "$(has "$SL" "Verdana")" no
check  "local(Arial Bold) resolves"               "$(has "$SL" "Arial Bold")" yes
check  "local(Menlo Bold) resolves via the substitute" "$(has "$SL" "Menlo Bold")" yes
check  "Helvetica Neue renders as its installed substitute" \
       "$(sizeof "$SS" "Helvetica Neue")" "$(sizeof "$PS" "Verdana")"
check  "Menlo renders as its substitute"          "$(sizeof "$SS" "Menlo")" "$(sizeof "$PS" "Consolas")"
check  "installed Arial keeps its own appearance" "$(sizeof "$SS" "Arial")" "$(sizeof "$PS" "Arial")"
# The browser accepts a family name with a weight word on the end; such a name must
# be exactly as visible as its family, by measurement and by local() alike.
check  "control: plain browser finds the family name Calibri Light" "$(has "$PM" "Calibri Light")" yes
check  "a weight-suffixed name of an allowed family is found"  "$(has "$SM" "Calibri Light")" yes
check  "and renders as it does without a profile"   "$(sizeof "$SS" "Calibri Light")" "$(sizeof "$PS" "Calibri Light")"
check  "local() agrees for that name"               "$(has "$SL" "Calibri Light")" yes
check  "a weight-suffixed name of a hidden family stays hidden" "$(has "$SM" "Segoe UI Light")" no
check  "local() agrees for that name too"           "$(has "$SL" "Segoe UI Light")" no
check  "generic font rendering is unchanged"      "$(field "$PROF" bases)" "$(field "$PLAIN" bases)"
