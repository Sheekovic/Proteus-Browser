# Patch 0028: a Safari profile shakes hands as Safari does.
# Sourced by server-test.sh, which provides check/differ, $WORK, $GPU_FLAGS and $STAGE.
#
# The expected values were recorded from Safari 27.2 on an iPhone 17 Pro Max opening
# https://<address>:<port>/ (an address, so no server name extension: the same as here).

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
  -keyout "$WORK/tls.key" -out "$WORK/tls.crt" -subj "/CN=127.0.0.1" \
  -addext "subjectAltName=IP:127.0.0.1" > /dev/null 2>&1

echo '{"seed": "1"}' > "$WORK/chrome.json"
echo '{"seed": "1", "transport": "safari"}' > "$WORK/safari.json"
echo '{"seed": "1", "transport": "netscape"}' > "$WORK/unknown.json"

TLS_PORT=8795
M=0
browse() {  # browse <url> [chrome flags...]  -> the page as the browser shows it
  M=$((M + 1))
  local url=$1; shift
  timeout 60 ./out/Linux/chrome --headless=new --no-sandbox $GPU_FLAGS \
    --user-data-dir="$WORK/tls-profile-$M" --ignore-certificate-errors --disable-quic "$@" \
    --dump-dom "$url" 2>/dev/null
}
record() {  # record [chrome flags...]  -> one line of JSON: the hello and the HTTP/2 opening
  python3 "$STAGE/tests/tlsrec.py" "$WORK/tls.crt" "$WORK/tls.key" $TLS_PORT > "$WORK/rec.json" &
  local recorder=$!
  sleep 1
  browse "https://127.0.0.1:$TLS_PORT/" "$@" > /dev/null
  wait $recorder
  cat "$WORK/rec.json"
}
get() {  # get <json> <python expression over r>
  echo "$1" | python3 -c "import json, sys; r = json.load(sys.stdin); print($2)" 2>/dev/null
}

PLAIN=$(record)
CHROME=$(record --proteus-config="$WORK/chrome.json")
SAFARI=$(record --proteus-config="$WORK/safari.json")
AGAIN=$(record --proteus-config="$WORK/safari.json")
UNKNOWN=$(record --proteus-config="$WORK/unknown.json")
echo "chrome: $CHROME"
echo "safari: $SAFARI"

# --- The hello -----------------------------------------------------------------------
check  "cipher suites: Safari's, in its order" "$(get "$SAFARI" "' '.join(r['hello']['ciphers'])")" \
       "GREASE 1302 1303 1301 c02c c02b cca9 c030 c02f cca8 c00a c009 c014 c013 009d 009c 0035 002f c008 c012 000a"
check  "extensions: Safari's, in its order, each with Safari's content" \
       "$(get "$SAFARI" "' | '.join(r['hello']['extensions'])")" \
       "GREASE 0: | 0017 | ff01 00 | 000a GREASE 11ec 001d 0017 0018 0019 | 000b 0100 | 0010 000c02683208687474702f312e31 | 0005 0100000000 | 000d 0403 0804 0401 0503 0805 0805 0501 0806 0601 0201 | 0012 | 0033 GREASE:1 11ec:1216 001d:32 | 002d 0101 | 002b GREASE 0304 0303 | 001b 020001 | GREASE 1:00"
check  "the same hello every time (Chrome's order changes)" \
       "$(get "$AGAIN" "' | '.join(r['hello']['extensions'])")" "$(get "$SAFARI" "' | '.join(r['hello']['extensions'])")"
check  "the connection is made, on TLS 1.3"       "$(get "$SAFARI" "r['protocol']")" "TLSv1.3"

# --- The opening of HTTP/2 -----------------------------------------------------------
check  "HTTP/2 settings"                          "$(get "$SAFARI" "' '.join(r['http2']['settings'])")" "2:0 3:100 4:2097152 9:1"
check  "HTTP/2 connection window"                 "$(get "$SAFARI" "r['http2']['windowUpdate']")" "10420225"
check  "a request without a priority, as one frame" "$(get "$SAFARI" "r['http2']['headersFlags']")" "05"
check  ":method, :scheme, :authority first"       "$(get "$SAFARI" "r['http2']['headersStart']")" "828741"

