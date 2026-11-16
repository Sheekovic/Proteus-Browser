"""Applies the in-place edits of patch 0023 to a Chromium checkout: WebGL reports the
capabilities of the profile's graphics card (limits, extensions, shader precision).
usage: 0023_webgl_caps.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
WEBGL = "third_party/blink/renderer/modules/webgl/"
BASE_CC = WEBGL + "webgl_rendering_context_base.cc"
BASE_H = WEBGL + "webgl_rendering_context_base.h"
WEBGL2_CC = WEBGL + "webgl2_rendering_context_base.cc"


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


# 1. Declarations.
edit(
    BASE_H,
    "  virtual ScriptValue getParameter(ScriptState*, GLenum pname);\n",
    "  virtual ScriptValue getParameter(ScriptState*, GLenum pname);\n"
    "  // Proteus: getParameter() results of the profile's graphics card. A forced\n"
    "  // parameter is first asked for the usual way (with the flag set, so that the\n"
    "  // call is not intercepted again) and replaced only if that gave a value of\n"
    "  // the same kind: errors, lost contexts and extensions that are not enabled\n"
    "  // behave as always.\n"
    "  bool proteus_in_stock_parameter_ = false;\n"
    "  static bool ProteusHasForcedParameter(bool webgl2, GLenum pname);\n"
    "  static ScriptValue ProteusForceParameter(ScriptState*,\n"
    "                                           bool webgl2,\n"
    "                                           GLenum pname,\n"
    "                                           ScriptValue stock);\n",
)

# 2. The helpers, and the extension gate: an extension the profile's card does not
#    offer is neither listed nor handed out, exactly as if the GPU lacked it.
GATE = (
    "bool WebGLRenderingContextBase::ExtensionSupportedAndAllowed(\n"
    "    const ExtensionTracker* tracker) {\n"
)
HELPERS = (
    "// Proteus: the capabilities of the profile's graphics card.\n"
    "static const base::proteus::Config::WebGLCaps& ProteusCaps(bool webgl2) {\n"
    "  return base::proteus::GetConfig().webgl_caps[webgl2 ? 1 : 0];\n"
    "}\n"
    "\n"
    "static const std::vector<double>* ProteusFindParameter(bool webgl2,\n"
    "                                                       GLenum pname) {\n"
    "  for (const auto& [name, numbers] : ProteusCaps(webgl2).params) {\n"
    "    if (name == pname) {\n"
    "      return &numbers;\n"
    "    }\n"
    "  }\n"
    "  return nullptr;\n"
    "}\n"
    "\n"
    "bool WebGLRenderingContextBase::ProteusHasForcedParameter(bool webgl2,\n"
    "                                                          GLenum pname) {\n"
    "  return ProteusFindParameter(webgl2, pname) != nullptr;\n"
    "}\n"
    "\n"
    "ScriptValue WebGLRenderingContextBase::ProteusForceParameter(\n"
    "    ScriptState* script_state,\n"
    "    bool webgl2,\n"
    "    GLenum pname,\n"
    "    ScriptValue stock) {\n"
    "  const std::vector<double>* forced = ProteusFindParameter(webgl2, pname);\n"
    "  if (!forced || stock.IsEmpty()) {\n"
    "    return stock;\n"
    "  }\n"
    "  v8::Isolate* isolate = script_state->GetIsolate();\n"
    "  v8::Local<v8::Value> value = stock.V8Value();\n"
    "  if (value->IsNumber() && forced->size() == 1) {\n"
    "    return ScriptValue(isolate, v8::Number::New(isolate, forced->front()));\n"
    "  }\n"
    "  if (value->IsInt32Array() &&\n"
    "      value.As<v8::Int32Array>()->Length() == forced->size()) {\n"
    "    std::vector<int32_t> numbers;\n"
    "    for (double number : *forced) {\n"
    "      numbers.push_back(base::saturated_cast<int32_t>(number));\n"
    "    }\n"
    "    return WebGLAny(script_state,\n"
    "                    DOMInt32Array::Create(base::span<const int32_t>(numbers)));\n"
    "  }\n"
    "  if (value->IsFloat32Array() &&\n"
    "      value.As<v8::Float32Array>()->Length() == forced->size()) {\n"
    "    std::vector<float> numbers;\n"
    "    for (double number : *forced) {\n"
    "      numbers.push_back(static_cast<float>(number));\n"
    "    }\n"
    "    return WebGLAny(script_state,\n"
    "                    DOMFloat32Array::Create(base::span<const float>(numbers)));\n"
    "  }\n"
    "  return stock;\n"
    "}\n"
    "\n"
    "static bool ProteusExtensionHidden(bool webgl2, const String& name) {\n"
    "  const base::proteus::Config::WebGLCaps& caps = ProteusCaps(webgl2);\n"
    "  if (!caps.has_extensions) {\n"
    "    return false;\n"
    "  }\n"
    "  for (const std::string& offered : caps.extensions) {\n"
    "    if (DeprecatedEqualIgnoringCase(name, String::FromUtf8(offered))) {\n"
    "      return false;\n"
    "    }\n"
    "  }\n"
    "  return true;\n"
    "}\n"
    "\n"
)
edit(
    BASE_CC,
    GATE,
    HELPERS
    + GATE
    + "  if (ProteusExtensionHidden(IsWebGL2(), String(tracker->ExtensionName()))) {\n"
    "    return false;\n"
    "  }\n",
)
edit(
    BASE_CC,
    '#include "base/proteus/proteus_config.h"\n',
    '#include "base/numerics/safe_conversions.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 3. getParameter(), in both context classes (WebGL 2 answers its own parameters
#    itself and passes the rest on).
INTERCEPT = (
    "  if (!proteus_in_stock_parameter_ &&\n"
    "      ProteusHasForcedParameter(IsWebGL2(), pname)) {\n"
    "    proteus_in_stock_parameter_ = true;\n"
    "    ScriptValue stock = getParameter(script_state, pname);\n"
    "    proteus_in_stock_parameter_ = false;\n"
    "    return ProteusForceParameter(script_state, IsWebGL2(), pname, stock);\n"
    "  }\n"
)
BASE_HEAD = (
    "ScriptValue WebGLRenderingContextBase::getParameter(ScriptState* script_state,\n"
    "                                                    GLenum pname) {\n"
    "  if (isContextLost())\n"
    "    return ScriptValue::CreateNull(script_state->GetIsolate());\n"
)
edit(BASE_CC, BASE_HEAD, BASE_HEAD + INTERCEPT)
WEBGL2_HEAD = (
    "ScriptValue WebGL2RenderingContextBase::getParameter(ScriptState* script_state,\n"
    "                                                     GLenum pname) {\n"
    "  if (isContextLost())\n"
    "    return ScriptValue::CreateNull(script_state->GetIsolate());\n"
)
edit(WEBGL2_CC, WEBGL2_HEAD, WEBGL2_HEAD + INTERCEPT)

# 4. getShaderPrecisionFormat().
PRECISION = (
    "  ContextGL()->GetShaderPrecisionFormat(shader_type, precision_type, range,\n"
    "                                        &precision);\n"
)
edit(
    BASE_CC,
    PRECISION,
    PRECISION
    + "  if (const std::vector<int>& forced =\n"
    "          ProteusCaps(IsWebGL2()).shader_precision;\n"
    "      forced.size() == 36) {\n"
    "    // Ordered as in proteus_config.h: vertex then fragment shader, the six\n"
    "    // precision types in the order of their GL names, three numbers each.\n"
    "    const size_t at = (shader_type == GL_VERTEX_SHADER ? 0 : 18) +\n"
    "                      (precision_type - GL_LOW_FLOAT) * 3;\n"
    "    range[0] = forced[at];\n"
    "    range[1] = forced[at + 1];\n"
    "    precision = forced[at + 2];\n"
    "  }\n",
)
