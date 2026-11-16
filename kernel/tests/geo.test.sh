# Patch 0015: the profile's position for navigator.geolocation.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

echo '{"seed": "1", "geolocation": {"latitude": 48.137154, "longitude": 11.576124, "accuracy": 37}}' > "$WORK/geo.json"
echo '{"seed": "1"}' > "$WORK/bare.json"
EXPECT="geo.html?expect=48.137154,11.576124"

VT_FLAGS=""   # The position arrives from the browser process in real time.

# Runs the page in a fresh browser profile where the test site may use geolocation, as
# if the user had clicked "Allow" there before.
# usage: allowed_run <profile name> [chrome flags...]
allowed_run() {
  local dir="$WORK/geo-$1"; shift
  mkdir -p "$dir/Default"
  echo "{\"profile\":{\"content_settings\":{\"exceptions\":{\"geolocation\":{\"http://127.0.0.1:$PORT,*\":{\"setting\":1}}}}}}" > "$dir/Default/Preferences"
  run "$EXPECT" --user-data-dir="$dir" "$@"
}

PLAIN=$(allowed_run plain)
BARE=$(allowed_run bare --proteus-config="$WORK/bare.json")
PROF=$(allowed_run profile --proteus-config="$WORK/geo.json")
ASKING=$(run "$EXPECT" --user-data-dir="$WORK/geo-not-allowed" --proteus-config="$WORK/geo.json")
echo "plain:   $PLAIN"
echo "profile: $PROF"
echo "profile, site not allowed: $ASKING"

check  "control: the plain browser is not at that position" "$(field "$PLAIN" matches)" "false"
check  "a profile without a position changes nothing"     "$(field "$BARE" matches)" "false"
differ "a site that was not allowed gets no position"     "$(field "$ASKING" state)" "ok"
if [ "$(field "$PLAIN" permission)" = "granted" ]; then
  check  "control: the test page was allowed to ask"      "$(field "$PROF" permission)" "granted"
  check  "the profile's position is reported"             "$(field "$PROF" matches)" "true"
  check  "with the profile's accuracy"                    "$(field "$PROF" accuracy)" "37"
  check  "as a fresh fix"                                 "$(field "$PROF" fresh)" "true"
else
  # Seen on Windows: the browser does not take the permission from a prepared
  # preferences file there, even without any profile. The manager's end-to-end test
  # grants it through DevTools instead and checks the position on every platform.
  echo "SKIP position checks: this browser ignores the prepared permission (plain: $(field "$PLAIN" permission))"
fi
