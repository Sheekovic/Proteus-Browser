# Patch 0005: user agent, client hints and navigator.platform.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36'
cat > "$WORK/win.json" <<EOF
{
  "seed": "1111111111111111111",
  "userAgent": "$UA",
  "platform": "Win32",
  "uaData": {
    "brands": [
      {"brand": "Chromium", "version": "158"},
      {"brand": "Google Chrome", "version": "158"},
      {"brand": "Not_A Brand", "version": "24"}
    ],
    "fullVersionList": [
      {"brand": "Chromium", "version": "158.0.8127.37"},
      {"brand": "Google Chrome", "version": "158.0.8127.37"},
      {"brand": "Not_A Brand", "version": "24.0.0.0"}
    ],
    "fullVersion": "158.0.8127.37",
    "platform": "Windows",
    "platformVersion": "15.0.0",
    "architecture": "x86",
    "bitness": "64",
    "model": "",
    "mobile": false,
    "wow64": false
  }
}
EOF
echo '{"seed": "1111111111111111111"}' > "$WORK/bare.json"

# Same escaping as JavaScript's encodeURIComponent().
urlencode() {
  python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=\"~()*!.'-_\"))" "$1"
}

PLAIN=$(run identity.html)
BARE=$(run identity.html --proteus-config="$WORK/bare.json")
WIN=$(run identity.html --proteus-config="$WORK/win.json")
show "plain" "$PLAIN"
show "windows profile" "$WIN"

UA_ENC=$(urlencode "$UA")
BRANDS_ENC=$(urlencode 'Chromium/158,Google Chrome/158,Not_A Brand/24')
FULL_ENC=$(urlencode 'Chromium/158.0.8127.37,Google Chrome/158.0.8127.37,Not_A Brand/24.0.0.0')

differ "page reports an identity"                "$(field "$PLAIN" ua)" ""
check  "profile without identity changes nothing" "$BARE" "$PLAIN"

check  "navigator.userAgent"                "$(field "$WIN" ua)" "$UA_ENC"
check  "navigator.appVersion follows it"    "$(field "$WIN" appVersion)" "$(urlencode "${UA#Mozilla/}")"
check  "navigator.platform"                 "$(field "$WIN" platform)" "Win32"
check  "userAgentData.brands"               "$(field "$WIN" chBrands)" "$BRANDS_ENC"
check  "userAgentData.platform"             "$(field "$WIN" chPlatform)" "Windows"
check  "userAgentData.mobile"               "$(field "$WIN" chMobile)" "false"
check  "high entropy: architecture"         "$(field "$WIN" chArch)" "x86"
check  "high entropy: bitness"              "$(field "$WIN" chBitness)" "64"
check  "high entropy: platformVersion"      "$(field "$WIN" chPlatformVersion)" "15.0.0"
check  "high entropy: uaFullVersion"        "$(field "$WIN" chFullVersion)" "158.0.8127.37"
check  "high entropy: fullVersionList"      "$(field "$WIN" chFullList)" "$FULL_ENC"
check  "worker navigator.userAgent"         "$(field "$WIN" workerUa)" "$UA_ENC"
check  "worker navigator.platform"          "$(field "$WIN" workerPlatform)" "Win32"
check  "worker userAgentData.platform"      "$(field "$WIN" workerChPlatform)" "Windows"
check  "User-Agent request header"          "$(field "$WIN" hdrUa)" "$UA_ENC"
check  "Sec-CH-UA-Platform request header"  "$(field "$WIN" hdrChPlatform)" "$(urlencode '"Windows"')"
check  "Sec-CH-UA-Mobile request header"    "$(field "$WIN" hdrChMobile)" "$(urlencode '?0')"
case "$(field "$WIN" hdrCh)" in
  *Google%20Chrome*158*) echo "ok   Sec-CH-UA request header carries the profile's brands" ;;
  *) echo "FAIL Sec-CH-UA request header ($(field "$WIN" hdrCh))"; FAIL=1 ;;
esac
