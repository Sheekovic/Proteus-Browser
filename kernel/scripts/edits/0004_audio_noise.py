"""Applies the in-place edits of patch 0004 (offline audio noise) to a Chromium checkout.
New files are copied from kernel/src by the caller.
usage: 0004_audio_noise.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
WEBAUDIO = "third_party/blink/renderer/modules/webaudio/"


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


# 1. Compile the noise helper into the webaudio module.
edit(
    WEBAUDIO + "BUILD.gn",
    '    "audio_buffer.cc",\n    "audio_buffer.h",\n',
    '    "audio_buffer.cc",\n    "audio_buffer.h",\n'
    '    "proteus_audio_noise.cc",\n    "proteus_audio_noise.h",\n',
)

# 2. Perturb a finished offline render before the promise resolves or the
#    "complete" event fires.
OAC = WEBAUDIO + "offline_audio_context.cc"
edit(
    OAC,
    "  CHECK(rendered_buffer);\n",
    "  CHECK(rendered_buffer);\n"
    "  ProteusApplyAudioNoise(rendered_buffer.Get());\n",
)
edit(
    OAC,
    '#include "third_party/blink/renderer/modules/webaudio/offline_audio_destination_node.h"\n',
    '#include "third_party/blink/renderer/modules/webaudio/offline_audio_destination_node.h"\n'
    '#include "third_party/blink/renderer/modules/webaudio/proteus_audio_noise.h"\n',
)
