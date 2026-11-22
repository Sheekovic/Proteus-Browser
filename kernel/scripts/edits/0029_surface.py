"""Applies the in-place edits of patch 0029 to a Chromium checkout: what a profile's
browser has, beyond navigator. Members of the global object can be hidden (interfaces
such as EyeDropper and the window's own functions such as showOpenFilePicker, which
Safari and Chrome on a phone do not have), a profile's screen is one screen, and the
work area of a profile's screen can start below a menu bar.
usage: 0029_surface.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"


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


# 1. Members of the global object. Patch 0022 removes listed members from an
#    interface's prototype; the entry named "globalThis" is the global object itself.
#    A name ending in * stands for every own member that starts with what is before it
#    (the two dozen XR... interfaces of a browser without WebXR).
LOOP = "  for (const auto& entry : hidden) {\n    v8::Local<v8::String> name;\n"
GLOBALS = (
    "  for (const auto& entry : hidden) {\n"
    '    if (entry.interface_name == "globalThis") {\n'
    "      v8::Local<v8::Object> global = context->Global();\n"
    "      for (const std::string& member : entry.members) {\n"
    "        if (member.back() != '*') {\n"
    "          v8::Local<v8::String> key;\n"
    "          if (v8::String::NewFromUtf8(isolate, member.c_str()).ToLocal(&key)) {\n"
    "            std::ignore = global->Delete(context, key);\n"
    "          }\n"
    "          continue;\n"
    "        }\n"
    "        const std::string prefix = member.substr(0, member.size() - 1);\n"
    "        v8::Local<v8::Array> names;\n"
    "        if (prefix.empty() ||\n"
    "            !global\n"
    "                 ->GetPropertyNames(context, v8::KeyCollectionMode::kOwnOnly,\n"
    "                                    v8::SKIP_SYMBOLS,\n"
    "                                    v8::IndexFilter::kSkipIndices)\n"
    "                 .ToLocal(&names)) {\n"
    "          continue;\n"
    "        }\n"
    "        for (uint32_t i = 0; i < names->Length(); ++i) {\n"
    "          v8::Local<v8::Value> key;\n"
    "          if (!names->Get(context, i).ToLocal(&key) || !key->IsString()) {\n"
    "            continue;\n"
    "          }\n"
    "          v8::String::Utf8Value text(isolate, key);\n"
    "          if (*text && std::string_view(*text, text.length())\n"
    "                           .starts_with(prefix)) {\n"
    "            std::ignore = global->Delete(context, key);\n"
    "          }\n"
    "        }\n"
    "      }\n"
    "      continue;\n"
    "    }\n"
    "    v8::Local<v8::String> name;\n"
)
for rel in ("bindings/core/v8/local_window_proxy.cc",
            "bindings/core/v8/worker_or_worklet_script_controller.cc"):
    edit(BLINK + rel, LOOP, GLOBALS)
    edit(BLINK + rel, "#include <tuple>\n", "#include <string>\n#include <string_view>\n#include <tuple>\n")

# 2. The screen. A profile's screen is the one it describes: it does not become one of
#    several because the machine it runs on has a second monitor. And its work area
#    starts where the profile says (below a Mac's menu bar), not always at the top.
SCREEN = BLINK + "core/frame/screen.cc"
edit(
    SCREEN,
    "  auto* context = GetExecutionContext();\n"
    "  if (!context->IsFeatureEnabled(\n"
    "          network::mojom::PermissionsPolicyFeature::kWindowManagement)) {\n"
    "    return false;\n"
    "  }\n",
    "  auto* context = GetExecutionContext();\n"
    "  if (!context->IsFeatureEnabled(\n"
    "          network::mojom::PermissionsPolicyFeature::kWindowManagement)) {\n"
    "    return false;\n"
    "  }\n"
    "  if (base::proteus::GetConfig().screen) {\n"
    "    return false;\n"
    "  }\n",
)
edit(
    SCREEN,
    "  if (base::proteus::GetConfig().screen) {\n"
    "    return 0;\n"
    "  }\n"
    "  return GetRect(/*available=*/true).y();\n",
    "  if (const auto& forced = base::proteus::GetConfig().screen) {\n"
    "    return forced->avail_top;\n"
    "  }\n"
    "  return GetRect(/*available=*/true).y();\n",
)
