"""Applies the in-place edits of patch 0030 to a Chromium checkout: two things about a
profile's speech voices that a real browser was read to do otherwise.

 - A voice's voiceURI comes from the profile when it gives one. Chrome's is the
   voice's name; Safari's is an address ("com.apple.voice.compact.en-US.Samantha").
 - The first getVoices() of a page answers with an empty list, and the voices arrive
   with a voiceschanged event some milliseconds later, as they do in Chrome (on a
   Galaxy: nothing at once, the event after 11 to 14 ms). Patch 0012 answered at once,
   and announced the list again when the machine's own arrived.
usage: 0030_voice_details.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
SPEECH = "third_party/blink/renderer/modules/speech/speech_synthesis"


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


# 1. voiceURI from the profile.
edit(
    SPEECH + ".cc",
    "    const String name = String::FromUtf8(base::as_byte_span(voice.name));\n"
    "    list.push_back(MakeGarbageCollected<SpeechSynthesisVoice>(\n"
    "        mojom::blink::SpeechSynthesisVoice::New(\n"
    "            /*voice_uri=*/name, name,\n",
    "    const String name = String::FromUtf8(base::as_byte_span(voice.name));\n"
    "    const String uri = voice.uri.empty()\n"
    "                           ? name\n"
    "                           : String::FromUtf8(base::as_byte_span(voice.uri));\n"
    "    list.push_back(MakeGarbageCollected<SpeechSynthesisVoice>(\n"
    "        mojom::blink::SpeechSynthesisVoice::New(\n"
    "            uri, name,\n",
)

# 2. The profile's voices arrive once, a little after a page first asks, whether or
#    not the machine has a speech engine to answer.
edit(
    SPEECH + ".cc",
    "  voice_list_.clear();\n"
    "  if (ProteusFillVoiceList(voice_list_)) {\n"
    "    VoicesDidChange();\n"
    "    return;\n"
    "  }\n",
    "  if (!base::proteus::GetConfig().voices.empty()) {\n"
    "    // The machine's list is not the profile's, and its arrival is not the\n"
    "    // moment the profile's voices arrive: ProteusDeliverVoices() is.\n"
    "    return;\n"
    "  }\n"
    "  voice_list_.clear();\n",
)
edit(
    SPEECH + ".cc",
    "  std::ignore = TryEnsureMojomSynthesis();\n"
    "  if (voice_list_.empty()) {\n"
    "    ProteusFillVoiceList(voice_list_);\n"
    "  }\n"
    "  return voice_list_;\n"
    "}\n",
    "  std::ignore = TryEnsureMojomSynthesis();\n"
    "  if (!proteus_voices_asked_for_ &&\n"
    "      !base::proteus::GetConfig().voices.empty() && GetSupplementable()) {\n"
    "    proteus_voices_asked_for_ = true;\n"
    "    GetSupplementable()\n"
    "        ->GetTaskRunner(TaskType::kMiscPlatformAPI)\n"
    "        ->PostDelayedTask(FROM_HERE,\n"
    "                          BindOnce(&SpeechSynthesis::ProteusDeliverVoices,\n"
    "                                   WrapWeakPersistent(this)),\n"
    "                          base::Milliseconds(12));\n"
    "  }\n"
    "  return voice_list_;\n"
    "}\n"
    "\n"
    "// Proteus: the profile's voices arrive, as a browser's do: after the page asked,\n"
    "// with one voiceschanged event.\n"
    "void SpeechSynthesis::ProteusDeliverVoices() {\n"
    "  if (!voice_list_.empty() || !GetSupplementable()) {\n"
    "    return;\n"
    "  }\n"
    "  if (ProteusFillVoiceList(voice_list_)) {\n"
    "    VoicesDidChange();\n"
    "  }\n"
    "}\n",
)
edit(
    SPEECH + ".cc",
    '#include "base/proteus/proteus_config.h"\n',
    '#include "base/location.h"\n'
    '#include "base/proteus/proteus_config.h"\n'
    '#include "base/time/time.h"\n'
    '#include "third_party/blink/public/platform/task_type.h"\n'
    '#include "third_party/blink/renderer/platform/heap/persistent.h"\n'
    '#include "third_party/blink/renderer/platform/wtf/functional.h"\n',
)
edit(
    SPEECH + ".h",
    " private:\n"
    "  void VoicesDidChange();\n",
    " private:\n"
    "  void VoicesDidChange();\n"
    "  // Proteus: see speech_synthesis.cc.\n"
    "  void ProteusDeliverVoices();\n"
    "  bool proteus_voices_asked_for_ = false;\n",
)
