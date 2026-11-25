# Patch 0031: static members, constants, and members of the global object that a
# browser has in a page and not in a worker or the other way round.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

cat > "$WORK/statics.json" <<EOF
{
  "seed": "1",
  "hide": {
    "globalThis": ["EyeDropper"],
    "window": ["IdleDetector"],
    "worker": ["USB"],
    "URL.": ["canParse"],
    "WebGLRenderingContext": ["RGB8"],
    "WebGLRenderingContext.": ["RGB8"]
  },
  "keepConstants": {"WebGL2RenderingContext": ["RGB8"]}
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""
PLAIN=$(run statics.html)
BARE=$(run statics.html --proteus-config="$WORK/bare.json")
HID=$(run statics.html --proteus-config="$WORK/statics.json")
show "plain" "$PLAIN"
show "hidden" "$HID"

check  "a profile without these settings changes nothing" "$BARE" "$PLAIN"
check  "control: URL has the two static members"   "$(field "$PLAIN" canParse)/$(field "$PLAIN" parse)" "function/function"
check  "control: a constant is fixed, on the interface and its prototype" "$(field "$PLAIN" rgb8) $(field "$PLAIN" rgb8Proto)" "32849/false/true/false 32849/false/true/false"
check  "control: a worker has IdleDetector and USB" "$(field "$PLAIN" w_idle)/$(field "$PLAIN" w_usb)" "function/function"

check  "a static member is gone"                    "$(field "$HID" canParse)" "undefined"
check  "the one beside it stays"                    "$(field "$HID" parse)" "function"
check  "gone in a worker too"                       "$(field "$HID" w_canParse)/$(field "$HID" w_parse)" "undefined/function"
check  "a constant is gone from the interface and its prototype" "$(field "$HID" rgb8) $(field "$HID" rgb8Proto) $(field "$HID" rgb8In)" "none none false"
check  "in a worker as well"                        "$(field "$HID" w_rgb8) $(field "$HID" w_rgb8Proto)" "none none"
check  "a constant that was not named is as fixed as before" "$(field "$HID" rgba4)" "$(field "$PLAIN" rgba4)"
check  "the same constant on an interface that keeps it is there, and fixed" "$(field "$HID" rgb8Two) $(field "$HID" rgb8TwoProto)" "32849/false/true/false 32849/false/true/false"
check  "and in a worker"                            "$(field "$HID" w_rgb8Two) $(field "$HID" w_rgb8TwoProto)" "32849/false/true/false 32849/false/true/false"
check  "named for a page alone: gone there, still in a worker" "$(field "$HID" idle)/$(field "$HID" w_idle)" "undefined/function"
check  "named for a worker alone: gone there, still in a page" "$(field "$HID" usb)/$(field "$HID" w_usb)" "function/undefined"
check  "named for both: gone in both"               "$(field "$HID" eye)/$(field "$HID" w_eye)" "undefined/undefined"
