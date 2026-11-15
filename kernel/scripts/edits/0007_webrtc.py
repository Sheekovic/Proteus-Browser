"""Applies the in-place edits of patch 0007 (WebRTC address leak protection) to a
Chromium checkout.
usage: 0007_webrtc.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
PREFS = "chrome/browser/renderer_preferences_util.cc"


def edit(rel, old, new):
    path = SRC / rel
    text = path.read_text(encoding="utf-8")
    if new in text:
        print("already applied:", rel)
        return
    if text.count(old) != 1:
        sys.exit("anchor not found exactly once in %s: %r" % (rel, old))
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
    print("edited:", rel)


# The browser process tells every renderer which WebRTC IP handling policy to use.
# A profile asking for "proxyOnly" gets Chromium's strictest built-in policy, which
# forbids UDP that does not travel through the proxy.
edit(
    PREFS,
    "  prefs->webrtc_ip_handling_policy = blink::ToWebRTCIPHandlingPolicy(\n"
    "      pref_service->GetString(prefs::kWebRTCIPHandlingPolicy));\n",
    "  prefs->webrtc_ip_handling_policy = blink::ToWebRTCIPHandlingPolicy(\n"
    "      pref_service->GetString(prefs::kWebRTCIPHandlingPolicy));\n"
    "  if (base::proteus::GetConfig().webrtc_proxy_only) {\n"
    "    prefs->webrtc_ip_handling_policy = blink::ToWebRTCIPHandlingPolicy(\n"
    "        blink::kWebRTCIPHandlingDisableNonProxiedUdp);\n"
    "  }\n",
)
edit(
    PREFS,
    '#include "base/logging.h"\n',
    '#include "base/logging.h"\n#include "base/proteus/proteus_config.h"\n',
)
