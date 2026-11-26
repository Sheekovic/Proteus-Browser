# Patch 0035: a page is laid out at the scale of the profile's system while the window
# is drawn at the machine's.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.
#
# The truth is the browser really started at a scale (--force-device-scale-factor),
# which is what a machine set to that scale is. A profile with that scale, on a
# browser at the machine's own, must read the same in everything a page can measure.

echo '{"seed": "1", "screen": {"width": 1536, "height": 864, "availWidth": 1536, "availHeight": 824}}' > "$WORK/screen.json"
SCALE_KEYS="ratio media mediaDpi width screen place pageBar boxBar box boxBorder lines text measure checkbox radio field range number date color button select list area progress meter rule summary fieldStyle areaStyle canvas ownClick frameRatio frameBorder image"

PLAIN=$(run scale.html --proteus-config="$WORK/screen.json" --window-size=800,600)
show "the machine's scale" "$PLAIN"
check "control: the machine's scale is 1" "$(field "$PLAIN" ratio)" "1"

for RATIO in 1.25 1.5 2; do
  echo "{\"seed\": \"1\", \"screen\": {\"width\": 1536, \"height\": 864, \"availWidth\": 1536, \"availHeight\": 824, \"pixelRatio\": $RATIO}}" > "$WORK/scale-$RATIO.json"
  REAL=$(run scale.html --proteus-config="$WORK/screen.json" --window-size=800,600 --force-device-scale-factor=$RATIO)
  # A profile's first window leaves room for its bars, which do not grow with the
  # page (patch 0042): asked for this much more, it is as large as the other.
  case $RATIO in 1.25) SIZE=808,632 ;; 1.5) SIZE=813,653 ;; 2) SIZE=820,680 ;; esac
  OURS=$(run scale.html --proteus-config="$WORK/scale-$RATIO.json" --window-size=$SIZE)
  show "started at $RATIO" "$REAL"
  show "a profile at $RATIO" "$OURS"
  check  "control: started at $RATIO the page reads $RATIO" "$(field "$REAL" ratio)" "$RATIO"
  differ "control: at $RATIO borders are not the machine's" "$(field "$REAL" lines)" "$(field "$PLAIN" lines)"
  # The browser's own bars are drawn at the machine's scale. How thick a page finds
  # them (the window's size less its own) is so many units on any machine, give or
  # take the one device pixel their drawing is rounded by at each scale.
  OURS_BARS=$(field "$OURS" bars); REAL_BARS=$(field "$REAL" bars)
  check "at $RATIO: the window is as much wider than the page" "${OURS_BARS%x*}" "${REAL_BARS%x*}"
  APART=$(( ${OURS_BARS#*x} - ${REAL_BARS#*x} ))
  check "at $RATIO: its bars are as thick, within a pixel ($OURS_BARS, $REAL_BARS)" "$([ ${APART#-} -le 1 ] && echo yes || echo no)" "yes"
  for KEY in $SCALE_KEYS; do
    check "at $RATIO: $KEY is what a machine at that scale has" "$(field "$OURS" $KEY)" "$(field "$REAL" $KEY)"
  done
done
