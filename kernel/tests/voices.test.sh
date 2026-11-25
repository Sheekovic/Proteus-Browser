# Patch 0012: speech synthesis voices and WebGPU adapter info.
# Sourced by server-test.sh, which provides run/field/check/differ/show and $WORK.

cat > "$WORK/voices.json" <<'EOF'
{
  "seed": "1",
  "voices": [
    {"name": "Microsoft David - English (United States)", "lang": "en-US", "local": true, "default": true},
    {"name": "Microsoft Zira - English (United States)", "lang": "en-US", "local": true, "uri": "com.example.voice.Zira"},
    {"name": "Google Deutsch", "lang": "de-DE", "local": false}
  ],
  "webgpu": {"vendor": "intel", "architecture": "gen-12lp"}
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

VT_FLAGS=""   # The voice list and GPU adapter need real time to arrive.

decode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.argv[1]))' "$1"; }

PLAIN=$(run voices.html)
BARE=$(run voices.html --proteus-config="$WORK/bare.json")
PROF=$(run voices.html --proteus-config="$WORK/voices.json")
echo "plain   voices: $(field "$PLAIN" voices)  $(decode "$(field "$PLAIN" voiceNames)")"
echo "profile voices: $(field "$PROF" voices)  $(decode "$(field "$PROF" voiceNames)")"
echo "profile detail: $(decode "$(field "$PROF" voiceDetail)")"

check  "profile without these settings changes the voice count nothing" "$(field "$BARE" voices)" "$(field "$PLAIN" voices)"
differ "control: the machine's own voices are not the profile's"         "$(decode "$(field "$PLAIN" voiceNames)")" \
       "Microsoft David - English (United States)|Microsoft Zira - English (United States)|Google Deutsch*"

check  "the profile's three voices are reported"   "$(field "$PROF" voices)" "3"
check  "names, in order, with remote voices marked" "$(decode "$(field "$PROF" voiceNames)")" \
       "Microsoft David - English (United States)|Microsoft Zira - English (United States)|Google Deutsch*"
check  "language, local, default and URI of each voice; a URI of its own when the profile gives one" "$(decode "$(field "$PROF" voiceDetail)")" \
       "Microsoft David - English (United States)~en-US~true~true~Microsoft David - English (United States)|Microsoft Zira - English (United States)~en-US~true~false~com.example.voice.Zira|Google Deutsch~de-DE~false~false~Google Deutsch"
# Patch 0030: as in Chrome, the first question is answered with nothing and the voices
# come with one event a little later.
check  "the first question gets an empty list"         "$(field "$PROF" voicesAtOnce)"   "0"
check  "the voices are announced once"                 "$(field "$PROF" voiceEvents)"    "1"
check  "and some milliseconds after the question"      "$(field "$PROF" voiceEventLate)" "true"

# Addresses by shape, for a browser whose addresses are not the names (Safari's).
cat > "$WORK/shapes.json" <<'EOF'
{
  "seed": "1",
  "voiceUris": ["com.example.compact.%l.%n", "com.example.voice.%n"],
  "voices": [
    {"name": "Bad News", "lang": "en-US", "default": true},
    {"name": "Wobble", "lang": "en-US", "uri": "#1:Deranged"},
    {"name": "Albert", "lang": "en-GB", "uri": "#1"},
    {"name": "Odd", "lang": "fr-FR", "uri": "#7"}
  ]
}
EOF
SHAPED=$(run voices.html --proteus-config="$WORK/shapes.json")
check  "no address written: the first shape, with the language and the name without spaces; a shape by number, with another name in it; a number that is no shape leaves the name" \
       "$(decode "$(field "$SHAPED" voiceDetail)")" \
       "Bad News~en-US~true~true~com.example.compact.en-US.BadNews|Wobble~en-US~true~false~com.example.voice.Deranged|Albert~en-GB~true~false~com.example.voice.Albert|Odd~fr-FR~true~false~Odd"

# WebGPU needs a GPU adapter. The build server has no GPU, so try a software one;
# if the unmodified browser cannot get an adapter either, this part cannot be
# checked here and is reported as skipped rather than passed.
GPU_FLAGS="--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --use-angle=swiftshader --enable-unsafe-swiftshader --enable-features=Vulkan"
GPLAIN=$(run voices.html)
GPROF=$(run voices.html --proteus-config="$WORK/voices.json")
GPU_FLAGS="--disable-gpu"
echo "plain   webgpu: $(decode "$(field "$GPLAIN" webgpu)")"
echo "profile webgpu: $(decode "$(field "$GPROF" webgpu)")"
case "$(decode "$(field "$GPLAIN" webgpu)")" in
  *'|'*)
    differ "control: the real adapter is not the profile's" "$(decode "$(field "$GPLAIN" webgpu)")" "intel|gen-12lp||"
    case "$(decode "$(field "$GPROF" webgpu)")" in
      'intel|gen-12lp|'*) echo "ok   WebGPU vendor and architecture come from the profile" ;;
      *) echo "FAIL WebGPU adapter info ($(decode "$(field "$GPROF" webgpu)"))"; FAIL=1 ;;
    esac
    ;;
  *) echo "SKIP WebGPU adapter info: no adapter available on this machine ($(decode "$(field "$GPLAIN" webgpu)"))" ;;
esac
