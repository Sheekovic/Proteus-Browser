"""Applies the in-place edits of patch 0012 (speech voices and WebGPU adapter info) to a
Chromium checkout.
usage: 0012_voices_webgpu.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
MODULES = "third_party/blink/renderer/modules/"
SPEECH = MODULES + "speech/speech_synthesis.cc"
GPU = MODULES + "webgpu/gpu_adapter_info.cc"
PROTEUS_INCLUDES = (
    "#include <string>\n\n"
    '#include "base/containers/span.h"\n'
    '#include "base/proteus/proteus_config.h"\n'
)


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


# 1. speechSynthesis.getVoices(): a profile's voice list replaces the machine's.
edit(
    SPEECH,
    "void SpeechSynthesis::OnSetVoiceList(\n"
    "    Vector<mojom::blink::SpeechSynthesisVoicePtr> mojom_voices) {\n"
    "  voice_list_.clear();\n",
    "// Proteus: fills |list| with the profile's voices. Returns false, leaving\n"
    "// |list| alone, when the profile does not define any.\n"
    "static bool ProteusFillVoiceList(\n"
    "    HeapVector<Member<SpeechSynthesisVoice>>& list) {\n"
    "  const auto& voices = base::proteus::GetConfig().voices;\n"
    "  if (voices.empty()) {\n"
    "    return false;\n"
    "  }\n"
    "  for (const base::proteus::Voice& voice : voices) {\n"
    "    const String name = String::FromUtf8(base::as_byte_span(voice.name));\n"
    "    list.push_back(MakeGarbageCollected<SpeechSynthesisVoice>(\n"
    "        mojom::blink::SpeechSynthesisVoice::New(\n"
    "            /*voice_uri=*/name, name,\n"
    "            String::FromUtf8(base::as_byte_span(voice.lang)), voice.local,\n"
    "            voice.is_default)));\n"
    "  }\n"
    "  return true;\n"
    "}\n"
    "\n"
    "void SpeechSynthesis::OnSetVoiceList(\n"
    "    Vector<mojom::blink::SpeechSynthesisVoicePtr> mojom_voices) {\n"
    "  voice_list_.clear();\n"
    "  if (ProteusFillVoiceList(voice_list_)) {\n"
    "    VoicesDidChange();\n"
    "    return;\n"
    "  }\n",
)
# The machine may have no speech engine at all, in which case the list above is
# never delivered; make sure the profile's voices are there regardless.
edit(
    SPEECH,
    "  std::ignore = TryEnsureMojomSynthesis();\n"
    "  return voice_list_;\n",
    "  std::ignore = TryEnsureMojomSynthesis();\n"
    "  if (voice_list_.empty()) {\n"
    "    ProteusFillVoiceList(voice_list_);\n"
    "  }\n"
    "  return voice_list_;\n",
)
edit(SPEECH, "#include <tuple>\n", "#include <tuple>\n" + PROTEUS_INCLUDES)

# 2. GPUAdapterInfo.vendor / .architecture.
edit(
    GPU,
    "GPUAdapterInfo::GPUAdapterInfo(const String& vendor,\n",
    "// Proteus: |real| unless the profile overrides this field.\n"
    "static String ProteusAdapterField(const String& real,\n"
    "                                  const std::string& forced) {\n"
    "  return forced.empty() ? real\n"
    "                        : String::FromUtf8(base::as_byte_span(forced));\n"
    "}\n"
    "\n"
    "GPUAdapterInfo::GPUAdapterInfo(const String& vendor,\n",
)
edit(
    GPU,
    "    : vendor_(vendor),\n"
    "      architecture_(architecture),\n",
    "    : vendor_(ProteusAdapterField(\n"
    "          vendor, base::proteus::GetConfig().webgpu_vendor)),\n"
    "      architecture_(ProteusAdapterField(\n"
    "          architecture, base::proteus::GetConfig().webgpu_architecture)),\n",
)
edit(
    GPU,
    '#include "third_party/blink/renderer/modules/webgpu/gpu_adapter_info.h"\n',
    '#include "third_party/blink/renderer/modules/webgpu/gpu_adapter_info.h"\n\n'
    + PROTEUS_INCLUDES,
)
