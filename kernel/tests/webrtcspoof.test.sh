# Patch 0011: presentational WebRTC candidates.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# A protected profile that names a public address must show the page the candidates
# an ordinary browser behind that address would, while a STUN server on this machine
# still receives no packet at all.

VT_FLAGS=""   # ICE gathering needs real time.

STUN_IP=$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
[ -z "$STUN_IP" ] && STUN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
# Elsewhere (Windows): the address of the default route, found without sending anything.
[ -z "$STUN_IP" ] && STUN_IP=$(python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('192.0.2.1', 9)); print(s.getsockname()[0])")
STUN_PORT=3479
COUNT_FILE="$WORK/stun-count"
python3 "$STAGE/tests/stun.py" "$STUN_IP" $STUN_PORT "$COUNT_FILE" &
STUN_PID=$!
sleep 1
packets() { cat "$COUNT_FILE"; }

FAKE=203.0.113.77
echo "{\"seed\": \"1111111111111111111\", \"webRtcPolicy\": \"proxyOnly\", \"webRtcPublicIp\": \"$FAKE\"}" > "$WORK/spoof.json"
echo '{"seed": "1111111111111111111", "webRtcPolicy": "proxyOnly"}' > "$WORK/block.json"
echo "{\"seed\": \"1111111111111111111\", \"webRtcPublicIp\": \"$FAKE\"}" > "$WORK/unprotected.json"
WITH_STUN="webrtc.html?stun=$STUN_IP:$STUN_PORT&expect=$FAKE"

P0=$(packets)
PLAIN=$(run "$WITH_STUN")
P1=$(packets)
SPOOF=$(run "$WITH_STUN" --proteus-config="$WORK/spoof.json")
P2=$(packets)
NOSTUN=$(run "webrtc.html" --proteus-config="$WORK/spoof.json")
BLOCK=$(run "$WITH_STUN" --proteus-config="$WORK/block.json")
P3=$(packets)
UNPROT=$(run "$WITH_STUN" --proteus-config="$WORK/unprotected.json")
kill $STUN_PID 2>/dev/null

show "unprotected browser (STUN packets: $((P1 - P0)))" "$PLAIN"
show "protected with a public address (STUN packets: $((P2 - P1)))" "$SPOOF"
show "same profile, page configured no STUN server" "$NOSTUN"

differ "control: unprotected browser reaches STUN"     "$((P1 - P0))" "0"
check  "control: its public candidate is not the made-up address" "$(field "$PLAIN" srflxIsExpected)" "false"

check  "no UDP packet reaches the STUN server"         "$((P2 - P1))" "0"
check  "two candidates are announced"                  "$(field "$SPOOF" candidates)" "2"
check  "one host and one server-reflexive candidate"   "$(field "$SPOOF" types)" "host:1,srflx:1"
check  "the host candidate is an mDNS name"            "$(field "$SPOOF" mdns)" "1"
check  "only the public candidate carries an address"  "$(field "$SPOOF" ipLiterals)" "1"
check  "that address is the profile's public address"  "$(field "$SPOOF" srflxIsExpected)" "true"
check  "the SDP carries the public candidate too"      "$(field "$SPOOF" sdpIpLiterals)" "1"
check  "gathering reaches complete"                    "$(field "$SPOOF" gathering)" "complete"

check  "without a STUN server only the host candidate appears" "$(field "$NOSTUN" types)" "host:1"
check  "and no address at all"                         "$(field "$NOSTUN" ipLiterals)" "0"

check  "protected without a public address shows only the host candidate" "$(field "$BLOCK" types)" "host:1"
check  "which carries no address"                      "$(field "$BLOCK" ipLiterals)" "0"
check  "and gathering still completes"                 "$(field "$BLOCK" gathering)" "complete"
check  "and sends nothing"                             "$((P3 - P2))" "0"
check  "a public address alone, without protection, changes nothing" \
       "$(field "$UNPROT" srflxIsExpected)" "false"
