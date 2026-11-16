"""Applies the in-place edits of patch 0025 to a Chromium checkout: the browser calls
itself Proteus.
usage: 0025_product_name.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])


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


# 1. The name in the interface, in every language.
#
#    Chromium's strings name the product in several hundred sentences, each with
#    translations that are found by a number computed from the English sentence.
#    Rewording the English would orphan every translation. So the sentences stay as
#    they are and the name is exchanged where a string is written out, after it has
#    been translated: translations spell the name in Latin letters in nearly every
#    language, and the few that do not keep saying Chromium.
#
#    Left alone: "The Chromium Authors" (they hold the copyright), ChromiumOS and
#    Chromium OS (another product), chromium.org, and "the Chromium open source
#    project" in the credits, which is what Proteus is built on.
MESSAGE = "tools/grit/grit/node/message.py"
edit(
    MESSAGE,
    "    message = self.ws_at_start + self.Translate(lang, gender) + self.ws_at_end\n"
    "    return util.Encode(message, encoding)\n",
    "    message = self.ws_at_start + self.Translate(lang, gender) + self.ws_at_end\n"
    "    message = _PROTEUS_PRODUCT_NAME.sub('Proteus', message)\n"
    "    return util.Encode(message, encoding)\n",
)
edit(
    MESSAGE,
    "class MessageNode(",
    "# Proteus: see GetDataPackValue().\n"
    "_PROTEUS_PRODUCT_NAME = re.compile(\n"
    "    r'Chromium(?!OS| OS| Authors|\\.org| open source|</a> open source)')\n"
    "\n"
    "\n"
    "class MessageNode(",
)
_message = SRC / MESSAGE
_text = _message.read_text(encoding="utf-8")
if "\nimport re\n" not in _text:
    edit(MESSAGE, "\nimport ", "\nimport re\nimport ")

# 2. The name Windows shows for the program file (Task Manager, file properties,
#    the taskbar): it comes from the branding file.
BRANDING = "chrome/app/theme/chromium/BRANDING"
edit(BRANDING, "PRODUCT_FULLNAME=Chromium\n", "PRODUCT_FULLNAME=Proteus\n")
edit(BRANDING, "PRODUCT_SHORTNAME=Chromium\n", "PRODUCT_SHORTNAME=Proteus\n")
