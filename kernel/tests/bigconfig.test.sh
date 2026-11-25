# Patch 0031: a configuration reaches the child processes deflated, so one that is
# several times larger than a command line could carry as it is still arrives whole.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.

python3 - "$WORK/big.json" <<'EOF'
import json, random, sys
random.seed(7)
# Names that do not repeat one another, as real lists of fonts and members do not:
# 1,200 voices, about 68,000 bytes of JSON.
word = lambda: ''.join(random.choice('abcdefghijklmnopqrstuvwxyz') for _ in range(random.randint(4, 9)))
voices = [{"name": "%s %s %s %d" % (word().title(), word().title(), word(), i), "lang": "en-US"} for i in range(1200)]
voices[0]["default"] = True
json.dump({"seed": "1", "hardwareConcurrency": 6, "voices": voices}, open(sys.argv[1], "w"))
print(len(json.dumps(voices)))
EOF

VT_FLAGS=""   # The voice list needs real time to arrive.
BIG=$(run voices.html --proteus-config="$WORK/big.json")
SIZE=$(wc -c < "$WORK/big.json")
echo "configuration: $SIZE bytes; voices reported: $(field "$BIG" voices)"
if [ "$SIZE" -gt 40000 ]; then echo "ok   the configuration is larger than a Windows command line"; else echo "FAIL the test's configuration is too small ($SIZE)"; FAIL=1; fi
check "every voice of a 68,000 byte configuration reaches the page" "$(field "$BIG" voices)" "1200"
LAST=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["voices"][3]["name"])' "$WORK/big.json")
case "$(python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$(field "$BIG" voiceNames)")" in
  *"$LAST"*) echo "ok   and its names are the ones written" ;;
  *) echo "FAIL the names differ ($(field "$BIG" voiceNames))"; FAIL=1 ;;
esac

# What an earlier version handed on, the JSON in base64 as it is, is still read.
PLAIN=$(printf '{"seed":"1","voices":[{"name":"Only One","lang":"en-GB","default":true}]}' | base64 -w0)
OLD=$(run voices.html --proteus-config-data="$PLAIN")
check "a configuration given in plain base64 is still read" "$(field "$OLD" voices)" "1"
