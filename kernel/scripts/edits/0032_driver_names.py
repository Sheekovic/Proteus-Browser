"""Applies the in-place edits of patch 0032 to a Chromium checkout: the WebDriver driver
program built with the kernel (chromedriver, what Selenium drives a browser with)
leaves no names on the pages it drives.

Stock chromedriver keeps copies of Array, Object, Promise, Proxy, Symbol, JSON and
Window on every page under fixed names ("cdc_adoQpoasnfa76pfcZLmcfl_Array", ...), in
case the page replaces the originals. A page finds those seven names by looking, which
is how sites tell the driver is there. The driver's own scripts already use the page's
originals when the copies are missing, so the copies are simply not made.
usage: 0032_driver_names.py <chromium-src-dir>"""
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])
CLIENT = "chrome/test/chromedriver/chrome/devtools_client_impl.cc"


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


edit(
    CLIENT,
    "    // This is a page or frame level DevToolsClient\n"
    "    base::DictValue params;\n"
    "    std::string script =\n"
    '        "(function () {"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Array = window.Array;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Object = window.Object;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Promise = window.Promise;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy = window.Proxy;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol = window.Symbol;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_JSON = window.JSON;"\n'
    '        "window.cdc_adoQpoasnfa76pfcZLmcfl_Window = window.Window;"\n'
    '        "}) ();";\n'
    '    params.Set("source", script);\n'
    "    Status status = SendCommandAndIgnoreResponse(\n"
    '        "Page.addScriptToEvaluateOnNewDocument", params);\n'
    "    if (status.IsError())\n"
    "      return status;\n"
    "\n"
    "    params.clear();\n"
    '    params.Set("expression", script);\n'
    '    status = SendCommandAndIgnoreResponse("Runtime.evaluate", params);\n'
    "    if (status.IsError())\n"
    "      return status;\n"
    "  }\n",
    "    // Proteus: stock chromedriver keeps copies of Array, Object, Promise, Proxy,\n"
    "    // Symbol, JSON and Window on the page here, under fixed names a page can\n"
    '    // look for ("cdc_..."). They are not made: the scripts in js/ use the page\'s\n'
    "    // own when the copies are missing.\n"
    "  }\n",
)
