"""Applies the in-place edits of patch 0026 to a Chromium checkout: the list of
microphones, cameras and speakers, and the labels of opened tracks, come from the
profile.
usage: 0026_media_devices.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
DIR = "third_party/blink/renderer/modules/mediastream/"
DEVICES_CC = DIR + "media_devices.cc"
PROCESSOR_CC = DIR + "user_media_processor.cc"
BUILD = DIR + "BUILD.gn"
INCLUDE = '#include "third_party/blink/renderer/modules/mediastream/proteus_media_devices.h"\n'


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


# 1. The new files.
edit(
    BUILD,
    '    "media_devices.cc",\n    "media_devices.h",\n',
    '    "media_devices.cc",\n    "media_devices.h",\n'
    '    "proteus_media_devices.cc",\n    "proteus_media_devices.h",\n',
)

# 2. enumerateDevices(): the profile's devices in place of this machine's.
NEXT = '#include "third_party/blink/renderer/modules/mediastream/restriction_target.h"\n'
edit(DEVICES_CC, NEXT, INCLUDE + NEXT)
edit(
    DEVICES_CC,
    "  MediaDeviceInfoVector media_devices;\n"
    "  bool result_contains_nonempty_input_device_ids = false;\n",
    "  // Proteus: the devices of the profile's machine.\n"
    "  Vector<Vector<WebMediaDeviceInfo>> proteus_listed;\n"
    "  const Vector<Vector<WebMediaDeviceInfo>>& listed =\n"
    "      ProteusRewriteMediaDevices(enumeration, proteus_listed,\n"
    "                                 video_input_capabilities,\n"
    "                                 audio_input_capabilities)\n"
    "          ? proteus_listed\n"
    "          : enumeration;\n"
    "\n"
    "  MediaDeviceInfoVector media_devices;\n"
    "  bool result_contains_nonempty_input_device_ids = false;\n",
)
edit(
    DEVICES_CC,
    "    for (wtf_size_t j = 0; j < enumeration[i].size(); ++j) {\n"
    "      mojom::blink::MediaDeviceType device_type =\n"
    "          static_cast<mojom::blink::MediaDeviceType>(i);\n"
    "      WebMediaDeviceInfo device_info = enumeration[i][j];\n",
    "    for (wtf_size_t j = 0; j < listed[i].size(); ++j) {\n"
    "      mojom::blink::MediaDeviceType device_type =\n"
    "          static_cast<mojom::blink::MediaDeviceType>(i);\n"
    "      WebMediaDeviceInfo device_info = listed[i][j];\n",
)

# 3. MediaStreamTrack.label of an opened microphone or camera.
NEXT = '#include "third_party/blink/renderer/modules/mediastream/user_media_client.h"\n'
edit(PROCESSOR_CC, NEXT, INCLUDE + NEXT)
edit(
    PROCESSOR_CC,
    "  auto* source = MakeGarbageCollected<MediaStreamSource>(\n"
    "      String::FromUtf8(device.id), device.display_id, type,\n"
    "      String::FromUtf8(device.name), false /* remote */,\n"
    "      std::move(platform_source));\n",
    "  // Proteus: a microphone or camera carries the profile's name for it. Screen\n"
    "  // and tab captures keep theirs.\n"
    "  const bool proteus_device =\n"
    "      device.type == mojom::blink::MediaStreamType::DEVICE_AUDIO_CAPTURE ||\n"
    "      device.type == mojom::blink::MediaStreamType::DEVICE_VIDEO_CAPTURE;\n"
    "  auto* source = MakeGarbageCollected<MediaStreamSource>(\n"
    "      String::FromUtf8(device.id), device.display_id, type,\n"
    "      proteus_device\n"
    "          ? ProteusMediaTrackLabel(type == MediaStreamSource::kTypeAudio,\n"
    "                                   device.id, device.name)\n"
    "          : String::FromUtf8(device.name),\n"
    "      false /* remote */, std::move(platform_source));\n",
)

# 4. ...and that device's id, where the profile's list has no "default" entry.
edit(
    PROCESSOR_CC,
    "  auto* source = MakeGarbageCollected<MediaStreamSource>(\n"
    "      String::FromUtf8(device.id), device.display_id, type,\n"
    "      proteus_device\n",
    "  auto* source = MakeGarbageCollected<MediaStreamSource>(\n"
    "      proteus_device\n"
    "          ? ProteusMediaTrackDeviceId(type == MediaStreamSource::kTypeAudio,\n"
    "                                      device.id)\n"
    "          : String::FromUtf8(device.id),\n"
    "      device.display_id, type,\n"
    "      proteus_device\n",
)
