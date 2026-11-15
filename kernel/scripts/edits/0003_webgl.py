"""Applies the in-place edits of patch 0003 (WebGL identity and readPixels noise) to a
Chromium checkout. New files are copied from kernel/src by the caller.
usage: 0003_webgl.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
WEBGL = "third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc"


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


# 1. WEBGL_debug_renderer_info: unmasked renderer and vendor strings.
for gl_name, field in (("GL_RENDERER", "webgl_renderer"), ("GL_VENDOR", "webgl_vendor")):
    edit(
        WEBGL,
        "      if (ExtensionEnabled(kWebGLDebugRendererInfoName)) {\n"
        "        return WebGLAny(script_state,\n"
        "                        String(ContextGL()->GetString(%s)));\n" % gl_name,
        "      if (ExtensionEnabled(kWebGLDebugRendererInfoName)) {\n"
        "        if (const std::string& forced =\n"
        "                base::proteus::GetConfig().%s;\n"
        "            !forced.empty()) {\n"
        "          return WebGLAny(script_state,\n"
        "                          String::FromUtf8(base::as_byte_span(forced)));\n"
        "        }\n"
        "        return WebGLAny(script_state,\n"
        "                        String(ContextGL()->GetString(%s)));\n" % (field, gl_name),
    )

# 2. readPixels() into client memory: same noise as 2D canvas readbacks.
edit(
    WEBGL,
    "    ContextGL()->ReadPixels(x, y, width, height, format, type, data);\n",
    "    // Proteus: read one extra column on the left as neighbour context, then\n"
    "    // hand the caller noised pixels. Canvas rows run top-down and WebGL rows\n"
    "    // bottom-up, hence the flipped origin and the -1 step.\n"
    "    bool proteus_noised = false;\n"
    "    if (ProteusCanvasNoiseEnabled() && format == GL_RGBA &&\n"
    "        type == GL_UNSIGNED_BYTE && data && width > 0 && height > 0 &&\n"
    "        width < std::numeric_limits<GLsizei>::max() &&\n"
    "        x > std::numeric_limits<GLint>::min()) {\n"
    "      const WebGLImageConversion::PixelStoreParams pack =\n"
    "          GetPackPixelStoreParams();\n"
    "      base::CheckedNumeric<wtf_size_t> scratch_size = width;\n"
    "      scratch_size += 1;\n"
    "      scratch_size *= height;\n"
    "      scratch_size *= 4;\n"
    "      if (pack.alignment <= 4 && pack.row_length == 0 &&\n"
    "          pack.skip_pixels == 0 && pack.skip_rows == 0 &&\n"
    "          scratch_size.IsValid()) {\n"
    "        Vector<uint8_t> scratch(scratch_size.ValueOrDie());\n"
    "        ContextGL()->ReadPixels(x - 1, y, width + 1, height, format, type,\n"
    "                                scratch.data());\n"
    "        ProteusNoiseAndCopyRgba(\n"
    "            scratch, width + 1, height, int64_t{x} - 1,\n"
    "            int64_t{drawingBufferHeight()} - 1 - int64_t{y}, -1, data);\n"
    "        proteus_noised = true;\n"
    "      }\n"
    "    }\n"
    "    if (!proteus_noised) {\n"
    "      ContextGL()->ReadPixels(x, y, width, height, format, type, data);\n"
    "    }\n",
)

# 3. Includes.
edit(
    WEBGL,
    '#include "base/numerics/checked_math.h"\n',
    '#include "base/numerics/checked_math.h"\n'
    '#include "base/proteus/proteus_config.h"\n',
)
edit(
    WEBGL,
    '#include "base/bit_cast.h"\n',
    '#include <limits>\n#include <string>\n\n#include "base/bit_cast.h"\n',
)
edit(
    WEBGL,
    '#include "third_party/blink/renderer/platform/graphics/gpu/shared_gpu_context.h"\n',
    '#include "third_party/blink/renderer/platform/graphics/gpu/shared_gpu_context.h"\n'
    '#include "third_party/blink/renderer/platform/graphics/proteus_canvas_noise.h"\n',
)
