"""Applies the in-place edits of patch 0013 to a Chromium checkout: canvas and audio
noise only where the content depends on the device, and no automation marker.
usage: 0013_known_content.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
C2D = BLINK + "modules/canvas/canvas2d/"
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


# 1. Every rendering context can say whether its canvas holds device-dependent
#    content. Contexts that do not track it (WebGL, ...) say yes.
edit(
    BLINK + "core/html/canvas/canvas_rendering_context.h",
    "  virtual bool IsOpaque() const = 0;\n\n"
    "  virtual scoped_refptr<StaticBitmapImage> GetImage() = 0;\n",
    "  virtual bool IsOpaque() const = 0;\n\n"
    "  // Proteus: whether the canvas holds pixels that differ between devices.\n"
    "  virtual bool ProteusHasDeviceDependentContent() const { return true; }\n\n"
    "  virtual scoped_refptr<StaticBitmapImage> GetImage() = 0;\n",
)

# 2. The 2D drawing code reports what it draws.
REC_H = C2D + "canvas_2d_recorder_context.h"
edit(
    REC_H,
    "  virtual void WillDrawImage(CanvasImageSource*, bool image_is_texture_backed) {\n"
    "  }\n",
    "  virtual void WillDrawImage(CanvasImageSource*, bool image_is_texture_backed) {\n"
    "  }\n\n"
    "  // Proteus: called for drawing whose pixels depend on the device.\n"
    "  virtual void ProteusMarkDeviceDependent() {}\n"
    "  virtual void ProteusNoteImageSource(CanvasImageSource*, bool is_svg) {}\n",
)
REC = C2D + "canvas_2d_recorder_context.cc"
VALIDATE = (
    "  if (!CanvasRenderingContext::ValidateRectForCanvas(x, y, width, height)) {\n"
    "    return;\n"
    "  }\n"
)
FILL_HEAD = (
    "void Canvas2DRecorderContext::fillRect(double x,\n"
    "                                       double y,\n"
    "                                       double width,\n"
    "                                       double height) {\n" + VALIDATE
)
edit(
    REC,
    FILL_HEAD,
    FILL_HEAD + "  // A plain axis-aligned rectangle in a plain colour comes out the same\n"
    "  // everywhere; anything fancier does not.\n"
    "  if (const CanvasRenderingContext2DState& proteus_state = GetState();\n"
    "      proteus_state.FillStyle().GetCanvasGradient() ||\n"
    "      proteus_state.FillStyle().GetCanvasPattern() ||\n"
    "      proteus_state.ShouldDrawShadows() ||\n"
    "      !proteus_state.GetTransform().IsIdentityOrTranslation()) {\n"
    "    ProteusMarkDeviceDependent();\n"
    "  }\n",
)
STROKE_HEAD = (
    "void Canvas2DRecorderContext::strokeRect(double x,\n"
    "                                         double y,\n"
    "                                         double width,\n"
    "                                         double height) {\n" + VALIDATE
)
edit(REC, STROKE_HEAD, STROKE_HEAD + "  ProteusMarkDeviceDependent();\n")
# An earlier revision of this script tested for SVG with a method that does not exist.
_rec = SRC / REC
_rec_text = _rec.read_text(encoding="utf-8")
_bad_svg_test = (
    "                         image && (image->IsSVGImage() ||\n"
    "                                   image->IsSVGImageForContainer()));\n"
)
_svg_test = (
    "                         image && !image->IsBitmapImage() &&\n"
    "                             !image->IsStaticBitmapImage());\n"
)
if _bad_svg_test in _rec_text:
    _rec.write_text(_rec_text.replace(_bad_svg_test, _svg_test), encoding="utf-8", newline="\n")
# Anything that is not a decoded bitmap (an SVG, which renders text and curves
# when drawn) counts as device-dependent.
edit(
    REC,
    "  ValidateStateStack();\n\n"
    "  WillDrawImage(image_source, image && image->IsTextureBacked());\n",
    "  ValidateStateStack();\n\n"
    "  ProteusNoteImageSource(image_source,\n" + _svg_test +
    "  WillDrawImage(image_source, image && image->IsTextureBacked());\n",
)
edit(
    REC,
    "  CHECK_NE(index_data, nullptr);\n\n"
    "  WillDrawImage(image_source, image && image->IsTextureBacked());\n",
    "  CHECK_NE(index_data, nullptr);\n\n"
    "  ProteusMarkDeviceDependent();\n"
    "  WillDrawImage(image_source, image && image->IsTextureBacked());\n",
)

# 3. The 2D context keeps the flag.
BRC_H = C2D + "base_rendering_context_2d.h"
edit(
    BRC_H,
    "  bool context_restorable_{true};\n\n private:\n",
    "  bool context_restorable_{true};\n\n"
    "  // Proteus: paths, text and DOM elements render differently per device.\n"
    "  void ProteusNoteDraw(CanvasPerformanceMonitor::DrawType type) {\n"
    "    if (type == CanvasPerformanceMonitor::DrawType::kPath ||\n"
    "        type == CanvasPerformanceMonitor::DrawType::kText ||\n"
    "        type == CanvasPerformanceMonitor::DrawType::kElement) {\n"
    "      proteus_device_dependent_ = true;\n"
    "    }\n"
    "  }\n"
    "  void ProteusMarkDeviceDependent() override {\n"
    "    proteus_device_dependent_ = true;\n"
    "  }\n"
    "  void ProteusNoteImageSource(CanvasImageSource*, bool is_svg) override;\n\n"
    " public:\n"
    "  bool ProteusHasDeviceDependentContent() const override {\n"
    "    return proteus_device_dependent_;\n"
    "  }\n\n"
    " private:\n"
    "  bool proteus_device_dependent_ = false;\n",
)
BRC = C2D + "base_rendering_context_2d.cc"
edit(
    BRC,
    "void BaseRenderingContext2D::ResetInternal() {\n"
    "  Canvas2DRecorderContext::ResetInternal();\n"
    "  clear_frame_ = true;\n"
    "}\n",
    "void BaseRenderingContext2D::ResetInternal() {\n"
    "  Canvas2DRecorderContext::ResetInternal();\n"
    "  clear_frame_ = true;\n"
    "  proteus_device_dependent_ = false;\n"
    "}\n\n"
    "void BaseRenderingContext2D::ProteusNoteImageSource(CanvasImageSource* source,\n"
    "                                                    bool is_svg) {\n"
    "  if (proteus_device_dependent_) {\n"
    "    return;\n"
    "  }\n"
    "  // A decoded bitmap image is the same everywhere.\n"
    "  if (source->IsImageElement() && !is_svg) {\n"
    "    return;\n"
    "  }\n"
    "  // Another canvas passes on what it holds.\n"
    "  CanvasRenderingContext* context = nullptr;\n"
    "  if (source->IsCanvasElement()) {\n"
    "    context = static_cast<HTMLCanvasElement*>(source)->RenderingContext();\n"
    "  } else if (source->IsOffscreenCanvas()) {\n"
    "    context = static_cast<OffscreenCanvas*>(source)->RenderingContext();\n"
    "  } else {\n"
    "    proteus_device_dependent_ = true;\n"
    "    return;\n"
    "  }\n"
    "  if (context && context->ProteusHasDeviceDependentContent()) {\n"
    "    proteus_device_dependent_ = true;\n"
    "  }\n"
    "}\n",
)
edit(
    BRC,
    "        ProteusReadNoisedCanvasPixels(snapshot->PaintImageForCurrentFrame(),\n"
    "                                      image_data_pixmap, sx, sy) ||\n",
    "        (proteus_device_dependent_ &&\n"
    "         ProteusReadNoisedCanvasPixels(snapshot->PaintImageForCurrentFrame(),\n"
    "                                       image_data_pixmap, sx, sy)) ||\n",
)
for rel, cls in (
    (C2D + "canvas_rendering_context_2d.cc", "CanvasRenderingContext2D"),
    (
        BLINK + "modules/canvas/offscreencanvas2d/offscreen_canvas_rendering_context_2d.cc",
        "OffscreenCanvasRenderingContext2D",
    ),
):
    head = (
        "void %s::WillDraw(\n"
        "    const gfx::Rect& dirty_rect,\n"
        "    CanvasPerformanceMonitor::DrawType draw_type) {\n" % cls
    )
    edit(rel, head, head + "  ProteusNoteDraw(draw_type);\n")

# 4. Encoded readbacks consult the flag.
HCE = BLINK + "core/html/canvas/html_canvas_element.cc"
edit(
    HCE,
    "        ImageDataBuffer::Create(ProteusNoisedCanvasImage(image_bitmap));\n",
    "        ImageDataBuffer::Create(ProteusNoisedCanvasImage(\n"
    "            image_bitmap,\n"
    "            !context_ || context_->ProteusHasDeviceDependentContent()));\n",
)
edit(
    HCE,
    "  scoped_refptr<StaticBitmapImage> image_bitmap = Snapshot(kBackBuffer);\n"
    "  if (image_bitmap) {\n"
    "    auto* options = ImageEncodeOptions::Create();\n",
    "  scoped_refptr<StaticBitmapImage> image_bitmap = ProteusNoisedCanvasImage(\n"
    "      Snapshot(kBackBuffer),\n"
    "      !context_ || context_->ProteusHasDeviceDependentContent());\n"
    "  if (image_bitmap) {\n"
    "    auto* options = ImageEncodeOptions::Create();\n",
)
OC = BLINK + "core/offscreencanvas/offscreen_canvas.cc"
edit(
    OC,
    "  base::TimeTicks start_time = base::TimeTicks::Now();\n"
    "  scoped_refptr<StaticBitmapImage> image_bitmap = context_->GetImage();\n",
    "  base::TimeTicks start_time = base::TimeTicks::Now();\n"
    "  scoped_refptr<StaticBitmapImage> image_bitmap = ProteusNoisedCanvasImage(\n"
    "      context_->GetImage(), context_->ProteusHasDeviceDependentContent());\n",
)
edit(
    OC,
    '#include "third_party/blink/renderer/platform/graphics/static_bitmap_image.h"\n',
    NOISE_INCLUDE
    + '#include "third_party/blink/renderer/platform/graphics/static_bitmap_image.h"\n',
)
# The blob creator no longer adds noise itself: its callers did, knowing the canvas.
edit(
    BLINK + "core/html/canvas/canvas_async_blob_creator.cc",
    "  image_ = ProteusNoisedCanvasImage(image->MakeUnaccelerated());\n",
    "  image_ = image->MakeUnaccelerated();  // Proteus: noised by the caller.\n",
)

# 5. Audio: only graphs with nodes whose output depends on the device.
WEBAUDIO = BLINK + "modules/webaudio/"
edit(
    WEBAUDIO + "base_audio_context.h",
    "  bool HasAllocationFailed() const { return has_allocation_failed_; }\n",
    "  bool HasAllocationFailed() const { return has_allocation_failed_; }\n\n"
    "  // Proteus: set once the graph has a node whose output differs between\n"
    "  // devices, as opposed to only replaying samples the page supplied.\n"
    "  void ProteusMarkDeviceDependent() { proteus_device_dependent_ = true; }\n"
    "  bool ProteusIsDeviceDependent() const { return proteus_device_dependent_; }\n",
)
edit(
    WEBAUDIO + "base_audio_context.h",
    "  bool has_allocation_failed_ = false;\n",
    "  bool has_allocation_failed_ = false;\n  bool proteus_device_dependent_ = false;\n",
)
HANDLER_ANCHOR = (
    "  SetNodeType(node_type);\n"
    "  SetInternalChannelCountMode(V8ChannelCountMode::Enum::kMax);\n"
)
HANDLER_TYPES = ("Oscillator", "BiquadFilter", "Panner", "StereoPanner", "Convolver",
                 "DynamicsCompressor", "WaveShaper", "IIRFilter")


def handler_switch(prefix):
    return (
        "  SetNodeType(node_type);\n"
        "  switch (node_type) {\n"
        + "".join("    case %skNodeType%s:\n" % (prefix, t) for t in HANDLER_TYPES)
        + "      context_->ProteusMarkDeviceDependent();\n"
        "      break;\n"
        "    default:\n"
        "      break;\n"
        "  }\n"
        "  SetInternalChannelCountMode(V8ChannelCountMode::Enum::kMax);\n"
    )


# An earlier revision of this script wrote the cases without the enum's scope.
_handler = SRC / (WEBAUDIO + "audio_handler.cc")
_text = _handler.read_text(encoding="utf-8")
if handler_switch("") in _text:
    _handler.write_text(_text.replace(handler_switch(""), HANDLER_ANCHOR), encoding="utf-8", newline="\n")
edit(WEBAUDIO + "audio_handler.cc", HANDLER_ANCHOR, handler_switch("NodeType::"))
edit(
    WEBAUDIO + "offline_audio_context.cc",
    "  ProteusApplyAudioNoise(rendered_buffer.Get());\n",
    "  if (ProteusIsDeviceDependent()) {\n"
    "    ProteusApplyAudioNoise(rendered_buffer.Get());\n"
    "  }\n",
)

# 6. A profile is driven through DevTools; pages must not be told.
NAV = BLINK + "core/frame/navigator.cc"
edit(
    NAV,
    "bool Navigator::webdriver() const {\n",
    "bool Navigator::webdriver() const {\n"
    "  if (base::proteus::GetConfig().active) {\n"
    "    return false;\n"
    "  }\n",
)
edit(
    NAV,
    '#include "third_party/blink/renderer/core/frame/navigator.h"\n',
    '#include "third_party/blink/renderer/core/frame/navigator.h"\n\n'
    '#include "base/proteus/proteus_config.h"\n',
)
