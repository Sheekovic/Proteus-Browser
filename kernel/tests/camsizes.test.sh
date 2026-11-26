# Patch 0036: a camera whose picture comes from a file offers the sizes a camera offers.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

# A video of plain frames, 640 by 480 and dark, as the manager makes for a covered lens.
python3 - "$WORK/lens.y4m" <<'EOF'
import sys
width, height = 640, 480
with open(sys.argv[1], 'wb') as video:
    video.write(b'YUV4MPEG2 W%d H%d F30:1 Ip A1:1 C420jpeg\n' % (width, height))
    for frame in range(4):
        video.write(b'FRAME\n')
        video.write(bytes(16 + ((x + frame) % 5) for x in range(width * height)))
        video.write(bytes([128]) * (width * height // 2))
EOF
cat > "$WORK/cam-desktop.json" <<'EOF'
{"seed": "1", "mediaDevices": {"audioInput": [{"label": "Microphone (Realtek(R) Audio)"}],
                                "videoInput": [{"label": "Integrated Webcam (0c45:6730)"}]}}
EOF
cat > "$WORK/cam-phone.json" <<'EOF'
{"seed": "1", "mobile": {"viewWidth": 412, "viewHeight": 915, "deviceScaleFactor": 2.625, "maxTouchPoints": 5},
 "screen": {"width": 412, "height": 915},
 "mediaDevices": {"audioInput": [{"label": "Default"}],
                  "videoInput": [{"label": "camera2 1, facing front"}, {"label": "camera2 0, facing back"}]}}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""   # A camera delivers its frames in real time.
camera() { run camsizes.html --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
               --use-file-for-fake-video-capture="$WORK/lens.y4m" "$@"; }
BARE=$(camera --proteus-config="$WORK/bare.json")
DESK=$(camera --proteus-config="$WORK/cam-desktop.json")
PHONE=$(camera --proteus-config="$WORK/cam-phone.json")
VT_FLAGS="--virtual-time-budget=6000"
show "without devices of its own" "$BARE"
show "a computer's camera" "$DESK"
show "a phone's camera" "$PHONE"

if [ "$(field "$BARE" plain)" = "" ] || [ "$(field "$BARE" plain)" = "NotFoundError" ]; then
  echo "SKIP camera sizes: no camera from a file in this environment"
  return 0 2>/dev/null || true
fi

check "control: without a profile's devices the file has its one size" "$(field "$BARE" most)" "640x480"
check "control: and asked for 1280 by 720 it has nothing larger to give" "$(field "$BARE" wide)" "640x480/640x480/dark"
# (A smaller size the browser makes itself from a larger one, with any camera.)

check "asked for nothing, a camera gives 640 by 480"      "$(field "$DESK" plain)" "640x480/640x480/dark"
check "a computer's camera goes up to 1280 by 720"        "$(field "$DESK" most)" "1280x720"
check "it cannot be turned or zoomed"                     "$(field "$DESK" turns)" ""
check "asked for 1280 by 720, it gives that"              "$(field "$DESK" wide)" "1280x720/1280x720/dark"
check "asked for exactly 320 by 240, it gives that"       "$(field "$DESK" small)" "320x240/320x240/dark"
check "what it does not have is still an error"           "$(field "$DESK" full)" "OverconstrainedError"
check "a phone's camera goes up to 1920 by 1080"          "$(field "$PHONE" most)" "1920x1080"
check "and gives that when asked for exactly it"          "$(field "$PHONE" full)" "1920x1080/1920x1080/dark"
