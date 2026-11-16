# Patch 0018: a spoofed WebGL vendor/renderer costs what a real one does.
# Sourced by server-test.sh / win-test.sh, which provide run/field/check/differ and $WORK.

echo '{"seed": "1", "webglVendor": "Google Inc. (Intel)", "webglRenderer": "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)"}' > "$WORK/gl.json"

VT_FLAGS=""   # Virtual time would make the measurement meaningless.
GPU_FLAGS="--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist"
PLAIN=$(run gltiming.html)
PROF=$(run gltiming.html --proteus-config="$WORK/gl.json")
GPU_FLAGS="--disable-gpu"
echo "plain:   $PLAIN"
echo "profile: $PROF"

if [ "$(field "$PLAIN" webgl)" = "ok" ]; then
  check "control: a real renderer string costs like the reference call" "$(field "$PLAIN" rendererCostsLikeReal)" "true"
  check "the profile's renderer is reported" "$(field "$PROF" renderer)" \
        "ANGLE%20(Intel%2C%20Intel(R)%20UHD%20Graphics%20630%20(0x00003E9B)%20Direct3D11%20vs_5_0%20ps_5_0%2C%20D3D11)"
  check "the spoofed renderer costs like a real one" "$(field "$PROF" rendererCostsLikeReal)" "true"
  check "the spoofed vendor costs like a real one"   "$(field "$PROF" vendorCostsLikeReal)" "true"
else
  echo "SKIP WebGL timing: no WebGL in this environment"
fi
