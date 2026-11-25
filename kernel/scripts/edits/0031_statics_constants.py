"""Applies the in-place edits of patch 0031 to a Chromium checkout (the patch also lets
a configuration of any size reach the child processes, in base/proteus): three kinds of
member that patches 0022 and 0029 could not remove from a profile whose browser lacks
them.

 - Static members, which are on the interface object and not on its prototype
   (Iterator.zip, Document.parseHTML): an entry named "Iterator." lists them.
 - Members of the global object that the browser has in a page and not in a worker,
   or the other way round: entries named "window" and "worker" beside "globalThis".
 - Constants (WebGLRenderingContext.RGB8). A constant cannot be deleted, so the ones
   a profile hides are installed deletable, removed where they are hidden, and made
   fixed again on the interfaces that keep them ("keepConstants").
usage: 0031_statics_constants.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
WINDOW = BLINK + "bindings/core/v8/local_window_proxy.cc"
WORKER = BLINK + "bindings/core/v8/worker_or_worklet_script_controller.cc"
INSTALLER = BLINK + "platform/bindings/idl_member_installer.cc"


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


# 1. The interface object as well as its prototype, and the constants that stay.
OLD_TAIL = (
    "    v8::Local<v8::String> name;\n"
    "    v8::Local<v8::Value> constructor;\n"
    "    v8::Local<v8::Value> prototype;\n"
    "    if (!v8::String::NewFromUtf8(isolate, entry.interface_name.c_str())\n"
    "             .ToLocal(&name) ||\n"
    "        !context->Global()->Get(context, name).ToLocal(&constructor) ||\n"
    "        !constructor->IsObject() ||\n"
    "        !constructor.As<v8::Object>()\n"
    "             ->Get(context, prototype_key)\n"
    "             .ToLocal(&prototype) ||\n"
    "        !prototype->IsObject()) {\n"
    "      continue;\n"
    "    }\n"
    "    for (const std::string& member : entry.members) {\n"
    "      v8::Local<v8::String> key;\n"
    "      if (v8::String::NewFromUtf8(isolate, member.c_str()).ToLocal(&key)) {\n"
    "        std::ignore = prototype.As<v8::Object>()->Delete(context, key);\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "}\n"
)
NEW_TAIL = (
    "    // \"Name.\" is the interface object itself, where static members are.\n"
    "    const bool on_interface = entry.interface_name.back() == '.';\n"
    "    const std::string interface_name =\n"
    "        on_interface ? entry.interface_name.substr(\n"
    "                           0, entry.interface_name.size() - 1)\n"
    "                     : entry.interface_name;\n"
    "    v8::Local<v8::String> name;\n"
    "    v8::Local<v8::Value> constructor;\n"
    "    v8::Local<v8::Value> prototype;\n"
    "    if (!v8::String::NewFromUtf8(isolate, interface_name.c_str())\n"
    "             .ToLocal(&name) ||\n"
    "        !context->Global()->Get(context, name).ToLocal(&constructor) ||\n"
    "        !constructor->IsObject() ||\n"
    "        !constructor.As<v8::Object>()\n"
    "             ->Get(context, prototype_key)\n"
    "             .ToLocal(&prototype) ||\n"
    "        !prototype->IsObject()) {\n"
    "      continue;\n"
    "    }\n"
    "    v8::Local<v8::Object> holder = on_interface\n"
    "                                       ? constructor.As<v8::Object>()\n"
    "                                       : prototype.As<v8::Object>();\n"
    "    for (const std::string& member : entry.members) {\n"
    "      v8::Local<v8::String> key;\n"
    "      if (v8::String::NewFromUtf8(isolate, member.c_str()).ToLocal(&key)) {\n"
    "        std::ignore = holder->Delete(context, key);\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "  // A constant a profile hides is installed deletable on every interface\n"
    "  // (idl_member_installer.cc). On the ones that keep it, it is made what a\n"
    "  // constant is again: fixed.\n"
    "  const v8::PropertyAttribute fixed =\n"
    "      static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete);\n"
    "  for (const auto& entry : base::proteus::GetConfig().kept_constants) {\n"
    "    v8::Local<v8::String> name;\n"
    "    v8::Local<v8::Value> constructor;\n"
    "    v8::Local<v8::Value> prototype;\n"
    "    if (!v8::String::NewFromUtf8(isolate, entry.interface_name.c_str())\n"
    "             .ToLocal(&name) ||\n"
    "        !context->Global()->Get(context, name).ToLocal(&constructor) ||\n"
    "        !constructor->IsObject() ||\n"
    "        !constructor.As<v8::Object>()\n"
    "             ->Get(context, prototype_key)\n"
    "             .ToLocal(&prototype)) {\n"
    "      continue;\n"
    "    }\n"
    "    for (const std::string& member : entry.members) {\n"
    "      v8::Local<v8::String> key;\n"
    "      v8::Local<v8::Value> value;\n"
    "      if (!v8::String::NewFromUtf8(isolate, member.c_str()).ToLocal(&key) ||\n"
    "          !constructor.As<v8::Object>()\n"
    "               ->GetRealNamedProperty(context, key)\n"
    "               .ToLocal(&value) ||\n"
    "          !value->IsNumber()) {\n"
    "        continue;\n"
    "      }\n"
    "      std::ignore = constructor.As<v8::Object>()->DefineOwnProperty(\n"
    "          context, key, value, fixed);\n"
    "      if (prototype->IsObject() &&\n"
    "          prototype.As<v8::Object>()\n"
    "              ->HasOwnProperty(context, key)\n"
    "              .FromMaybe(false)) {\n"
    "        std::ignore = prototype.As<v8::Object>()->DefineOwnProperty(\n"
    "            context, key, value, fixed);\n"
    "      }\n"
    "    }\n"
    "  }\n"
    "}\n"
)
for rel in (WINDOW, WORKER):
    edit(rel, OLD_TAIL, NEW_TAIL)

# 2. The global object of a page alone, or of a worker alone.
GLOBAL = '    if (entry.interface_name == "globalThis") {\n'
edit(
    WINDOW,
    GLOBAL,
    '    if (entry.interface_name == "worker") {\n'
    "      continue;\n"
    "    }\n"
    '    if (entry.interface_name == "globalThis" ||\n'
    '        entry.interface_name == "window") {\n',
)
edit(
    WORKER,
    GLOBAL,
    '    if (entry.interface_name == "window") {\n'
    "      continue;\n"
    "    }\n"
    '    if (entry.interface_name == "globalThis" ||\n'
    '        entry.interface_name == "worker") {\n',
)

# 3. Constants a profile hides are installed deletable.
edit(
    INSTALLER,
    "      static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete);\n"
    "  for (const auto& config : configs) {\n"
    "    v8::Local<v8::String> name = V8AtomicString(isolate, config.name);\n",
    "      static_cast<v8::PropertyAttribute>(v8::ReadOnly | v8::DontDelete);\n"
    "  // Proteus: see proteus_config.h, |loose_constants|.\n"
    "  const std::vector<std::string>& proteus_loose =\n"
    "      base::proteus::GetConfig().loose_constants;\n"
    "  for (const auto& config : configs) {\n"
    "    v8::Local<v8::String> name = V8AtomicString(isolate, config.name);\n"
    "    const v8::PropertyAttribute proteus_attribute =\n"
    "        !proteus_loose.empty() &&\n"
    "                std::find(proteus_loose.begin(), proteus_loose.end(),\n"
    "                          std::string_view(config.name)) !=\n"
    "                    proteus_loose.end()\n"
    "            ? v8::ReadOnly\n"
    "            : v8_property_attribute;\n",
)
edit(
    INSTALLER,
    "    if (has_prototype_template) {\n"
    "      prototype_template->Set(name, value, v8_property_attribute);\n"
    "    }\n"
    "    interface_template->Set(name, value, v8_property_attribute);\n",
    "    if (has_prototype_template) {\n"
    "      prototype_template->Set(name, value, proteus_attribute);\n"
    "    }\n"
    "    interface_template->Set(name, value, proteus_attribute);\n",
)
edit(
    INSTALLER,
    '#include "third_party/blink/renderer/platform/bindings/idl_member_installer.h"\n',
    '#include "third_party/blink/renderer/platform/bindings/idl_member_installer.h"\n'
    "\n"
    "#include <algorithm>\n"
    "#include <string>\n"
    "#include <string_view>\n"
    "#include <vector>\n"
    "\n"
    '#include "base/proteus/proteus_config.h"\n',
)
