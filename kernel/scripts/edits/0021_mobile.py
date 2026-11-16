"""Applies the in-place edits of patch 0021 to a Chromium checkout: phone profiles.
usage: 0021_mobile.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
PROTEUS_INCLUDE = '#include "base/proteus/proteus_config.h"\n'


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


# 1. Device emulation, the mechanism DevTools' device mode uses, switched on for
#    every main frame from the profile instead of by a DevTools client: the phone's
#    screen and view size, its pixel ratio, mobile viewport and scrollbar rules, and
#    touch instead of a mouse (touch events, coarse pointer, no hover).
EMULATION = (
    "  if (const base::proteus::Config& proteus = base::proteus::GetConfig();\n"
    "      proteus.mobile && %s) {\n"
    "    DeviceEmulationParams params;\n"
    "    params.screen_type = mojom::EmulatedScreenType::kMobile;\n"
    "    if (proteus.screen) {\n"
    "      params.screen_size =\n"
    "          gfx::Size(proteus.screen->width, proteus.screen->height);\n"
    "    }\n"
    "    params.view_size =\n"
    "        gfx::Size(proteus.mobile_view_width, proteus.mobile_view_height);\n"
    "    params.device_scale_factor =\n"
    "        static_cast<float>(proteus.mobile_device_scale_factor);\n"
    "    params.screen_orientation_type =\n"
    "        display::mojom::ScreenOrientation::kPortraitPrimary;\n"
    "    params.force_viewport_meta = true;\n"
    "    params.force_android_overlay_scrollbar = true;\n"
    "    params.force_text_size_adjust = true;\n"
    "%s"
    "  }\n"
)

# An earlier revision of this script did it when the frame's widget was set up,
# which is before the frame can report scale changes to the browser (a crash).
_widget = SRC / (BLINK + "core/frame/web_frame_widget_impl.cc")
_text = _widget.read_text(encoding="utf-8")
_early = "\n" + EMULATION % (
    "ForMainFrame()",
    "    EnableDeviceEmulation(\n"
    "        params, mojom::blink::DeviceEmulationCacheBehavior::kClearCache);\n"
    "    View()->GetDevToolsEmulator()->SetTouchEventEmulationEnabled(\n"
    "        true, proteus.mobile_max_touch_points);\n",
)
if _early in _text:
    _widget.write_text(_text.replace(_early, ""), encoding="utf-8", newline="\n")
    print("removed the early hook")

VIEW = BLINK + "core/exported/web_view_impl.cc"
ATTACH_END = (
    "      local_frame->View()->InitializeRootScroller();\n"
    "    }\n"
    "  }\n"
)
# A second revision did it directly when the main frame attached, which can be
# before the frame has a document (another crash).
_view = SRC / VIEW
_text = _view.read_text(encoding="utf-8")
_direct = "\n" + EMULATION % (
    "does_composite_",
    "    MainFrameImpl()->FrameWidgetImpl()->EnableDeviceEmulation(\n"
    "        params, mojom::blink::DeviceEmulationCacheBehavior::kClearCache);\n"
    "    dev_tools_emulator_->SetTouchEventEmulationEnabled(\n"
    "        true, proteus.mobile_max_touch_points);\n",
)
if _direct in _text:
    _view.write_text(_text.replace(_direct, ""), encoding="utf-8", newline="\n")
    print("removed the direct hook")

# A third revision used two names this version of the code does not offer.
_text = _view.read_text(encoding="utf-8")
_fixed = _text.replace(
    "WebViewImpl::FromPage(frame->GetPage())",
    "frame->GetPage()->GetChromeClient().GetWebView()",
).replace(
    "    view->MainFrameImpl()->FrameWidgetImpl()->EnableDeviceEmulation(\n"
    "        params, mojom::blink::DeviceEmulationCacheBehavior::kClearCache);\n",
    "    view->EnableDeviceEmulation(params);\n",
)
# A fourth left the page's viewport tag, overlay scrollbars and text sizing desktop-like.
_ORIENTATION = (
    "    params.screen_orientation_type =\n"
    "        display::mojom::ScreenOrientation::kPortraitPrimary;\n"
)
if "params.force_viewport_meta" not in _fixed:
    _fixed = _fixed.replace(
        _ORIENTATION,
        _ORIENTATION
        + "    params.force_viewport_meta = true;\n"
        "    params.force_android_overlay_scrollbar = true;\n"
        "    params.force_text_size_adjust = true;\n",
    )
if _fixed != _text:
    _view.write_text(_fixed, encoding="utf-8", newline="\n")
    print("corrected the helper")

# Done in a task posted when the main frame attaches. By the time it runs the frame
# has its document, its widget is composited and its channel to the browser is open.
ATTACH_HEAD = "void WebViewImpl::DidAttachLocalMainFrame() {\n"
edit(
    VIEW,
    ATTACH_HEAD,
    "// Proteus: turns on phone emulation for |frame| if it is still the main frame\n"
    "// of a live page.\n"
    "static void ProteusApplyMobileEmulation(LocalFrame* frame) {\n"
    "  if (!frame || !frame->GetPage() || !frame->DomWindow() ||\n"
    "      !frame->IsOutermostMainFrame()) {\n"
    "    return;\n"
    "  }\n"
    "  WebViewImpl* view = frame->GetPage()->GetChromeClient().GetWebView();\n"
    "  if (!view || !view->MainFrameImpl() ||\n"
    "      view->MainFrameImpl()->GetFrame() != frame ||\n"
    "      !view->MainFrameImpl()->FrameWidgetImpl()) {\n"
    "    return;\n"
    "  }\n"
    + EMULATION
    % (
        "view->does_composite()",
        "    view->EnableDeviceEmulation(params);\n"
        "    view->GetDevToolsEmulator()->SetTouchEventEmulationEnabled(\n"
        "        true, proteus.mobile_max_touch_points);\n",
    )
    + "}\n\n"
    + ATTACH_HEAD,
)
edit(
    VIEW,
    ATTACH_END + "}\n",
    ATTACH_END
    + "\n"
    "  if (base::proteus::GetConfig().mobile) {\n"
    "    local_frame->GetTaskRunner(TaskType::kInternalDefault)\n"
    "        ->PostTask(FROM_HERE, BindOnce(&ProteusApplyMobileEmulation,\n"
    "                                       WrapWeakPersistent(local_frame)));\n"
    "  }\n"
    "}\n",
)
edit(
    VIEW,
    '#include "third_party/blink/renderer/core/exported/web_view_impl.h"\n',
    '#include "third_party/blink/renderer/core/exported/web_view_impl.h"\n\n'
    + PROTEUS_INCLUDE
    + '#include "third_party/blink/public/common/widget/device_emulation_params.h"\n',
)

# 2. Phones have no PDF viewer plugin: navigator.plugins and mimeTypes are empty and
#    pdfViewerEnabled is false.
PLUGINS = BLINK + "modules/plugins/dom_plugin_array.cc"
edit(
    PLUGINS,
    "bool DOMPluginArray::IsPdfViewerAvailable() {\n",
    "bool DOMPluginArray::IsPdfViewerAvailable() {\n"
    "  if (base::proteus::GetConfig().mobile) {\n"
    "    return false;\n"
    "  }\n",
)
edit(
    PLUGINS,
    '#include "third_party/blink/renderer/modules/plugins/dom_plugin_array.h"\n',
    '#include "third_party/blink/renderer/modules/plugins/dom_plugin_array.h"\n\n' + PROTEUS_INCLUDE,
)
