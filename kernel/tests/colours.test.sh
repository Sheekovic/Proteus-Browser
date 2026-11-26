# Patch 0042: the screen's colours follow the system a profile claims, and a profile
# without a window has a window's bars.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The tests run without a window, which is the case the bars are about.

SCREEN='"screen": {"width": 1536, "height": 864, "availWidth": 1536, "availHeight": 824}'
echo "{\"seed\": \"1\", \"platform\": \"Win32\", $SCREEN}" > "$WORK/col-win.json"
echo "{\"seed\": \"1\", \"platform\": \"Linux x86_64\", $SCREEN}" > "$WORK/col-linux.json"
echo "{\"seed\": \"1\", \"platform\": \"MacIntel\", $SCREEN}" > "$WORK/col-mac.json"
echo "{\"seed\": \"1\", \"platform\": \"iPhone\", $SCREEN}" > "$WORK/col-iphone.json"
echo "{\"seed\": \"1\", \"platform\": \"Win32\", \"screen\": {\"width\": 1536, \"height\": 864, \"availWidth\": 1536, \"availHeight\": 824, \"pixelRatio\": 1.25}}" > "$WORK/col-scaled.json"
echo "{\"seed\": \"1\", \"platform\": \"Win32\", \"screen\": {\"width\": 1280, \"height\": 720, \"availWidth\": 1280, \"availHeight\": 680, \"pixelRatio\": 2}}" > "$WORK/col-two.json"
echo '{"seed": "1"}' > "$WORK/bare.json"

BARE=$(run colours.html --proteus-config="$WORK/bare.json" --window-size=1000,700)
WIN=$(run colours.html --proteus-config="$WORK/col-win.json" --window-size=1000,700)
LINUX=$(run colours.html --proteus-config="$WORK/col-linux.json" --window-size=1000,700)
MAC=$(run colours.html --proteus-config="$WORK/col-mac.json" --window-size=1000,700)
IPHONE=$(run colours.html --proteus-config="$WORK/col-iphone.json" --window-size=1000,700)
SCALED=$(run colours.html --proteus-config="$WORK/col-scaled.json" --window-size=1000,700)
TWO=$(run colours.html --proteus-config="$WORK/col-two.json" --window-size=1280,680)
show "without a profile's screen" "$BARE"
show "a Windows profile" "$WIN"

check "a Windows computer's screen: the usual colours, the usual range" "$(field "$WIN" gamut)/$(field "$WIN" range)" "100/10"
check "a Linux computer's the same"                                     "$(field "$LINUX" gamut)/$(field "$LINUX" range)" "100/10"
check "a Mac's shows P3"                                                "$(field "$MAC" gamut)/$(field "$MAC" range)" "110/10"
check "an iPhone's shows P3 and a high range"                           "$(field "$IPHONE" gamut)/$(field "$IPHONE" range)" "110/11"
differ "control: without a window the frame is not a window's"          "$(field "$BARE" bars)" "16x95"
check "a profile without a window has a window's bars"                  "$(field "$WIN" bars)" "16x95"
check "and those of its scale"                                          "$(field "$SCALED" bars)" "14x94"
# A window as large as the profile's work area, on a machine at half the profile's scale.
TWO_BARS=$(field "$TWO" bars)
check "at twice the machine's scale the bars are a window's too"        "$TWO_BARS" "13x93"
