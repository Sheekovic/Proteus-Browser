# Patch 0038: a profile can name a folder of font files that count as installed.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The folder holds Ahem, a font made for tests that no machine has installed and in
# which every letter is a square: text in it has a size nothing else gives.

mkdir -p "$WORK/shipped"
cp third_party/blink/web_tests/resources/Ahem.ttf "$WORK/shipped/"
CANDIDATES='Ahem|DejaVu Sans|Proteus Missing Font'
PAGE="fonts.html?candidates=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$CANDIDATES")"

echo '{"seed": "1", "fonts": ["Ahem", "DejaVu Sans"]}' > "$WORK/claimed.json"
echo "{\"seed\": \"1\", \"fonts\": [\"Ahem\", \"DejaVu Sans\"], \"fontDir\": \"$WORK/shipped\"}" > "$WORK/shipped.json"
echo "{\"seed\": \"1\", \"fonts\": [\"DejaVu Sans\"], \"fontDir\": \"$WORK/shipped\"}" > "$WORK/unclaimed.json"
echo "{\"seed\": \"1\", \"fonts\": [\"Ahem\", \"Roboto\"], \"fontDir\": \"$WORK/shipped\", \"fontAliases\": {\"Roboto\": [\"Ahem\"]}}" > "$WORK/standin.json"

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
has() { case "|$1|" in *"|$2|"*) echo yes ;; *) echo no ;; esac; }
found() { echo "$(has "$(decode "$(field "$1" measured)")" "$2")/$(has "$(decode "$(field "$1" local)")" "$2")"; }

CLAIMED=$(run "$PAGE" --proteus-config="$WORK/claimed.json")
SHIPPED=$(run "$PAGE" --proteus-config="$WORK/shipped.json")
UNCLAIMED=$(run "$PAGE" --proteus-config="$WORK/unclaimed.json")
STANDIN=$(run "fonts.html?candidates=Roboto" --proteus-config="$WORK/standin.json")
show "with the folder" "$SHIPPED"

check "control: the machine does not have the font"            "$(found "$CLAIMED" Ahem)" "no/no"
check "a font of the folder is found, measured and by local()" "$(found "$SHIPPED" Ahem)" "yes/yes"
check "the machine's own fonts are found as before"            "$(found "$SHIPPED" 'DejaVu Sans')" "yes/yes"
check "what nobody has is still not found"                     "$(found "$SHIPPED" 'Proteus Missing Font')" "no/no"
check "a font of the folder the profile does not claim is hidden" "$(found "$UNCLAIMED" Ahem)" "no/no"
sized() { decode "$(field "$1" sizes)" | tr '|' '
' | grep "^$2:" | cut -d: -f2; }
check "a font of the folder stands in for one the profile claims" "$(has "$(decode "$(field "$STANDIN" measured)")" Roboto)" "yes"
check "and is drawn as itself (squares)" "$(sized "$STANDIN" Roboto)" "$(sized "$SHIPPED" Ahem)"