# --- The headers of a page load -------------------------------------------------------
# Looked for in the header block by the bytes HPACK writes them as (Huffman coded).
SAFARI_ACCEPT=b0497ca589d34d1f43aeba0c41a4c7a98f33a69a3fdf9a68fa1d75d0620d263d4c79a68fbed00177febe58f9fbed00177b
UPGRADE_INSECURE=92b6b9ac1c8558d520a4b6c2ad617b5a54251f   # the name upgrade-insecure-requests
FETCH_USER=8a4148b4a549275ad416cf                          # the name sec-fetch-user
check  "Accept of a page load is Safari's: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
       "$(get "$SAFARI" "'$SAFARI_ACCEPT' in r['http2']['headers']")" "True"
check  "no Upgrade-Insecure-Requests, which Safari does not send" "$(get "$SAFARI" "'$UPGRADE_INSECURE' in r['http2']['headers']")" "False"
check  "no Sec-Fetch-User, which Safari does not send" "$(get "$SAFARI" "'$FETCH_USER' in r['http2']['headers']")" "False"
check  "control: a Chrome profile sends both, and its own Accept" \
       "$(get "$CHROME" "('$UPGRADE_INSECURE' in r['http2']['headers'], '$FETCH_USER' in r['http2']['headers'], '$SAFARI_ACCEPT' in r['http2']['headers'])")" "(True, True, False)"

# --- Without the setting nothing changes ---------------------------------------------
PLAIN_CIPHERS=$(get "$PLAIN" "' '.join(r['hello']['ciphers'])")
check  "control: a Chrome profile lists Chrome's cipher suites" "$(get "$CHROME" "' '.join(r['hello']['ciphers'])")" "$PLAIN_CIPHERS"
differ "control: which are not Safari's"          "$PLAIN_CIPHERS" "$(get "$SAFARI" "' '.join(r['hello']['ciphers'])")"
check  "control: Chrome's own extensions are there (ALPS)" \
       "$(get "$CHROME" "any(e.startswith('44cd') for e in r['hello']['extensions'])")" "True"
check  "control: Chrome's HTTP/2 settings"        "$(get "$CHROME" "' '.join(r['http2']['settings'])")" "1:65536 2:0 4:6291456 6:262144"
check  "control: Chrome's HTTP/2 connection window" "$(get "$CHROME" "r['http2']['windowUpdate']")" "15663105"
check  "control: Chrome's header order (:method, :authority)" "$(get "$CHROME" "r['http2']['headersStart'][:4]")" "8241"
check  "an unknown transport is Chrome's"         "$(get "$UNKNOWN" "' '.join(r['hello']['ciphers'])")" "$PLAIN_CIPHERS"

# --- Pages still load: against servers that are not this test's own ------------------
# OpenSSL's test server answers with a page describing the connection it has.
serve_openssl() {  # serve_openssl <port> [s_server options...]
  local port=$1; shift
  openssl s_server -accept "$port" -cert "$WORK/tls.crt" -key "$WORK/tls.key" -www "$@" > /dev/null 2>&1 &
  OPENSSL_SERVER=$!
  sleep 1
}
serve_openssl 8796 -tls1_3
PAGE13=$(browse "https://127.0.0.1:8796/" --proteus-config="$WORK/safari.json")
kill $OPENSSL_SERVER 2>/dev/null
serve_openssl 8797 -tls1_2
PAGE12=$(browse "https://127.0.0.1:8797/" --proteus-config="$WORK/safari.json")
kill $OPENSSL_SERVER 2>/dev/null
# A server that will only do the oldest suite of the list this library has: AES with SHA-1.
serve_openssl 8798 -tls1_2 -cipher ECDHE-ECDSA-AES256-SHA
PAGEOLD=$(browse "https://127.0.0.1:8798/" --proteus-config="$WORK/safari.json")
kill $OPENSSL_SERVER 2>/dev/null
has() { case "$1" in *"$2"*) echo yes ;; *) echo no ;; esac; }
check  "a page loads over TLS 1.3"                "$(has "$PAGE13" "TLSv1.3")" yes
check  "a page loads over TLS 1.2"                "$(has "$PAGE12" "TLSv1.2")" yes
check  "a suite Safari offers and Chrome does not is really spoken" "$(has "$PAGEOLD" "ECDHE-ECDSA-AES256-SHA")" yes
