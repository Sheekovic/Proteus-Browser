"""Applies the in-place edits of patch 0022 to a Chromium checkout: profiles of a
browser from another vendor (navigator.vendor, members that browser lacks, no client
hints, no window.chrome).
usage: 0022_foreign_browser.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
BLINK = "third_party/blink/renderer/"
PROTEUS_INCLUDE = '#include "base/proteus/proteus_config.h"\n'


def edit(rel, old, new, unless=None):
    """Replaces |old| with |new|. |unless| is text a later edit in this script leaves
    in place of |new|; finding it also means this edit has been made."""
    path = SRC / rel
    text = path.read_text(encoding="utf-8")
    if new in text or (unless and unless in text):
        print("already applied:", rel)
        return
    if text.count(old) != 1:
        sys.exit("anchor not found exactly once in %s: %r" % (rel, old))
    path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
    print("edited:", rel)


def include(rel, own_header):
    line = '#include "%s"\n' % own_header
    edit(rel, line, line + "\n" + PROTEUS_INCLUDE)


# 1. navigator.vendor.
NAVIGATOR_ID = BLINK + "core/frame/navigator_id.cc"
edit(
    NAVIGATOR_ID,
    '  return "Google Inc.";\n',
    "  if (const std::string& vendor = base::proteus::GetConfig().vendor;\n"
    "      !vendor.empty()) {\n"
    "    return String::FromUtf8(vendor);\n"
    "  }\n"
    '  return "Google Inc.";\n',
)
include(NAVIGATOR_ID, BLINK + "core/frame/navigator_id.h")

# 2. Members the profile's browser does not have are removed from their interface as
#    soon as a script context exists, before any page script can look: afterwards
#    nothing tells them from members that were never there.
HIDE = (
    "// Proteus: removes the members the profile's browser does not have.\n"
    "static void %s(v8::Isolate* isolate,\n"
    "    v8::Local<v8::Context> context) {\n"
    "  const auto& hidden = base::proteus::GetConfig().hidden_members;\n"
    "  if (hidden.empty()) {\n"
    "    return;\n"
    "  }\n"
    "  v8::HandleScope handle_scope(isolate);\n"
    "  v8::Context::Scope context_scope(context);\n"
    "  v8::TryCatch try_catch(isolate);\n"
    "  v8::Local<v8::String> prototype_key =\n"
    '      v8::String::NewFromUtf8Literal(isolate, "prototype");\n'
    "  for (const auto& entry : hidden) {\n"
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
    "}\n\n"
)

WINDOW_PROXY = BLINK + "bindings/core/v8/local_window_proxy.cc"
edit(
    WINDOW_PROXY,
    "void LocalWindowProxy::Initialize() {\n",
    HIDE % "ProteusHideWindowMembers" + "void LocalWindowProxy::Initialize() {\n",
)
edit(
    WINDOW_PROXY,
    "  InstallConditionalFeatures();\n\n  if (World().IsMainWorld()) {\n",
    "  InstallConditionalFeatures();\n"
    "  ProteusHideWindowMembers(script_state_->GetIsolate(), context);\n\n"
    "  if (World().IsMainWorld()) {\n",
    unless="ProteusHideWindowMembers(script_state_->GetIsolate(), context);",
)
include(WINDOW_PROXY, BLINK + "bindings/core/v8/local_window_proxy.h")

WORKER = BLINK + "bindings/core/v8/worker_or_worklet_script_controller.cc"
WORKER_INIT = "void WorkerOrWorkletScriptController::Initialize(const KURL& url_for_debugger) {\n"
edit(WORKER, WORKER_INIT, HIDE % "ProteusHideWorkerMembers" + WORKER_INIT)
WORKER_READY = (
    "  isolate_->InstallConditionalFeatures(script_state_->GetContext());\n"
    "  ExtensionsRegistry::GetInstance().InstallExtensions(script_state_);\n"
)
edit(
    WORKER,
    WORKER_READY,
    WORKER_READY + "  ProteusHideWorkerMembers(isolate_, script_state_->GetContext());\n",
)
include(WORKER, BLINK + "bindings/core/v8/worker_or_worklet_script_controller.h")

# 3. window.chrome: the helpers that hang loadTimes() and csi() on it get an object
#    that is not attached to the page.
CHROME_OBJECT = "content/public/renderer/chrome_object_extensions_utils.cc"
edit(
    CHROME_OBJECT,
    '  return GetOrCreateObject(isolate, context, "chrome");\n',
    "  if (!base::proteus::GetConfig().chrome_object) {\n"
    "    return v8::Object::New(isolate);\n"
    "  }\n"
    '  return GetOrCreateObject(isolate, context, "chrome");\n',
    unless="GetConfig().chrome_object",
)
include(CHROME_OBJECT, "content/public/renderer/chrome_object_extensions_utils.h")

# The extension system makes one too, in every context, to hang extension APIs on;
# web pages (which get none of those without an extension that invites them) are
# left without.
BINDINGS = "extensions/renderer/native_extension_bindings_system.cc"
UPDATE = (
    "  v8::Local<v8::Context> v8_context = context->v8_context();\n"
    "  v8::Local<v8::Object> chrome =\n"
    '      GetOrCreateGlobalObjectProperty(v8_context, "chrome");\n'
    "  if (chrome.IsEmpty()) {\n"
    "    return;\n"
    "  }\n"
    "\n"
    "  bool is_webpage = false;\n"
)
edit(
    BINDINGS,
    UPDATE,
    "  if (!base::proteus::GetConfig().chrome_object &&\n"
    "      (context->context_type() == mojom::ContextType::kUnspecified ||\n"
    "       context->context_type() == mojom::ContextType::kWebPage)) {\n"
    "    return;\n"
    "  }\n" + UPDATE,
)
include(BINDINGS, "extensions/renderer/native_extension_bindings_system.h")

# 4. Client hint request headers, on navigations (browser process) and on what pages
#    fetch (renderer).
HINTS = "content/browser/client_hints/client_hints.cc"
SHOULD_ADD = (
    "                          const std::optional<GURL> maybe_request_url) {\n"
    "  url::Origin origin_to_check =\n"
)
edit(
    HINTS,
    SHOULD_ADD,
    "                          const std::optional<GURL> maybe_request_url) {\n"
    "  if (!base::proteus::GetConfig().client_hints) {\n"
    "    return false;\n"
    "  }\n"
    "  url::Origin origin_to_check =\n",
)
include(HINTS, "content/browser/client_hints/client_hints.h")

FETCH = BLINK + "core/loader/frame_fetch_context.cc"
DETACHED = (
    "  if (GetResourceFetcherProperties().IsDetached()) {\n"
    "    return;\n"
    "  }\n"
    "\n"
    "  // If the feature is enabled, then client hints are allowed only on secure\n"
)
edit(
    FETCH,
    DETACHED,
    "  if (!base::proteus::GetConfig().client_hints) {\n"
    "    return;\n"
    "  }\n" + DETACHED,
)
include(FETCH, BLINK + "core/loader/frame_fetch_context.h")

# 6. Phone emulation (patch 0021) is for web pages only. The browser draws its own
#    toolbar and tab strip with pages too (chrome://...), each the main frame of a view
#    of its own; emulating a phone in those leaves the whole window blank. So it is
#    applied when a page commits, by its address, and to a still empty new page only
#    when the page that opened it can look at it.
VIEW = BLINK + "core/exported/web_view_impl.cc"
HELPER_HEAD = (
    "static void ProteusApplyMobileEmulation(LocalFrame* frame) {\n"
    "  if (!frame || !frame->GetPage() || !frame->DomWindow() ||\n"
    "      !frame->IsOutermostMainFrame()) {\n"
    "    return;\n"
    "  }\n"
)
edit(
    VIEW,
    HELPER_HEAD,
    HELPER_HEAD
    + "  const Document* document = frame->GetDocument();\n"
    "  if (!document) {\n"
    "    return;\n"
    "  }\n"
    "  const KURL& url = document->Url();\n"
    '  if (url.ProtocolIs("chrome") || url.ProtocolIs("chrome-untrusted") ||\n'
    '      url.ProtocolIs("chrome-extension") || url.ProtocolIs("chrome-search") ||\n'
    '      url.ProtocolIs("devtools")) {\n'
    "    return;\n"
    "  }\n"
    "  if (document->IsInitialEmptyDocument() && !frame->Opener()) {\n"
    "    return;\n"
    "  }\n",
)
COMMIT = (
    "void WebViewImpl::DidCommitLoad(bool is_new_navigation,\n"
    "                                bool is_navigation_within_page) {\n"
)
edit(
    VIEW,
    COMMIT,
    "static void ProteusApplyMobileEmulation(LocalFrame* frame);\n\n"
    + COMMIT
    + "  if (base::proteus::GetConfig().mobile && !is_navigation_within_page &&\n"
    "      MainFrameImpl()) {\n"
    "    ProteusApplyMobileEmulation(MainFrameImpl()->GetFrame());\n"
    "  }\n",
)

# 7. The browser's own pages (its toolbar is one) are Chrome whatever the profile
#    says: they keep window.chrome, which they are written against, and every
#    Navigator member. Without this the toolbar's script fails and the window stays
#    blank.
edit(
    CHROME_OBJECT,
    "  if (!base::proteus::GetConfig().chrome_object) {\n"
    "    return v8::Object::New(isolate);\n"
    "  }\n",
    "  if (!base::proteus::GetConfig().chrome_object) {\n"
    "    blink::WebLocalFrame* frame =\n"
    "        blink::WebLocalFrame::FrameForContext(context);\n"
    "    const GURL url = frame ? GURL(frame->GetDocument().Url()) : GURL();\n"
    '    if (!url.SchemeIs("chrome") && !url.SchemeIs("chrome-untrusted") &&\n'
    '        !url.SchemeIs("devtools")) {\n'
    "      return v8::Object::New(isolate);\n"
    "    }\n"
    "  }\n",
)
edit(
    CHROME_OBJECT,
    '#include "gin/converter.h"\n',
    '#include "gin/converter.h"\n'
    '#include "third_party/blink/public/web/web_document.h"\n'
    '#include "third_party/blink/public/web/web_local_frame.h"\n'
    '#include "url/gurl.h"\n',
)
edit(
    WINDOW_PROXY,
    "  ProteusHideWindowMembers(script_state_->GetIsolate(), context);\n",
    "  if (const Document* document = GetFrame()->GetDocument();\n"
    '      !document || (!document->Url().ProtocolIs("chrome") &&\n'
    '                    !document->Url().ProtocolIs("chrome-untrusted") &&\n'
    '                    !document->Url().ProtocolIs("devtools"))) {\n'
    "    ProteusHideWindowMembers(script_state_->GetIsolate(), context);\n"
    "  }\n",
)

# 8. An earlier revision of this script scaled a phone's page by the ratio of the
#    window's pixel density to the phone's. That was wrong: the emulation already
#    draws at the window's own density, and the page came out too small.
_view = SRC / VIEW
_text = _view.read_text(encoding="utf-8")
_scaled = (
    "    const float host_scale = view->MainFrameImpl()\n"
    "                                 ->FrameWidgetImpl()\n"
    "                                 ->GetOriginalScreenInfo()\n"
    "                                 .device_scale_factor;\n"
    "    if (host_scale > 0 && params.device_scale_factor > 0) {\n"
    "      params.scale = host_scale / params.device_scale_factor;\n"
    "    }\n"
)
if _scaled in _text:
    _view.write_text(_text.replace(_scaled, ""), encoding="utf-8", newline="\n")
    print("removed the page scale")

# 5. A phone that is not an Android one keeps its PDF viewer plugins.
edit(
    BLINK + "modules/plugins/dom_plugin_array.cc",
    "  if (base::proteus::GetConfig().mobile) {\n    return false;\n  }\n",
    "  if (base::proteus::GetConfig().mobile &&\n"
    "      !base::proteus::GetConfig().mobile_pdf_viewer) {\n"
    "    return false;\n"
    "  }\n",
)
