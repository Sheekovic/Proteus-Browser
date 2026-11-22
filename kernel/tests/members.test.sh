# Patch 0029: what a profile's browser has, beyond navigator.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

cat > "$WORK/safari.json" <<EOF
{
  "seed": "1",
  "hide": {
    "globalThis": ["EyeDropper", "showOpenFilePicker", "getScreenDetails", "IdleDetector", "documentPictureInPicture", "XR*", "USB*"],
    "Screen": ["isExtended", "onchange"]
  },
  "screen": {"width": 393, "height": 852, "availWidth": 393, "availHeight": 852, "colorDepth": 24}
}
EOF
cat > "$WORK/mac.json" <<EOF
{
  "seed": "1",
  "screen": {"width": 1512, "height": 982, "availWidth": 1512, "availHeight": 944, "availTop": 38, "colorDepth": 30}
}
EOF
# A work area that would start below where it can end is not believed.
cat > "$WORK/badtop.json" <<EOF
{
  "seed": "1",
  "screen": {"width": 1512, "height": 982, "availWidth": 1512, "availHeight": 944, "availTop": 400, "colorDepth": 30}
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""
PLAIN=$(run members.html)
BARE=$(run members.html --proteus-config="$WORK/bare.json")
SAFARI=$(run members.html --proteus-config="$WORK/safari.json")
MAC=$(run members.html --proteus-config="$WORK/mac.json")
BADTOP=$(run members.html --proteus-config="$WORK/badtop.json")
show "plain" "$PLAIN"
show "safari" "$SAFARI"
show "mac" "$MAC"

check  "a profile without these settings changes nothing" "$BARE" "$PLAIN"
check  "control: Chrome has the five members"     "$(field "$PLAIN" globals)" "EyeDropper,showOpenFilePicker,getScreenDetails,IdleDetector,documentPictureInPicture"
differ "control: and the WebXR interfaces"        "$(field "$PLAIN" xr)" "0"
differ "control: and the WebUSB interfaces"       "$(field "$PLAIN" usb)" "0"
check  "control: a worker has its own"            "$(field "$PLAIN" workerGlobals)" "IdleDetector,USB,FileSystemSyncAccessHandle,fetch"
check  "control: the screen has the two members"  "$(field "$PLAIN" screenKeys)" "isExtended,onchange"

check  "the members of the global object are gone" "$(field "$SAFARI" globals)" "none"
check  "and not listed on it"                     "$(field "$SAFARI" listed)" "false"
check  "nor known by type"                        "$(field "$SAFARI" typeofEyeDropper)" "undefined"
check  "every interface that starts with XR"      "$(field "$SAFARI" xr)" "0"
check  "every interface that starts with USB"     "$(field "$SAFARI" usb)" "0"
check  "what was not named stays"                 "$(field "$SAFARI" kept)" "XMLHttpRequest,URL,Element,fetch,EventTarget"
check  "gone in a new frame"                      "$(field "$SAFARI" frameGlobals)" "none"
check  "the prefixes too"                         "$(field "$SAFARI" frameXr)" "0"
check  "gone in a worker, where the rest stays"   "$(field "$SAFARI" workerGlobals)" "FileSystemSyncAccessHandle,fetch"
check  "members of Screen go as those of Navigator do" "$(field "$SAFARI" screenKeys)" "none"

# One screen, whatever the machine has: the build server has one, so this only shows
# on a machine with two (the end-to-end test on Windows checks it there).
check  "a profile's screen is one screen"         "$(field "$MAC" extended)" "false"
check  "the work area starts below the menu bar"  "$(field "$MAC" avail)" "0/38/1512/944"
check  "a top that does not fit is not believed"  "$(field "$BADTOP" avail)" "0/0/1512/944"
check  "without one it starts at the top"         "$(field "$SAFARI" avail)" "0/0/393/852"
