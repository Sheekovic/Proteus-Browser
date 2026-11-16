# Patch 0021: phone profiles.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

cat > "$WORK/phone.json" <<'EOF'
{
  "seed": "1",
  "userAgent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36",
  "platform": "Linux armv81",
  "uaData": {"brand": "Google Chrome", "fullVersion": "158.0.8127.37", "platform": "Android",
             "platformVersion": "15.0.0", "architecture": "", "bitness": "", "model": "Pixel 8",
             "mobile": true, "wow64": false},
  "screen": {"width": 412, "height": 915, "availWidth": 412, "availHeight": 915, "colorDepth": 24},
  "mobile": {"viewWidth": 412, "viewHeight": 785, "deviceScaleFactor": 2.625, "maxTouchPoints": 5}
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""
PLAIN=$(run mobile.html)
BARE=$(run mobile.html --proteus-config="$WORK/bare.json")
# The manager starts a phone profile with touch events switched on.
PHONE=$(run mobile.html --proteus-config="$WORK/phone.json" --touch-events=enabled)
show "plain" "$PLAIN"
show "phone" "$PHONE"

# (The outer window size is left out: a headless browser reports it unevenly.)
check  "a profile without phone settings changes nothing"        "$(echo "$BARE" | sed 's/ outer=[^ ]*//')" "$(echo "$PLAIN" | sed 's/ outer=[^ ]*//')"
check  "control: the plain browser has no touch"    "$(field "$PLAIN" touchPoints)" "0"
check  "control: the plain browser has plugins"     "$(field "$PLAIN" plugins)" "5"

check  "screen is the phone's"                      "$(field "$PHONE" screen)" "412x915"
check  "the page is laid out at the phone's width"  "$(field "$PHONE" inner)" "412x785"
check  "device pixel ratio"                         "$(field "$PHONE" dpr)" "2.625"
check  "five touch points"                          "$(field "$PHONE" touchPoints)" "5"
check  "touch events exist"                         "$(field "$PHONE" touchEvents)" "true"
check  "the pointer is coarse"                      "$(field "$PHONE" coarse)" "true"
check  "no fine pointer at all"                     "$(field "$PHONE" anyFine)" "false"
check  "nothing can hover"                          "$(field "$PHONE" hover)" "false"
check  "portrait orientation"                       "$(field "$PHONE" orientation)" "portrait-primary"
check  "portrait media query"                       "$(field "$PHONE" portraitQuery)" "true"
check  "no plugins"                                 "$(field "$PHONE" plugins)" "0"
check  "no MIME types"                              "$(field "$PHONE" mimeTypes)" "0"
check  "no PDF viewer"                              "$(field "$PHONE" pdf)" "false"
check  "scrollbars take no width"                   "$(field "$PHONE" scrollbarWidth)" "0"
check  "client hints say mobile"                    "$(field "$PHONE" mobileHint)" "true"
check  "navigator.platform"                         "$(field "$PHONE" platform)" "Linux%20armv81"
