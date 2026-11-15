# Patch 0007: WebRTC address leak protection.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# A STUN server on a local, non-loopback address counts every UDP packet it receives.
# An unprotected browser must reach it (proving the test can detect a leak); a
# protected one must not send a single packet or expose an IP address to the page.

VT_FLAGS=""   # ICE gathering needs real time.

STUN_IP=$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
[ -z "$STUN_IP" ] && STUN_IP=$(hostname -I | awk '{print $1}')
STUN_PORT=3479
COUNT_FILE="$WORK/stun-count"
python3 "$STAGE/tests/stun.py" "$STUN_IP" $STUN_PORT "$COUNT_FILE" &
STUN_PID=$!
sleep 1
packets() { cat "$COUNT_FILE"; }

echo '{"seed": "1111111111111111111", "webRtcPolicy": "proxyOnly"}' > "$WORK/protect.json"
echo '{"seed": "1111111111111111111"}' > "$WORK/bare.json"
PAGE="webrtc.html?stun=$STUN_IP:$STUN_PORT"

P0=$(packets)
PLAIN=$(run "$PAGE")
P1=$(packets)
BARE=$(run "$PAGE" --proteus-config="$WORK/bare.json")
P2=$(packets)
PROT=$(run "$PAGE" --proteus-config="$WORK/protect.json")
P3=$(packets)
kill $STUN_PID 2>/dev/null

show "unprotected (STUN packets: $((P1 - P0)))" "$PLAIN"
show "profile without WebRTC setting (STUN packets: $((P2 - P1)))" "$BARE"
show "protected (STUN packets: $((P3 - P2)))" "$PROT"

check  "WebRTC API is present"                        "$(field "$PLAIN" api)" "function"
differ "control: unprotected browser reaches STUN"     "$((P1 - P0))" "0"
differ "control: unprotected page sees an IP address"  "$(field "$PLAIN" ipLiterals)" "0"
differ "profile without the setting behaves as stock"  "$((P2 - P1))" "0"

check  "protected: no UDP packet reaches the STUN server" "$((P3 - P2))" "0"
check  "protected: no IP address in ICE candidates"       "$(field "$PROT" ipLiterals)" "0"
check  "protected: no IP address in the SDP"              "$(field "$PROT" sdpIpLiterals)" "0"
check  "protected: WebRTC API still present"              "$(field "$PROT" api)" "function"
