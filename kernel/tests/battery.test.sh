# Patch 0027: the battery and the kind of connection from the profile.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

NOW=$(date +%s)
echo '{"seed": "1"}' > "$WORK/bare.json"
echo '{"seed": "1", "battery": {"charging": true, "level": 1}}' > "$WORK/bat-desktop.json"
# A phone that had 80% two hours ago and loses 10% an hour.
echo "{\"seed\": \"1\", \"battery\": {\"charging\": false, \"level\": 0.8, \"drainPerHour\": 0.1, \"at\": $((NOW - 7200))}, \"connection\": {\"type\": \"wifi\"}}" > "$WORK/bat-phone.json"
# One that has been off its charger for days.
echo "{\"seed\": \"1\", \"battery\": {\"charging\": false, \"level\": 0.5, \"drainPerHour\": 0.1, \"at\": $((NOW - 400000))}, \"connection\": {\"type\": \"cellular\", \"downlinkMax\": 100}}" > "$WORK/bat-empty.json"
echo '{"seed": "1", "battery": {"charging": true, "level": 0.42}}' > "$WORK/bat-charging.json"
echo '{"seed": "1", "battery": {"level": 7}, "connection": {"type": "carrier pigeon"}}' > "$WORK/bat-bad.json"

VT_FLAGS=""   # The battery state arrives from the browser process in real time.

PLAIN=$(run battery.html)
BARE=$(run battery.html --proteus-config="$WORK/bare.json")
DESK=$(run battery.html --proteus-config="$WORK/bat-desktop.json")
PHONE=$(run battery.html --proteus-config="$WORK/bat-phone.json")
EMPTY=$(run battery.html --proteus-config="$WORK/bat-empty.json")
CHARGING=$(run battery.html --proteus-config="$WORK/bat-charging.json")
BAD=$(run battery.html --proteus-config="$WORK/bat-bad.json")
echo "plain:    $PLAIN"
echo "desktop:  $DESK"
echo "phone:    $PHONE"
echo "empty:    $EMPTY"
echo "charging: $CHARGING"

check  "control: this browser has a battery interface"        "$(field "$PLAIN" battery)" "present"
check  "control: a desktop browser does not name its connection" "$(field "$PLAIN" type)" "absent"
check  "a profile without these settings changes nothing: level" "$(field "$BARE" level)" "$(field "$PLAIN" level)"
check  "a profile without these settings changes nothing: type"  "$(field "$BARE" type)" "absent"
check  "a profile without these settings changes nothing: downlinkMax" "$(field "$BARE" downlinkMax)" "absent"

check  "a computer: on its charger"                           "$(field "$DESK" charging)" "true"
check  "a computer: full"                                     "$(field "$DESK" level)" "1"
check  "a computer: finished charging"                        "$(field "$DESK" chargingTime)" "0"
check  "a computer: no time until empty"                      "$(field "$DESK" dischargingTime)" "Infinity"
check  "a computer: still no connection type"                 "$(field "$DESK" type)" "absent"

check  "a phone: on its battery"                              "$(field "$PHONE" charging)" "false"
check  "a phone: what is left after two hours"                "$(field "$PHONE" level)" "0.6"
check  "a phone: not charging, so no time until full"         "$(field "$PHONE" chargingTime)" "Infinity"
check  "a phone: names its connection"                        "$(field "$PHONE" type)" "wifi"
check  "a phone: Wi-Fi has no upper speed"                    "$(field "$PHONE" downlinkMax)" "Infinity"
check  "a phone: has the typechange event"                    "$(field "$PHONE" typechange)" "true"
check  "the measured connection quality is still reported"    "$(field "$PHONE" effectiveType)" "$(field "$PLAIN" effectiveType)"

check  "a battery never runs below what a running phone has"  "$(field "$EMPTY" level)" "0.05"
check  "a mobile connection"                                  "$(field "$EMPTY" type)" "cellular"
check  "with its upper speed"                                 "$(field "$EMPTY" downlinkMax)" "100"

check  "a battery that is charging keeps its level"           "$(field "$CHARGING" level)" "0.42"
check  "and cannot say when it will be full"                  "$(field "$CHARGING" chargingTime)" "Infinity"

check  "impossible values are ignored: level"                 "$(field "$BAD" level)" "$(field "$PLAIN" level)"
check  "impossible values are ignored: type"                  "$(field "$BAD" type)" "absent"
