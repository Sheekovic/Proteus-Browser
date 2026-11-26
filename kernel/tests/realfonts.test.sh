# The fonts that come with Proteus (release/fonts.txt), as an Android profile has them:
# every font Android has is found by its own name and is itself, not a stand-in.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# Needs the fonts in /opt/proteus/fonts-cache/shipped/fonts (release/fetch-fonts.sh).

FONTS=/opt/proteus/fonts-cache/shipped/fonts
if [ ! -f "$FONTS/DroidSansMono.ttf" ]; then
  echo "SKIP the fonts that come with Proteus: they are not in $FONTS"
  return 0 2>/dev/null || true
fi

OWN='Roboto|Noto Sans|Noto Serif|Noto Color Emoji|Droid Sans Mono|Cutive Mono|Coming Soon|Dancing Script|Carrois Gothic SC'
ANSWERS='Arial|Times New Roman|Courier New|Monaco|Noto Sans CJK JP'
ALL="$OWN|$ANSWERS"
PAGE="fonts.html?candidates=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$ALL")"
LIST=$(python3 -c 'import sys, json; print(json.dumps(sys.argv[1].split("|")))' "$ALL")
cat > "$WORK/android-fonts.json" <<EOF
{"seed": "1", "fonts": $LIST, "fontDir": "$FONTS",
 "fontAnswers": {"Arial": "Roboto", "Times New Roman": "Noto Serif", "Courier New": "Cutive Mono",
                 "Monaco": "Droid Sans Mono", "Noto Sans CJK JP": "Noto Sans JP"}}
EOF
echo "{\"seed\": \"1\", \"fonts\": $LIST}" > "$WORK/android-nofonts.json"

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
sized() { decode "$(field "$1" sizes)" | tr '|' '\n' | grep "^$2:" | cut -d: -f2; }
WITH=$(run "$PAGE" --proteus-config="$WORK/android-fonts.json")
WITHOUT=$(run "$PAGE" --proteus-config="$WORK/android-nofonts.json")
echo "measured: $(decode "$(field "$WITH" measured)")"
echo "local():  $(decode "$(field "$WITH" local)")"
echo "sizes:    $(decode "$(field "$WITH" sizes)")"

check "every font Android has is found by measuring" "$(decode "$(field "$WITH" measured)")" "$ALL"
check "a name Android answers to is drawn with Android's own face: Arial as Roboto" "$(sized "$WITH" Arial)" "$(sized "$WITH" Roboto)"
check "Times New Roman as Noto Serif" "$(sized "$WITH" 'Times New Roman')" "$(sized "$WITH" 'Noto Serif')"
check "Courier New as Cutive Mono"    "$(sized "$WITH" 'Courier New')" "$(sized "$WITH" 'Cutive Mono')"
differ "the fonts have measures of their own: Roboto is not Noto Sans" "$(sized "$WITH" Roboto)" "$(sized "$WITH" 'Noto Sans')"
differ "control: without the folder Roboto is not found, or is a stand-in" "$(sized "$WITHOUT" Roboto)" "$(sized "$WITH" Roboto)"
