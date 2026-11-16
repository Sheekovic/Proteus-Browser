# Patch 0006: screen, languages and time zone.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.

cat > "$WORK/de.json" <<'EOF'
{
  "seed": "1111111111111111111",
  "screen": {"width": 1366, "height": 768, "availWidth": 1366, "availHeight": 728,
             "colorDepth": 24},
  "languages": ["de-DE", "de", "en"],
  "timezone": "America/New_York"
}
EOF
echo '{"seed": "1111111111111111111"}' > "$WORK/bare.json"

PLAIN=$(run locale.html)
BARE=$(run locale.html --proteus-config="$WORK/bare.json")
DE=$(run locale.html --proteus-config="$WORK/de.json")
show "plain" "$PLAIN"
show "profile" "$DE"

differ "page reports a screen"                   "$(field "$PLAIN" screen)" ""
check  "profile without these settings changes nothing" "$BARE" "$PLAIN"
differ "test profile differs from the real screen" "$(field "$PLAIN" screen)" "1366x768"

check  "screen.width x height"              "$(field "$DE" screen)" "1366x768"
check  "screen.avail* and origin"           "$(field "$DE" avail)" "1366x728@0,0"
check  "colorDepth / pixelDepth"            "$(field "$DE" depth)" "24/24"
check  "device-width media query agrees"    "$(field "$DE" mqDevice)" "true"
check  "device media query for 1366x768"    "$(field "$DE" mq1366)" "true"
check  "navigator.language"                 "$(field "$DE" language)" "de-DE"
check  "navigator.languages"                "$(field "$DE" languages)" "de-DE%2Cde%2Cen"
check  "worker navigator.languages"         "$(field "$DE" workerLanguages)" "de-DE%2Cde%2Cen"
check  "Accept-Language request header"     "$(field "$DE" hdrLanguage)" "de-DE%2Cde%3Bq%3D0.9%2Cen%3Bq%3D0.8"
check  "Intl time zone"                     "$(field "$DE" zone)" "America%2FNew_York"
check  "UTC offsets, winter/summer"         "$(field "$DE" offsets)" "300/240"
check  "worker Intl time zone"              "$(field "$DE" workerZone)" "America%2FNew_York"
check  "worker UTC offsets"                 "$(field "$DE" workerOffsets)" "300/240"

echo "-- earlier patches still hold"
ID=$(run identity.html --proteus-config="$WORK/de.json")
check  "identity untouched by this profile" "$(field "$ID" platform)" \
       "$(field "$(run identity.html)" platform)"
