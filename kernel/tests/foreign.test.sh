# Patch 0022: profiles of a browser from another vendor.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
cat > "$WORK/iphone.json" <<EOF
{
  "seed": "1",
  "userAgent": "$UA",
  "platform": "iPhone",
  "vendor": "Apple Computer, Inc.",
  "clientHints": false,
  "chromeObject": false,
  "hide": {
    "Navigator": ["userAgentData", "connection", "getBattery", "deviceMemory"],
    "WorkerNavigator": ["userAgentData", "connection", "deviceMemory"]
  },
  "screen": {"width": 393, "height": 852, "availWidth": 393, "availHeight": 852, "colorDepth": 24},
  "mobile": {"viewWidth": 393, "viewHeight": 659, "deviceScaleFactor": 3, "maxTouchPoints": 5, "pdfViewer": true}
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""
PLAIN=$(run foreign.html)
BARE=$(run foreign.html --proteus-config="$WORK/bare.json")
IPHONE=$(run foreign.html --proteus-config="$WORK/iphone.json" --touch-events=enabled)
show "plain" "$PLAIN"
show "iphone" "$IPHONE"

check  "a profile without these settings changes nothing"  "$BARE" "$PLAIN"
check  "control: Chrome's vendor"                 "$(field "$PLAIN" vendor)" "Google%20Inc."
check  "control: Chrome has the four members"     "$(field "$PLAIN" members)" "userAgentData,connection,getBattery,deviceMemory"
check  "control: Chrome has window.chrome"        "$(field "$PLAIN" chrome)" "object"
differ "control: Chrome sends client hints"       "$(field "$PLAIN" hintHeaders)" "none"

check  "navigator.vendor"                         "$(field "$IPHONE" vendor)" "Apple%20Computer%2C%20Inc."
check  "the members are gone"                     "$(field "$IPHONE" members)" "none"
check  "and not listed on the prototype"          "$(field "$IPHONE" keysHaveHidden)" "false"
check  "gone in a new frame"                      "$(field "$IPHONE" frameMembers)" "none"
check  "gone in a worker"                         "$(field "$IPHONE" workerMembers)" "none"
check  "no window.chrome"                         "$(field "$IPHONE" chrome)" "undefined"
check  "not even as an own property"              "$(field "$IPHONE" chromeOwn)" "false"
check  "no window.chrome in a new frame"          "$(field "$IPHONE" frameChrome)" "undefined"
check  "no client hint request headers"           "$(field "$IPHONE" hintHeaders)" "none"
check  "this phone keeps its PDF plugins"         "$(field "$IPHONE" plugins)" "5"
check  "and its PDF viewer"                       "$(field "$IPHONE" pdf)" "true"
