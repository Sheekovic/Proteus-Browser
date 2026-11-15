"""Applies the in-place edits of patch 0002 (canvas noise) to a Chromium checkout.
New files are copied from kernel/src by the caller; this only touches existing files.
usage: 0002_canvas_noise.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
NOISE_INCLUDE = (
    '#include "third_party/blink/renderer/platform/graphics/proteus_canvas_noise.h"\n'
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


# 1. Compile the noise helper into blink platform.
edit(
    BLINK + "platform/BUILD.gn",
    '    "graphics/image_data_buffer.cc",\n    "graphics/image_data_buffer.h",\n',
    '    "graphics/image_data_buffer.cc",\n    "graphics/image_data_buffer.h",\n'
    '    "graphics/proteus_canvas_noise.cc",\n    "graphics/proteus_canvas_noise.h",\n',
)

# 2. canvas.toDataURL()
HCE = BLINK + "core/html/canvas/html_canvas_element.cc"
edit(
    HCE,
    "    std::unique_ptr<ImageDataBuffer> data_buffer =\n"
    "        ImageDataBuffer::Create(image_bitmap);\n"
    "    if (!data_buffer)\n"
    '      return String("data:,");\n'
    "\n"
    "    String data_url = data_buffer->ToDataURL(encoding_mime_type, quality);\n",
    "    std::unique_ptr<ImageDataBuffer> data_buffer =\n"
    "        ImageDataBuffer::Create(ProteusNoisedCanvasImage(image_bitmap));\n"
    "    if (!data_buffer)\n"
    '      return String("data:,");\n'
    "\n"
    "    String data_url = data_buffer->ToDataURL(encoding_mime_type, quality);\n",
)
edit(
    HCE,
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n',
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n'
    + NOISE_INCLUDE,
)

# 3. canvas.toBlob() and OffscreenCanvas.convertToBlob()
CABC = BLINK + "core/html/canvas/canvas_async_blob_creator.cc"
edit(
    CABC,
    "  image_ = image->MakeUnaccelerated();\n",
    "  image_ = ProteusNoisedCanvasImage(image->MakeUnaccelerated());\n",
)
edit(
    CABC,
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n',
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n'
    + NOISE_INCLUDE,
)

# 4. CanvasRenderingContext2D.getImageData()
BRC = BLINK + "modules/canvas/canvas2d/base_rendering_context_2d.cc"
edit(
    BRC,
    "    const bool read_pixels_successful =\n"
    "        snapshot->PaintImageForCurrentFrame().readPixels(\n"
    "            image_data_pixmap.info(), image_data_pixmap.writable_addr(),\n"
    "            image_data_pixmap.rowBytes(), sx, sy);\n",
    "    const bool read_pixels_successful =\n"
    "        ProteusReadNoisedCanvasPixels(snapshot->PaintImageForCurrentFrame(),\n"
    "                                      image_data_pixmap, sx, sy) ||\n"
    "        snapshot->PaintImageForCurrentFrame().readPixels(\n"
    "            image_data_pixmap.info(), image_data_pixmap.writable_addr(),\n"
    "            image_data_pixmap.rowBytes(), sx, sy);\n",
)
edit(
    BRC,
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n',
    '#include "third_party/blink/renderer/platform/graphics/image_data_buffer.h"\n'
    + NOISE_INCLUDE,
)
