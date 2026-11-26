"""Applies the in-place edits of patch 0036 to a Chromium checkout: a camera whose picture
comes from a file offers the sizes a camera offers.

A profile whose devices are its own shows a file's picture for its camera (a covered
lens unless told otherwise). The stand-in device that plays the file offered one
size, the file's, where every real camera offers a list: a page that asked for 1280
by 720 got 640 by 480 and a camera that can do nothing else, and one that asked for
exactly 320 by 240 got an error. The device also said it can pan, tilt and zoom,
which a laptop's or a phone's camera cannot.

For a profile with devices of its own the device now offers the sizes of a camera up
to 1280 by 720 (1920 by 1080 on a phone), delivers the file's frames cut to the
asked shape and scaled to the asked size, and has no pan, tilt or zoom. Only for a
file of plain frames (.y4m): a .mjpeg file is passed on as it is, at its one size.
usage: 0036_camera_sizes.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
DEVICE_CC = "media/capture/video/file_video_capture_device.cc"
DEVICE_H = "media/capture/video/file_video_capture_device.h"
FACTORY = "media/capture/video/file_video_capture_device_factory.cc"


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


# 1. The sizes on offer, and no pan, tilt or zoom.
edit(
    FACTORY,
    "  control_support.pan = true;\n"
    "  control_support.tilt = true;\n"
    "  control_support.zoom = true;\n",
    "  // Proteus: the camera of a profile's device cannot be turned or zoomed.\n"
    "  const base::proteus::Config& proteus = base::proteus::GetConfig();\n"
    "  control_support.pan = !proteus.has_media_devices;\n"
    "  control_support.tilt = !proteus.has_media_devices;\n"
    "  control_support.zoom = !proteus.has_media_devices;\n",
)
edit(
    FACTORY,
    "  devices_info.back().supported_formats.push_back(capture_format);\n",
    "  devices_info.back().supported_formats.push_back(capture_format);\n"
    "  // Proteus: and the other sizes a camera has, which the device makes from\n"
    "  // the file's frames (see FileVideoCaptureDevice::OnCaptureTask).\n"
    "  if (proteus.has_media_devices &&\n"
    "      capture_format.pixel_format == PIXEL_FORMAT_I420) {\n"
    "    static constexpr std::array<std::array<int, 2>, 10> kSizes = {{\n"
    "        {1920, 1080}, {1280, 720}, {960, 540}, {848, 480}, {640, 480},\n"
    "        {640, 360},   {424, 240},  {320, 240}, {320, 180}, {160, 120}}};\n"
    "    const int widest = proteus.mobile ? 1920 : 1280;\n"
    "    for (const auto& size : kSizes) {\n"
    "      const gfx::Size offered(size[0], size[1]);\n"
    "      if (size[0] > widest || offered == capture_format.frame_size) {\n"
    "        continue;\n"
    "      }\n"
    "      VideoCaptureFormat other = capture_format;\n"
    "      other.frame_size = offered;\n"
    "      devices_info.back().supported_formats.push_back(other);\n"
    "    }\n"
    "  }\n",
)
edit(
    FACTORY,
    '#include "base/files/file_path.h"\n',
    '#include <array>\n\n#include "base/files/file_path.h"\n#include "base/proteus/proteus_config.h"\n',
)

# 2. The size that was asked for.
edit(
    DEVICE_H,
    "  VideoCaptureFormat capture_format_;\n",
    "  VideoCaptureFormat capture_format_;\n"
    "  // Proteus: the size frames are delivered at when it is not the file's.\n"
    "  gfx::Size proteus_size_;\n",
)
edit(
    DEVICE_CC,
    "  zoom_max_levels_ = gcd(capture_format_.frame_size.width(),\n",
    "  proteus_size_ = gfx::Size();\n"
    "  if (base::proteus::GetConfig().has_media_devices &&\n"
    "      capture_format_.pixel_format == PIXEL_FORMAT_I420 &&\n"
    "      !params.requested_format.frame_size.IsEmpty() &&\n"
    "      params.requested_format.frame_size != capture_format_.frame_size) {\n"
    "    proteus_size_ = params.requested_format.frame_size;\n"
    "  }\n"
    "\n"
    "  zoom_max_levels_ = gcd(capture_format_.frame_size.width(),\n",
)

# 3. The frames: cut to the asked shape about their middle, then scaled.
edit(
    DEVICE_CC,
    "void FileVideoCaptureDevice::OnCaptureTask() {\n",
    "// Proteus: a frame of |size| as one of |to|.\n"
    "static std::vector<uint8_t> ProteusScaleFrame(const std::vector<uint8_t>& from,\n"
    "                                              const gfx::Size& size,\n"
    "                                              const gfx::Size& to) {\n"
    "  int width = size.width();\n"
    "  int height = size.height();\n"
    "  if (width * to.height() > height * to.width()) {\n"
    "    width = (height * to.width() / to.height()) & ~1;\n"
    "  } else {\n"
    "    height = (width * to.height() / to.width()) & ~1;\n"
    "  }\n"
    "  const int left = ((size.width() - width) / 2) & ~1;\n"
    "  const int top = ((size.height() - height) / 2) & ~1;\n"
    "  const int stride = size.width();\n"
    "  const int half = (size.width() + 1) / 2;\n"
    "  const size_t luma = static_cast<size_t>(stride) * size.height();\n"
    "  const size_t chroma =\n"
    "      static_cast<size_t>(half) * ((size.height() + 1) / 2);\n"
    "  if (width <= 0 || height <= 0 || from.size() < luma + 2 * chroma) {\n"
    "    return from;\n"
    "  }\n"
    "  const int to_half = (to.width() + 1) / 2;\n"
    "  const size_t to_luma = static_cast<size_t>(to.width()) * to.height();\n"
    "  const size_t to_chroma =\n"
    "      static_cast<size_t>(to_half) * ((to.height() + 1) / 2);\n"
    "  std::vector<uint8_t> scaled(to_luma + 2 * to_chroma);\n"
    "  const size_t first = static_cast<size_t>(top) * stride + left;\n"
    "  const size_t first_chroma = static_cast<size_t>(top / 2) * half + left / 2;\n"
    "  UNSAFE_TODO(libyuv::I420Scale(\n"
    "      from.data() + first, stride, from.data() + luma + first_chroma, half,\n"
    "      from.data() + luma + chroma + first_chroma, half, width, height,\n"
    "      scaled.data(), to.width(), scaled.data() + to_luma, to_half,\n"
    "      scaled.data() + to_luma + to_chroma, to_half, to.width(), to.height(),\n"
    "      libyuv::kFilterBilinear));\n"
    "  return scaled;\n"
    "}\n"
    "\n"
    "void FileVideoCaptureDevice::OnCaptureTask() {\n",
)
edit(
    DEVICE_CC,
    "  VideoCaptureFormat ptz_format = capture_format_;\n"
    "  ptz_format.pixel_format = ptz_pixel_format;\n",
    "  VideoCaptureFormat ptz_format = capture_format_;\n"
    "  ptz_format.pixel_format = ptz_pixel_format;\n"
    "  if (!proteus_size_.IsEmpty() && ptz_pixel_format == PIXEL_FORMAT_I420) {\n"
    "    ptz_frame = ProteusScaleFrame(ptz_frame, capture_format_.frame_size,\n"
    "                                  proteus_size_);\n"
    "    ptz_format.frame_size = proteus_size_;\n"
    "  }\n",
)
edit(
    DEVICE_CC,
    "    const gfx::Size& buffer_size = capture_format_.frame_size;\n"
    "    scoped_refptr<gpu::ClientSharedImage> shared_image;\n",
    "    const gfx::Size& buffer_size = ptz_format.frame_size;\n"
    "    scoped_refptr<gpu::ClientSharedImage> shared_image;\n",
)
edit(
    DEVICE_CC,
    '#include "base/numerics/safe_conversions.h"\n',
    '#include "base/numerics/safe_conversions.h"\n#include "base/proteus/proteus_config.h"\n',
)
