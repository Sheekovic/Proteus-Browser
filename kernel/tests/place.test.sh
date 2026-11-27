# Patch 0043: a profile's place moves while it runs.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The browser starts in New York. A few seconds later "place.json" appears beside its
# configuration, saying Berlin; the page that was open all along has to be in Berlin
# then, with every worker and every later process, without anything being started
# again.

VT_FLAGS=""   # The move happens in real time.

mkdir -p "$WORK/moving" "$WORK/staying" "$WORK/stale"
NEW_YORK='{"seed": "1111111111111111111", "webRtcPolicy": "proxyOnly", "webRtcPublicIp": "203.0.113.10",
  "languages": ["en-US", "en"], "timezone": "America/New_York",
  "geolocation": {"latitude": 40.7128, "longitude": -74.006, "accuracy": 40}}'
BERLIN='{"id": "move-1", "timezone": "Europe/Berlin", "languages": ["de-DE", "de", "en-US", "en"], "webRtcPublicIp": "198.51.100.20",
  "geolocation": {"latitude": 52.52, "longitude": 13.405, "accuracy": 40}}'
for dir in moving staying stale; do echo "$NEW_YORK" > "$WORK/$dir/kernel.json"; done
# Left by an earlier run: not this run's place.
echo "$BERLIN" > "$WORK/stale/place.json"

# usage: allowed <name> [chrome flags...]: runs the page where the site may ask for the position.
allowed() {
  local name=$1; shift
  local dir="$WORK/place-$name"
  mkdir -p "$dir/Default"
  echo "{\"profile\":{\"content_settings\":{\"exceptions\":{\"geolocation\":{\"http://127.0.0.1:$PORT,*\":{\"setting\":1}}}}}}" > "$dir/Default/Preferences"
  run "place.html?frame=http://localhost:$PORT" --user-data-dir="$dir" --proteus-config="$WORK/$name/kernel.json" "$@"
}

# Written whole and put in place in one step, as the manager does.
(sleep 6; echo "$BERLIN" > "$WORK/moving/place.tmp"; mv "$WORK/moving/place.tmp" "$WORK/moving/place.json") &
MOVER=$!
MOVED=$(allowed moving)
wait $MOVER
STAYED=$(allowed staying)
STALE=$(allowed stale)
show "moved" "$MOVED"
show "stayed" "$STAYED"

echo "-- before the move the page is in New York"
check  "time zone"                         "$(field "$MOVED" zoneBefore)" "America%2FNew_York"
check  "UTC offset in winter"              "$(field "$MOVED" offsetBefore)" "300"
check  "navigator.languages"               "$(field "$MOVED" languagesBefore)" "en-US%2Cen"
check  "Accept-Language"                   "$(field "$MOVED" headerBefore)" "en-US%2Cen%3Bq%3D0.9"
check  "a worker"                          "$(field "$MOVED" workerBefore)" "America%2FNew_York%7Cen-US%2Cen"
check  "the WebRTC address"                "$(field "$MOVED" addressBefore)" "203.0.113.10"

echo "-- after it, the same page is in Berlin"
check  "the browser says it took the place" "$(cat "$WORK/moving/place.taken" 2>/dev/null)" "move-1"
check  "the page saw the move"             "$(field "$MOVED" waited)" "ok"
check  "time zone"                         "$(field "$MOVED" zone)" "Europe%2FBerlin"
check  "UTC offset in winter"              "$(field "$MOVED" offset)" "-60"
check  "navigator.language"                "$(field "$MOVED" language)" "de-DE"
check  "navigator.languages"               "$(field "$MOVED" languages)" "de-DE%2Cde%2Cen-US%2Cen"
check  "one languagechange event"          "$(field "$MOVED" events)" "1"
check  "the worker that was running"       "$(field "$MOVED" worker)" "Europe%2FBerlin%7C-60%7Cde-DE%2Cde%2Cen-US%2Cen"
check  "its languagechange event"          "$(field "$MOVED" workerEvents)" "1"
check  "a worker made afterwards"          "$(field "$MOVED" newWorker)" "Europe%2FBerlin%7C-60%7Cde-DE%2Cde%2Cen-US%2Cen"
check  "another site's frame (a new process)" "$(field "$MOVED" otherSite)" "Europe%2FBerlin%7Cde-DE%2Cde%2Cen-US%2Cen"
check  "Accept-Language"                   "$(field "$MOVED" header)" "de-DE%2Cde%3Bq%3D0.9%2Cen-US%3Bq%3D0.8%2Cen%3Bq%3D0.7"
check  "the WebRTC address"                "$(field "$MOVED" address)" "198.51.100.20"
if [ "$(field "$MOVED" positionBefore)" = "40.7128%2C-74.006" ]; then
  check "the position"                     "$(field "$MOVED" position)" "52.52%2C13.405"
else
  # See geo.test.sh: on some systems the prepared permission is not taken.
  echo "SKIP the position: this browser did not take the prepared permission ($(field "$MOVED" positionBefore))"
fi

echo "-- without a new place nothing moves"
check  "the page waited in vain"           "$(field "$STAYED" waited)" "timeout"
check  "time zone"                         "$(field "$STAYED" zone)" "America%2FNew_York"
check  "navigator.languages"               "$(field "$STAYED" languages)" "en-US%2Cen"
check  "no languagechange event"           "$(field "$STAYED" events)" "0"
check  "the WebRTC address"                "$(field "$STAYED" address)" "203.0.113.10"
check  "a place left by an earlier run is not acknowledged" "$(cat "$WORK/stale/place.taken" 2>/dev/null)" ""
check  "a place left by an earlier run is not taken" "$(field "$STALE" zone)" "America%2FNew_York"

echo "-- earlier patches still hold"
VT_FLAGS="--virtual-time-budget=6000"
LOCALE=$(run locale.html --proteus-config="$WORK/moving/kernel.json")
check  "a profile's languages at the start" "$(field "$LOCALE" languages)" "en-US%2Cen"
check  "a profile's time zone at the start" "$(field "$LOCALE" zone)" "America%2FNew_York"
