# Patch 0009: font substitution.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.
#
# The profile claims two macOS fonts the build server does not have, each with
# substitutes that the server does have. They must become detectable and render as
# their substitute, while the substitutes themselves stay hidden under their own
# names. A claimed font that IS installed (Lato) must keep its real appearance.

CANDIDATES='Helvetica Neue|Menlo|Menlo Bold|Lato|DejaVu Sans|DejaVu Sans Bold|Nimbus Sans|DejaVu Sans Mono|URW Gothic|Proteus Missing Font'
PAGE="fonts.html?candidates=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$CANDIDATES")"

cat > "$WORK/subs.json" <<'EOF'
{
  "seed": "1111111111111111111",
  "fonts": ["Helvetica Neue", "Menlo", "Lato", "DejaVu Sans"],
  "fontAliases": {
    "Helvetica Neue": ["Font Not Installed Anywhere", "Nimbus Sans"],
    "Menlo": ["DejaVu Sans Mono"],
    "Lato": ["URW Gothic"]
  }
}
EOF

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }
has() { case "|$1|" in *"|$2|"*) echo yes ;; *) echo no ;; esac; }
sizeof() { echo "$1" | tr '|' '\n' | grep "^$2:" | cut -d: -f2; }

PLAIN=$(run "$PAGE")
SUBS=$(run "$PAGE" --proteus-config="$WORK/subs.json")
PM=$(decode "$(field "$PLAIN" measured)"); PL=$(decode "$(field "$PLAIN" local)")
SM=$(decode "$(field "$SUBS" measured)");  SL=$(decode "$(field "$SUBS" local)")
PS=$(decode "$(field "$PLAIN" sizes)");    SS=$(decode "$(field "$SUBS" sizes)")
echo "plain   measured: $PM"
echo "plain   local():  $PL"
echo "profile measured: $SM"
echo "profile local():  $SL"

# Controls on the unmodified browser.
check  "control: Helvetica Neue is not installed"   "$(has "$PM" "Helvetica Neue")" no
check  "control: Menlo is not installed"            "$(has "$PM" "Menlo")" no
check  "control: Nimbus Sans is installed"          "$(has "$PM" "Nimbus Sans")" yes
check  "control: local(DejaVu Sans Bold) resolves"  "$(has "$PL" "DejaVu Sans Bold")" yes

# Claimed-but-missing fonts appear, through their substitutes.
check  "Helvetica Neue is detected by measurement"  "$(has "$SM" "Helvetica Neue")" yes
check  "Menlo is detected by measurement"           "$(has "$SM" "Menlo")" yes
check  "local(Helvetica Neue) resolves"             "$(has "$SL" "Helvetica Neue")" yes
check  "local(Menlo) resolves"                      "$(has "$SL" "Menlo")" yes
check  "local(Menlo Bold) resolves via the substitute's bold" "$(has "$SL" "Menlo Bold")" yes
check  "Helvetica Neue renders as its second substitute (first is missing)" \
       "$(sizeof "$SS" "Helvetica Neue")" "$(sizeof "$PS" "Nimbus Sans")"
check  "Menlo renders as its substitute"            "$(sizeof "$SS" "Menlo")" "$(sizeof "$PS" "DejaVu Sans Mono")"

# The substitutes do not leak under their own names.
check  "Nimbus Sans itself stays hidden"            "$(has "$SM" "Nimbus Sans")" no
check  "DejaVu Sans Mono itself stays hidden"       "$(has "$SM" "DejaVu Sans Mono")" no
check  "local(Nimbus Sans) stays hidden"            "$(has "$SL" "Nimbus Sans")" no

# An installed font is never replaced by its substitute.
check  "installed Lato keeps its own appearance"    "$(sizeof "$SS" "Lato")" "$(sizeof "$PS" "Lato")"
differ "Lato does not render as its substitute"     "$(sizeof "$SS" "Lato")" "$(sizeof "$PS" "URW Gothic")"

# Fix carried by this patch: a styled local() name of an allowed font resolves.
check  "local(DejaVu Sans Bold) resolves for an allowed family" "$(has "$SL" "DejaVu Sans Bold")" yes
check  "a font nobody claims stays undetected"      "$(has "$SM" "Proteus Missing Font")" no
check  "generic font rendering is unchanged"        "$(field "$SUBS" bases)" "$(field "$PLAIN" bases)"

echo "-- patch 0008 still holds"
echo '{"seed": "1", "fonts": ["Lato", "DejaVu Sans"]}' > "$WORK/list.json"
LIST=$(run "$PAGE" --proteus-config="$WORK/list.json")
check  "allow-list without substitutes still hides others" "$(decode "$(field "$LIST" measured)")" "Lato|DejaVu Sans"
