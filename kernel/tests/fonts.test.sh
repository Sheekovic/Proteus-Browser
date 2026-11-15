# Patch 0008: installed-font allow-list.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The candidates are fonts installed on the build server plus one that is not. The
# profile allows only two of them; everything else must become undetectable, while
# text in the generic families keeps its exact size.

CANDIDATES='DejaVu Sans|DejaVu Serif|DejaVu Sans Mono|Lato|Nimbus Sans|Nimbus Roman|URW Gothic|C059|Proteus Missing Font'
PAGE="fonts.html?candidates=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$CANDIDATES")"

cat > "$WORK/fonts.json" <<'EOF'
{"seed": "1111111111111111111", "fonts": ["Lato", "DejaVu Sans"]}
EOF
echo '{"seed": "1111111111111111111"}' > "$WORK/bare.json"

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
has() { case "|$1|" in *"|$2|"*) echo yes ;; *) echo no ;; esac; }

PLAIN=$(run "$PAGE")
BARE=$(run "$PAGE" --proteus-config="$WORK/bare.json")
LIST=$(run "$PAGE" --proteus-config="$WORK/fonts.json")

PM=$(decode "$(field "$PLAIN" measured)"); PL=$(decode "$(field "$PLAIN" local)")
LM=$(decode "$(field "$LIST" measured)");  LL=$(decode "$(field "$LIST" local)")
echo "plain   measured: $PM"
echo "plain   local():  $PL"
echo "profile measured: $LM"
echo "profile local():  $LL"
echo "generic sizes plain/profile: $(field "$PLAIN" bases) / $(field "$LIST" bases)"

check  "profile without a font list changes nothing"  "$BARE" "$PLAIN"

# Controls: the test can see these fonts on an unmodified browser.
for font in "Lato" "DejaVu Sans" "DejaVu Serif" "Nimbus Roman" "URW Gothic"; do
  check "control: plain browser detects $font (measurement)" "$(has "$PM" "$font")" yes
done
check  "control: a missing font is not detected"      "$(has "$PM" "Proteus Missing Font")" no
check  "control: plain browser resolves local(Nimbus Roman)" "$(has "$PL" "Nimbus Roman")" yes
# "DejaVu Sans Mono" starts with the allowed name "DejaVu Sans" but is a different
# family; it must not slip through.
check  "control: plain browser resolves local(DejaVu Sans Mono)" "$(has "$PL" "DejaVu Sans Mono")" yes

# With the list, exactly the allowed fonts remain. (local() wants a full font name,
# so even the plain browser does not resolve the bare family name "Lato".)
check  "allowed fonts are the only ones measured"     "$LM" "DejaVu Sans|Lato"
check  "allowed fonts are the only ones local() finds" "$LL" "DejaVu Sans"
check  "generic font rendering is unchanged"          "$(field "$LIST" bases)" "$(field "$PLAIN" bases)"

echo "-- earlier patches still hold"
CV=$(run canvas.html --proteus-config="$WORK/fonts.json")
check  "canvas drawing still works with a font list"  "$(field "$CV" stable)" true
