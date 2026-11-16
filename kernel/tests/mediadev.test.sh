# Patch 0026: microphones, cameras and speakers from the profile.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

cat > "$WORK/md-desktop.json" <<'EOF'
{
  "seed": "1",
  "mediaDevices": {
    "audioInput": [
      {"id": "default", "label": "Default - Microphone (Realtek(R) Audio)"},
      {"id": "communications", "label": "Communications - Microphone (Realtek(R) Audio)"},
      {"label": "Microphone (Realtek(R) Audio)"}
    ],
    "videoInput": [{"label": "Integrated Webcam (0c45:6730)"}],
    "audioOutput": [
      {"id": "default", "label": "Default - Speakers (Realtek(R) Audio)"},
      {"label": "Speakers (Realtek(R) Audio)"}
    ]
  }
}
EOF
cat > "$WORK/md-phone.json" <<'EOF'
{
  "seed": "1",
  "mediaDevices": {
    "audioInput": [{"label": "iPhone Microphone"}],
    "videoInput": [{"label": "Front Camera"}, {"label": "Back Camera"}]
  }
}
EOF
echo '{"seed": "1", "mediaDevices": {}}' > "$WORK/md-none.json"
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""   # The device list arrives from the browser process in real time.

# The browser's built-in stand-in devices, and a user who always answers "Allow":
# the same on every machine, whether or not it has a camera.
devices() { run mediadev.html --use-fake-device-for-media-stream --use-fake-ui-for-media-stream "$@"; }

# What a page sees before it was allowed anything: the same devices, a user who has
# not answered.
before() { run "mediadev.html?list" --use-fake-device-for-media-stream "$@"; }

PLAIN=$(devices)
BARE=$(devices --proteus-config="$WORK/bare.json")
DESK=$(devices --proteus-config="$WORK/md-desktop.json")
PHONE=$(devices --proteus-config="$WORK/md-phone.json")
NONE=$(devices --proteus-config="$WORK/md-none.json")
PLAIN_BEFORE=$(before)
DESK_BEFORE=$(before --proteus-config="$WORK/md-desktop.json")
PHONE_BEFORE=$(before --proteus-config="$WORK/md-phone.json")
NONE_BEFORE=$(before --proteus-config="$WORK/md-none.json")
echo "before:  plain $PLAIN_BEFORE / desktop $DESK_BEFORE / phone $PHONE_BEFORE / none $NONE_BEFORE"
echo "plain:   $PLAIN"
echo "desktop: $DESK"
echo "phone:   $PHONE"
echo "none:    $NONE"

check  "control: the test devices can be opened"              "$(field "$PLAIN" open)" "ok"
check  "control: and are the browser's stand-ins"             "$(field "$PLAIN" fake)" "true"
check  "a profile without devices changes nothing: kinds"     "$(field "$BARE" kinds)" "$(field "$PLAIN" kinds)"
check  "a profile without devices changes nothing: cameras"   "$(field "$BARE" cameras)" "$(field "$PLAIN" cameras)"
check  "a profile without devices changes nothing: mics"      "$(field "$BARE" mics)" "$(field "$PLAIN" mics)"

check  "before permission: one entry for each kind it has"    "$(field "$DESK_BEFORE" kinds)" "audioinput,videoinput,audiooutput"
check  "before permission: without names or ids"              "$(field "$DESK_BEFORE" nameless)" "true"
check  "control: the plain browser is nameless then too"       "$(field "$PLAIN_BEFORE" nameless)" "true"
check  "the devices can still be opened"                      "$(field "$DESK" open)" "ok"
check  "the profile's microphones" "$(field "$DESK" mics)" \
       "Default_-_Microphone_(Realtek(R)_Audio)|Communications_-_Microphone_(Realtek(R)_Audio)|Microphone_(Realtek(R)_Audio)"
check  "the profile's camera"                                 "$(field "$DESK" cameras)" "Integrated_Webcam_(0c45:6730)"
check  "the profile's speakers" "$(field "$DESK" speakers)" \
       "Default_-_Speakers_(Realtek(R)_Audio)|Speakers_(Realtek(R)_Audio)"
check  "nothing names this machine's devices"                 "$(field "$DESK" fake)" "false"
check  "ids look like the browser's"                          "$(field "$DESK" idShape)" "true"
check  "group ids look like the browser's"                    "$(field "$DESK" groupShape)" "true"
check  "every device has its own id"                          "$(field "$DESK" idsDiffer)" "true"
check  "the opened camera carries the profile's name"         "$(field "$DESK" cameraTrack)" "Integrated_Webcam_(0c45:6730)"
check  "the opened microphone is one of the listed ones"      "$(field "$DESK" micTrackListed)" "true"
check  "the opened camera's id is in the list"                "$(field "$DESK" cameraTrackId)" "true"
check  "the opened microphone's id is in the list"            "$(field "$DESK" micTrackId)" "true"
check  "capabilities belong to the listed devices"            "$(field "$DESK" capabilities)" "true"

check  "phone, before permission: no speaker entry"           "$(field "$PHONE_BEFORE" kinds)" "audioinput,videoinput"
check  "phone: two cameras, though this machine has one"      "$(field "$PHONE" cameras)" "Front_Camera|Back_Camera"
check  "phone: one microphone"                                "$(field "$PHONE" mics)" "iPhone_Microphone"
check  "phone: no speakers listed"                            "$(field "$PHONE" speakers)" "none"
check  "phone: the added camera has an id of its own"         "$(field "$PHONE" idsDiffer)" "true"
check  "phone: ids look like the browser's"                   "$(field "$PHONE" idShape)" "true"
check  "phone: the opened camera is the first one"            "$(field "$PHONE" cameraTrack)" "Front_Camera"
check  "phone: the opened microphone"                         "$(field "$PHONE" micTrack)" "iPhone_Microphone"
check  "phone: its id is the listed microphone's"              "$(field "$PHONE" micTrackId)" "true"
check  "phone: capabilities belong to the listed devices"     "$(field "$PHONE" capabilities)" "true"

check  "a machine without devices lists none"                 "$(field "$NONE_BEFORE" kinds)" "none"
