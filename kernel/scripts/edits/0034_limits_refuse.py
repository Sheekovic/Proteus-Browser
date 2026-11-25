"""Applies the in-place edits of patch 0034 to a Chromium checkout: what goes beyond a
limit of the profile's graphics card is refused, as that card refuses it.

Patch 0023 made getParameter() answer with the profile's limits, but the checks
WebGL makes itself were still made against the machine's: a page that asked for a
texture one pixel wider than the claimed MAX_TEXTURE_SIZE got it where the machine's
card is larger, which the claimed card never gives. The limits WebGL keeps for its
own checks are now the smaller of the machine's and the profile's: texture,
cube-map, 3D-texture and renderbuffer sizes, array layers, the viewport and with it
the drawing buffer, vertex attributes, texture units, draw buffers and colour
attachments, and WebGL 2's transform-feedback attributes and uniform-buffer bindings.
A limit the profile claims above the machine's stays the machine's: nothing can give
what the hardware does not have.
usage: 0034_limits_refuse.py <chromium-src-dir>"""
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


def before(rel, anchor, added):
    """Puts `added` in front of `anchor`."""
    edit(rel, anchor, added + anchor)


def lower(name, value, indent="  "):
    return "%sProteusLowerLimit(IsWebGL2(), %s, %s);\n" % (indent, name, value)


def one(name, variable, indent="  "):
    return lower(name, "base::span_from_ref(%s)" % variable, indent)


# 1. The helper.
edit(
    BASE_H,
    "  static bool ProteusHasForcedParameter(bool webgl2, GLenum pname);\n",
    "  static bool ProteusHasForcedParameter(bool webgl2, GLenum pname);\n"
    "  // Proteus: lowers limits read from the machine's card to the profile's,\n"
    "  // where the profile's card has less, so that what goes beyond them is\n"
    "  // refused by the checks that use them.\n"
    "  static void ProteusLowerLimit(bool webgl2,\n"
    "                                GLenum pname,\n"
    "                                base::span<GLint> values);\n",
)
edit(
    BASE_H,
    '#include "base/check_op.h"\n',
    '#include "base/check_op.h"\n#include "base/containers/span.h"\n',
)
before(
    BASE_CC,
    "static bool ProteusExtensionHidden(bool webgl2, const String& name) {\n",
    "void WebGLRenderingContextBase::ProteusLowerLimit(bool webgl2,\n"
    "                                                  GLenum pname,\n"
    "                                                  base::span<GLint> values) {\n"
    "  const std::vector<double>* claimed = ProteusFindParameter(webgl2, pname);\n"
    "  if (!claimed || claimed->size() != values.size()) {\n"
    "    return;\n"
    "  }\n"
    "  for (size_t i = 0; i < values.size(); ++i) {\n"
    "    const GLint limit = base::saturated_cast<GLint>((*claimed)[i]);\n"
    "    if (limit > 0 && limit < values[i]) {\n"
    "      values[i] = limit;\n"
    "    }\n"
    "  }\n"
    "}\n"
    "\n",
)

# 2. The viewport, which the drawing buffer is kept inside.
before(
    BASE_CC,
    "  InitializeWebGLContextLimits(context_provider.get());\n",
    lower("GL_MAX_VIEWPORT_DIMS", "max_viewport_dims_"),
)

# 3. The limits read as a context starts.
before(
    BASE_CC,
    "  texture_units_.clear();\n",
    one("GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS", "num_combined_texture_image_units"),
)
before(
    BASE_CC,
    "  max_vertex_attribs_ = num_vertex_attribs;\n",
    one("GL_MAX_VERTEX_ATTRIBS", "num_vertex_attribs"),
)
before(
    BASE_CC,
    "  max_texture_level_ =\n"
    "      WebGLTexture::ComputeLevelCount(max_texture_size_, max_texture_size_, 1);\n",
    one("GL_MAX_TEXTURE_SIZE", "max_texture_size_"),
)
before(
    BASE_CC,
    "  max3d_texture_size_ = 0;\n  max3d_texture_level_ = 0;\n",
    one("GL_MAX_CUBE_MAP_TEXTURE_SIZE", "max_cube_map_texture_size_"),
)
before(
    BASE_CC,
    "    max3d_texture_level_ = WebGLTexture::ComputeLevelCount(\n",
    one("GL_MAX_3D_TEXTURE_SIZE", "max3d_texture_size_", "    "),
)
before(
    BASE_CC,
    "  max_cube_map_texture_level_ = WebGLTexture::ComputeLevelCount(\n",
    one("GL_MAX_ARRAY_TEXTURE_LAYERS", "max_array_texture_layers_"),
)
before(
    BASE_CC,
    "  // These two values from EXT_draw_buffers are lazily queried.\n",
    one("GL_MAX_RENDERBUFFER_SIZE", "max_renderbuffer_size_"),
)

# 4. The two read when first asked for.
before(
    BASE_CC,
    "  // WEBGL_draw_buffers requires MAX_COLOR_ATTACHMENTS >= MAX_DRAW_BUFFERS.\n",
    one("GL_MAX_DRAW_BUFFERS_EXT", "max_draw_buffers_")
    + one("GL_MAX_COLOR_ATTACHMENTS_EXT", "max_color_attachments_"),
)
before(
    BASE_CC,
    "  return max_color_attachments_;\n",
    one("GL_MAX_COLOR_ATTACHMENTS_EXT", "max_color_attachments_"),
)

# 5. A renderbuffer's size was left for the card to refuse; it is asked here first.
TOO_LARGE = (
    "  if (width > max_renderbuffer_size_ || height > max_renderbuffer_size_) {\n"
    "    // Proteus: the limit is the profile's where its card has less.\n"
    "    SynthesizeGLError(GL_INVALID_VALUE, function_name,\n"
    '                      "width or height > MAX_RENDERBUFFER_SIZE");\n'
    "    return;\n"
    "  }\n"
)
edit(
    BASE_CC,
    "  if (!ValidateSize(function_name, width, height))\n    return;\n"
    "  RenderbufferStorageImpl(target, 0, internalformat, width, height,\n",
    "  if (!ValidateSize(function_name, width, height))\n    return;\n"
    + TOO_LARGE
    + "  RenderbufferStorageImpl(target, 0, internalformat, width, height,\n",
)
edit(
    WEBGL2_CC,
    '  if (!ValidateSize("renderbufferStorage", width, height))\n    return;\n'
    "  if (samples < 0) {\n",
    '  if (!ValidateSize("renderbufferStorage", width, height))\n    return;\n'
    + TOO_LARGE
    + "  if (samples < 0) {\n",
)

# 6. WebGL 2's own.
before(
    WEBGL2_CC,
    "  sampler_units_.clear();\n",
    one("GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS", "num_combined_texture_image_units"),
)
before(
    WEBGL2_CC,
    "  // Create a default transform feedback object so there is a place to\n",
    one("GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS",
        "max_transform_feedback_separate_attribs_"),
)
before(
    WEBGL2_CC,
    "  bound_indexed_uniform_buffers_.clear();\n",
    one("GL_MAX_UNIFORM_BUFFER_BINDINGS", "max_uniform_buffer_bindings"),
)
edit(
    WEBGL2_CC,
    '#include "base/containers/heap_array.h"\n',
    '#include "base/containers/heap_array.h"\n#include "base/containers/span.h"\n',
)
