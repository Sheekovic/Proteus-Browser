# Patch 0013: noise only where content depends on the device, and no automation marker.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.
#
# detect.html asks questions whose answers are known for an unmodified browser; a
# protected profile must give the same answers while its fingerprints still differ.

echo '{"seed": "1111111111111111111", "canvasNoise": true, "audioNoise": true}' > "$WORK/a.json"
echo '{"seed": "2222222222222222222", "canvasNoise": true, "audioNoise": true}' > "$WORK/b.json"

VT_FLAGS=""   # Workers, image decoding and audio rendering need real time.

PLAIN=$(run detect.html)
A=$(run detect.html --proteus-config="$WORK/a.json")
A2=$(run detect.html --proteus-config="$WORK/a.json")
B=$(run detect.html --proteus-config="$WORK/b.json")
show "plain" "$PLAIN"
show "profile" "$A"

for name in canvasPutRoundTrip canvasKnownRects canvasRepeatable canvasTwoCanvasesAgree \
            canvasSubrectAgrees canvasPngMatchesPixels canvasCopyAgrees canvasShiftInvariant \
            audioKnownBufferExact audioRepeatable audioCopyMatchesChannel audioChannelsAgree \
            geometryExact; do
  check "control: plain browser passes $name" "$(field "$PLAIN" $name)" "1"
  check "profile passes $name"                "$(field "$A" $name)" "1"
done

check  "profile shows no automation marker" "$(field "$A" notAutomated)" "1"

differ "canvas fingerprint differs from the real one"  "$(field "$A" canvasHash)" "$(field "$PLAIN" canvasHash)"
differ "audio fingerprint differs from the real one"   "$(field "$A" audioHash)"  "$(field "$PLAIN" audioHash)"
differ "canvas fingerprint differs between profiles"   "$(field "$A" canvasHash)" "$(field "$B" canvasHash)"
differ "audio fingerprint differs between profiles"    "$(field "$A" audioHash)"  "$(field "$B" audioHash)"
check  "canvas fingerprint is stable for a profile"    "$(field "$A" canvasHash)" "$(field "$A2" canvasHash)"
check  "audio fingerprint is stable for a profile"     "$(field "$A" audioHash)"  "$(field "$A2" audioHash)"
