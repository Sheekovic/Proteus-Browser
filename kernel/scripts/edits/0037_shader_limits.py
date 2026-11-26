"""Applies the in-place edits of patch 0037 to a Chromium checkout: the limits of the
profile's graphics card are the limits WebGL works within, shaders included.

Patch 0023 made getParameter() answer with the profile's limits and patch 0034 made
the checks WebGL makes in the page's process use them. What is checked where the
drawing is done was still the machine's: a shader with more uniforms, varyings or
samplers than the claimed card has was compiled and linked on a machine whose card
has more.

The drawing is done by ANGLE in the graphics process, which keeps the card's
capabilities per context and checks everything against them, the shader compiler
included. For a WebGL context those capabilities are now lowered to the profile's
where the profile's card has less. ANGLE is built apart from the rest and cannot read
the profile, so the graphics process hands it the limits in an environment variable
of its own as it starts.
usage: 0037_shader_limits.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
CONTEXT = "third_party/angle/src/libANGLE/Context.cpp"
GPU_MAIN = "content/gpu/gpu_main.cc"


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


# 1. The graphics process says what the profile's card can do: for each version of
#    WebGL, "name=value" pairs by the parameters' numbers, as getParameter() has them.
edit(
    GPU_MAIN,
    "  const base::CommandLine& command_line = *parameters.command_line;\n"
    "\n"
    "  gpu::GpuPreferences gpu_preferences;\n",
    "  const base::CommandLine& command_line = *parameters.command_line;\n"
    "\n"
    "  // Proteus: see patch 0037.\n"
    "  {\n"
    "    std::string limits;\n"
    "    for (int version = 0; version < 2; ++version) {\n"
    "      limits += base::NumberToString(version + 1) + \":\";\n"
    "      for (const auto& [name, numbers] :\n"
    "           base::proteus::GetConfig().webgl_caps[version].params) {\n"
    "        if (numbers.empty() || numbers.size() > 2) {\n"
    "          continue;\n"
    "        }\n"
    "        limits += base::NumberToString(name) + \"=\" +\n"
    "                  base::NumberToString(\n"
    "                      base::saturated_cast<int>(numbers.front()));\n"
    "        if (numbers.size() == 2) {\n"
    "          limits += \"x\" + base::NumberToString(\n"
    "                              base::saturated_cast<int>(numbers.back()));\n"
    "        }\n"
    "        limits += \",\";\n"
    "      }\n"
    "      limits += \";\";\n"
    "    }\n"
    "    base::Environment::Create()->SetVar(\"PROTEUS_GL_LIMITS\", limits);\n"
    "  }\n"
    "\n"
    "  gpu::GpuPreferences gpu_preferences;\n",
)
edit(
    GPU_MAIN,
    '#include "base/command_line.h"\n',
    '#include "base/command_line.h"\n'
    '#include "base/environment.h"\n'
    '#include "base/numerics/safe_conversions.h"\n'
    '#include "base/proteus/proteus_config.h"\n'
    '#include "base/strings/string_number_conversions.h"\n',
)

# 2. ANGLE lowers a WebGL context's capabilities to them.
edit(
    CONTEXT,
    "void Context::initCaps()\n{\n",
    "// Proteus: lowers the capabilities of a WebGL context to those of the profile's\n"
    "// graphics card, where that card has less (see patch 0037 of Proteus). The limits\n"
    "// come from the graphics process as \"1:name=value,...;2:name=value,...;\", by\n"
    "// version of WebGL and by the numbers of the parameters.\n"
    "static void ProteusLowerCaps(int webGLVersion, Caps *caps)\n"
    "{\n"
    "    const std::string all = angle::GetEnvironmentVar(\"PROTEUS_GL_LIMITS\");\n"
    "    const std::string head = (webGLVersion >= 2 ? \"2:\" : \"1:\");\n"
    "    const size_t start = all.find(head);\n"
    "    if (start == std::string::npos)\n"
    "    {\n"
    "        return;\n"
    "    }\n"
    "    const size_t end = all.find(';', start);\n"
    "    std::istringstream limits(all.substr(\n"
    "        start + 2, end == std::string::npos ? std::string::npos : end - start - 2));\n"
    "    const auto lower = [](GLint *cap, long limit) {\n"
    "        if (limit > 0 && limit < *cap)\n"
    "        {\n"
    "            *cap = static_cast<GLint>(limit);\n"
    "        }\n"
    "    };\n"
    "    std::string pair;\n"
    "    while (std::getline(limits, pair, ','))\n"
    "    {\n"
    "        const size_t equals = pair.find('=');\n"
    "        if (equals == std::string::npos)\n"
    "        {\n"
    "            continue;\n"
    "        }\n"
    "        const long name   = strtol(pair.c_str(), nullptr, 10);\n"
    "        const long first  = strtol(pair.c_str() + equals + 1, nullptr, 10);\n"
    "        const size_t by   = pair.find('x', equals);\n"
    "        const long second = by == std::string::npos ? first : strtol(pair.c_str() + by + 1, nullptr, 10);\n"
    "        switch (name)\n"
    "        {\n"
    "            case 0x0D33:  // MAX_TEXTURE_SIZE\n"
    "                lower(&caps->max2DTextureSize, first);\n"
    "                break;\n"
    "            case 0x851C:  // MAX_CUBE_MAP_TEXTURE_SIZE\n"
    "                lower(&caps->maxCubeMapTextureSize, first);\n"
    "                break;\n"
    "            case 0x8073:  // MAX_3D_TEXTURE_SIZE\n"
    "                lower(&caps->max3DTextureSize, first);\n"
    "                break;\n"
    "            case 0x88FF:  // MAX_ARRAY_TEXTURE_LAYERS\n"
    "                lower(&caps->maxArrayTextureLayers, first);\n"
    "                break;\n"
    "            case 0x84E8:  // MAX_RENDERBUFFER_SIZE\n"
    "                lower(&caps->maxRenderbufferSize, first);\n"
    "                break;\n"
    "            case 0x0D3A:  // MAX_VIEWPORT_DIMS\n"
    "                lower(&caps->maxViewportWidth, first);\n"
    "                lower(&caps->maxViewportHeight, second);\n"
    "                break;\n"
    "            case 0x8869:  // MAX_VERTEX_ATTRIBS\n"
    "                lower(&caps->maxVertexAttributes, first);\n"
    "                break;\n"
    "            case 0x8B4D:  // MAX_COMBINED_TEXTURE_IMAGE_UNITS\n"
    "                lower(&caps->maxCombinedTextureImageUnits, first);\n"
    "                break;\n"
    "            case 0x8872:  // MAX_TEXTURE_IMAGE_UNITS\n"
    "                lower(&caps->maxShaderTextureImageUnits[ShaderType::Fragment], first);\n"
    "                break;\n"
    "            case 0x8B4C:  // MAX_VERTEX_TEXTURE_IMAGE_UNITS\n"
    "                lower(&caps->maxShaderTextureImageUnits[ShaderType::Vertex], first);\n"
    "                break;\n"
    "            case 0x8DFB:  // MAX_VERTEX_UNIFORM_VECTORS\n"
    "                lower(&caps->maxVertexUniformVectors, first);\n"
    "                lower(&caps->maxShaderUniformComponents[ShaderType::Vertex], first * 4);\n"
    "                break;\n"
    "            case 0x8DFD:  // MAX_FRAGMENT_UNIFORM_VECTORS\n"
    "                lower(&caps->maxFragmentUniformVectors, first);\n"
    "                lower(&caps->maxShaderUniformComponents[ShaderType::Fragment], first * 4);\n"
    "                break;\n"
    "            case 0x8B4A:  // MAX_VERTEX_UNIFORM_COMPONENTS\n"
    "                lower(&caps->maxShaderUniformComponents[ShaderType::Vertex], first);\n"
    "                lower(&caps->maxVertexUniformVectors, first / 4);\n"
    "                break;\n"
    "            case 0x8B49:  // MAX_FRAGMENT_UNIFORM_COMPONENTS\n"
    "                lower(&caps->maxShaderUniformComponents[ShaderType::Fragment], first);\n"
    "                lower(&caps->maxFragmentUniformVectors, first / 4);\n"
    "                break;\n"
    "            case 0x8DFC:  // MAX_VARYING_VECTORS\n"
    "                lower(&caps->maxVaryingVectors, first);\n"
    "                lower(&caps->maxVaryingComponents, first * 4);\n"
    "                break;\n"
    "            case 0x8B4B:  // MAX_VARYING_COMPONENTS\n"
    "                lower(&caps->maxVaryingComponents, first);\n"
    "                lower(&caps->maxVaryingVectors, first / 4);\n"
    "                break;\n"
    "            case 0x9122:  // MAX_VERTEX_OUTPUT_COMPONENTS\n"
    "                lower(&caps->maxVertexOutputComponents, first);\n"
    "                break;\n"
    "            case 0x9125:  // MAX_FRAGMENT_INPUT_COMPONENTS\n"
    "                lower(&caps->maxFragmentInputComponents, first);\n"
    "                break;\n"
    "            case 0x8824:  // MAX_DRAW_BUFFERS\n"
    "                lower(&caps->maxDrawBuffers, first);\n"
    "                break;\n"
    "            case 0x8CDF:  // MAX_COLOR_ATTACHMENTS\n"
    "                lower(&caps->maxColorAttachments, first);\n"
    "                break;\n"
    "            case 0x8A2F:  // MAX_UNIFORM_BUFFER_BINDINGS\n"
    "                lower(&caps->maxUniformBufferBindings, first);\n"
    "                break;\n"
    "            case 0x8C8B:  // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS\n"
    "                lower(&caps->maxTransformFeedbackSeparateAttributes, first);\n"
    "                break;\n"
    "            default:\n"
    "                break;\n"
    "        }\n"
    "    }\n"
    "}\n"
    "\n"
    "void Context::initCaps()\n{\n",
)
# (An earlier revision asked the version for a member it does not have.)
_context = SRC / CONTEXT
_text = _context.read_text(encoding="utf-8")
if "getClientVersion().major >= 3" in _text:
    _context.write_text(
        _text.replace("getClientVersion().major >= 3", "getClientVersion() >= Version(3, 0)"),
        encoding="utf-8",
        newline="\n",
    )
    print("corrected the version check")
edit(
    CONTEXT,
    "    const Limitations &limitations = getLimitations();\n"
    "\n"
    "    if (mWebGLContext && limitations.webGLTextureSizeLimit > 0)\n",
    "    const Limitations &limitations = getLimitations();\n"
    "\n"
    "    if (mWebGLContext)\n"
    "    {\n"
    "        ProteusLowerCaps(getClientVersion() >= Version(3, 0) ? 2 : 1, caps);\n"
    "    }\n"
    "\n"
    "    if (mWebGLContext && limitations.webGLTextureSizeLimit > 0)\n",
)
