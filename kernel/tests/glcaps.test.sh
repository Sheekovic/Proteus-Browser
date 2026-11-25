# Patch 0023: WebGL reports the capabilities of the profile's graphics card.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

# 3379 MAX_TEXTURE_SIZE, 3386 MAX_VIEWPORT_DIMS, 33901 ALIASED_POINT_SIZE_RANGE,
# 32883 MAX_3D_TEXTURE_SIZE, 34047 MAX_TEXTURE_MAX_ANISOTROPY_EXT,
# 34024 MAX_RENDERBUFFER_SIZE, 34921 MAX_VERTEX_ATTRIBS,
# 35661 MAX_COMBINED_TEXTURE_IMAGE_UNITS.
cat > "$WORK/caps.json" <<'EOF'
{
  "seed": "1",
  "webglCaps": {
    "1": {
      "p": {"3379": 4096, "3386": [4096, 2048], "33901": [1, 511.5], "32883": 512, "34047": 4,
            "34024": 2048, "34921": 8, "35661": 12},
      "e": ["EXT_texture_filter_anisotropic", "WEBGL_debug_renderer_info", "NOT_A_real_extension"],
      "s": [101,102,103, 104,105,106, 107,108,109, 110,111,112, 113,114,115, 116,117,118,
            201,202,203, 204,205,206, 207,208,209, 210,211,212, 213,214,215, 216,217,218]
    },
    "2": {"p": {"3379": 8192, "32883": 1024}}
  }
}
EOF
echo '{"seed": "1"}' > "$WORK/bare.json"

GPU_FLAGS="--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist"
PLAIN=$(run glcaps.html)
BARE=$(run glcaps.html --proteus-config="$WORK/bare.json")
CAPS=$(run glcaps.html --proteus-config="$WORK/caps.json")
GPU_FLAGS="--disable-gpu"
show "plain" "$PLAIN"
show "profile" "$CAPS"

if [ "$(field "$PLAIN" gl1)" != "ok" ] || [ "$(field "$PLAIN" gl2)" != "ok" ]; then
  echo "SKIP WebGL capabilities: no WebGL in this environment"
  return 0 2>/dev/null || true
fi

check  "a profile without capabilities changes nothing"   "$BARE" "$PLAIN"
differ "control: the real texture limit is another one"    "$(field "$PLAIN" gl1Max)" "number:4096"
check  "control: the real GPU offers 32-bit indices"       "$(field "$PLAIN" gl1_OES_element_index_uint)" "true/true"
check  "control: the real GPU offers anisotropic filtering" "$(field "$PLAIN" gl1_EXT_texture_filter_anisotropic)" "true/true"

check  "WebGL 1: texture limit"                    "$(field "$CAPS" gl1Max)" "number:4096"
check  "WebGL 1: viewport limit keeps its type"    "$(field "$CAPS" gl1Dims)" "Int32Array:4096/2048"
check  "WebGL 1: point size range keeps its type"  "$(field "$CAPS" gl1Point)" "Float32Array:1/511.5"
check  "WebGL 1: a WebGL 2 parameter is still an error" "$(field "$CAPS" gl1Tex3d)/$(field "$CAPS" gl1Error)" "null/1280"
check  "WebGL 1: anisotropy is null before its extension" "$(field "$CAPS" gl1AnisoBefore)" "null"
check  "WebGL 1: and the card's value after"       "$(field "$CAPS" gl1AnisoAfter)" "number:4"
check  "WebGL 1: only the card's extensions are listed" "$(field "$CAPS" gl1ExtCount)" "2"
check  "WebGL 1: a listed extension works"         "$(field "$CAPS" gl1_EXT_texture_filter_anisotropic)" "true/true"
check  "WebGL 1: an unlisted one is gone"          "$(field "$CAPS" gl1_OES_element_index_uint)" "false/false"
check  "WebGL 1: one the real GPU lacks is not invented" "$(field "$CAPS" gl1_NOT_A_real_extension)" "false/false"
check  "WebGL 1: vertex high float precision"      "$(field "$CAPS" gl1VertexHighFloat)" "107/108/109"
check  "WebGL 1: fragment low int precision"       "$(field "$CAPS" gl1FragmentLowInt)" "210/211/212"
check  "WebGL 1: getParameter is still native"     "$(field "$CAPS" gl1Native)" "true"
check  "WebGL 1: other parameters are untouched"   "$(field "$CAPS" gl1Version)" "$(field "$PLAIN" gl1Version)"

# Patch 0034: beyond a claimed limit a page is refused (1281 INVALID_VALUE, 1280
# INVALID_ENUM), at it it is not.
check  "control: the real card refuses beyond its own"     "$(field "$PLAIN" gl1TexEdge) $(field "$PLAIN" gl1BufferEdge) $(field "$PLAIN" gl1AttribEdge) $(field "$PLAIN" gl1UnitEdge)" "0/1281 0/1281 0/1281 0/1280"
check  "WebGL 1: a texture beyond the claimed limit is refused"      "$(field "$CAPS" gl1TexEdge)" "0/1281"
check  "WebGL 1: a renderbuffer beyond the claimed limit is refused" "$(field "$CAPS" gl1BufferEdge)" "0/1281"
check  "WebGL 1: a vertex attribute beyond the claimed count is refused" "$(field "$CAPS" gl1AttribEdge)" "0/1281"
check  "WebGL 1: a texture unit beyond the claimed count is refused" "$(field "$CAPS" gl1UnitEdge)" "0/1280"
check  "WebGL 1: a wide canvas is drawn as wide as the claimed card can" "$(field "$CAPS" gl1Wide)" "true"
check  "WebGL 2: a texture beyond its claimed limit is refused"      "$(field "$CAPS" gl2TexEdge)" "0/1281"

check  "WebGL 2 has its own limits"               "$(field "$CAPS" gl2Max)" "number:8192"
check  "WebGL 2: 3D texture limit"                 "$(field "$CAPS" gl2Tex3d)/$(field "$CAPS" gl2Error)" "number:1024/0"
check  "WebGL 2: extensions left alone when unset" "$(field "$CAPS" gl2ExtCount)" "$(field "$PLAIN" gl2ExtCount)"
check  "WebGL 2: precision left alone when unset"  "$(field "$CAPS" gl2VertexHighFloat)" "$(field "$PLAIN" gl2VertexHighFloat)"
