"""Applies the in-place edits of patch 0018 to a Chromium checkout: a spoofed WebGL
vendor or renderer costs what a real one does.
usage: 0018_webgl_timing.py <chromium-src-dir>"""
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


# An unmodified browser asks the GPU process for these strings on every call, which
# takes tens of microseconds. Answering from the profile alone is a hundred times
# faster, and a page can tell by calling it in a loop (detection sites do). So ask
# anyway and discard the answer.
for gl_name, field in (("GL_RENDERER", "webgl_renderer"), ("GL_VENDOR", "webgl_vendor")):
    head = (
        "        if (const std::string& forced =\n"
        "                base::proteus::GetConfig().%s;\n"
        "            !forced.empty()) {\n" % field
    )
    edit(WEBGL, head, head + "          ContextGL()->GetString(%s);\n" % gl_name)
