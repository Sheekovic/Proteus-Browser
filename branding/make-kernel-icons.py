"""Renders the Proteus icon into the files the kernel takes its own icon from, at the
sizes Chromium keeps them in, under kernel/src (which mirrors Chromium's tree and is
copied over it before a build).

Rendering is done by a Chromium-based browser in headless mode, so the small sizes
are drawn from the vector original rather than scaled down from a large picture.

usage: make-kernel-icons.py <chrome executable>
needs: Pillow
"""
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

CHROME = sys.argv[1]
ROOT = pathlib.Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"
THEME = ROOT / "kernel" / "src" / "chrome" / "app" / "theme"
WORK = pathlib.Path(tempfile.mkdtemp())

ICON = (BRANDING / "proteus-icon.svg").read_text(encoding="utf-8")
PATH = ('<path d="M148 404 V196 C148 132 198 104 252 104 C324 104 368 152 368 212 C368 276 320 318 262 318 '
        'C218 318 192 290 192 256 C192 228 214 208 240 208 C262 208 276 224 276 242" fill="none" '
        'stroke="%s" stroke-width="%d" stroke-linecap="round" stroke-linejoin="round"/>')
# One colour, no tile: for places that tint the icon themselves.
MONO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 68 320 376">' + PATH % ("#ffffff", 60) + "</svg>"
# The icon on a transparent square with room around it, as Windows' tiles expect.
TILE = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-128 -128 768 768">'
        + ICON[ICON.index("<defs>"):ICON.rindex("</svg>")] + "</svg>")
LOGO = (BRANDING / "proteus-logo.svg").read_text(encoding="utf-8")
LOGO_WHITE = (BRANDING / "proteus-logo-dark.svg").read_text(encoding="utf-8")


def render(svg, width, height):
    """The picture of `svg` drawn at width x height pixels, with transparency."""
    (WORK / "art.svg").write_text(svg, encoding="utf-8")
    (WORK / "page.html").write_text(
        '<!doctype html><html><body style="margin:0;background:transparent">'
        '<img src="art.svg" width="%d" height="%d" style="display:block"></body></html>' % (width, height),
        encoding="utf-8")
    out = WORK / "shot.png"
    # Windows refuses to make a browser window narrower than a few hundred pixels, so
    # the picture is taken from the corner of a larger one.
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
                    "--user-data-dir=%s" % (WORK / "profile"), "--force-device-scale-factor=1",
                    "--default-background-color=00000000", "--window-size=%d,%d" % (max(width, 600), max(height, 600)),
                    "--screenshot=%s" % out, (WORK / "page.html").as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Image.open(out).convert("RGBA").crop((0, 0, width, height))


def save(svg, size, relative):
    width, height = size if isinstance(size, tuple) else (size, size)
    target = THEME / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    render(svg, width, height).save(target, optimize=True)
    print(relative)


def xpm(image, name):
    """`image` as an X pixmap: at most 62 colours, fully transparent or opaque."""
    opaque = image.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
    palette = image.convert("RGB").quantize(colors=61)
    colours = palette.getpalette()
    symbols = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    used = sorted(set(palette.getdata()))
    lines = ['"%d %d %d 1"' % (image.width, image.height, len(used) + 1), '"  c None"']
    for index in used:
        lines.append('"%s c #%02x%02x%02x"' % (symbols[index], *colours[index * 3:index * 3 + 3]))
    pixels, alpha = palette.load(), opaque.load()
    for y in range(image.height):
        lines.append('"%s"' % "".join(symbols[pixels[x, y]] if alpha[x, y] else " " for x in range(image.width)))
    return "/* XPM */\nstatic char * %s[] = {\n%s\n};\n" % (name, ",\n".join(lines))


for size in (16, 24, 48, 64, 128, 256):
    save(ICON, size, "chromium/product_logo_%d.png" % size)
save(MONO, 22, "chromium/product_logo_22_mono.png")
for size in (24, 48, 64, 128, 256):
    save(ICON, size, "chromium/linux/product_logo_%d.png" % size)
# 100% and 200% resources: the second holds pictures twice the named size.
for scale, folder in ((1, "default_100_percent"), (2, "default_200_percent")):
    for size in (16, 32):
        save(ICON, size * scale, "%s/chromium/product_logo_%d.png" % (folder, size))
    save(LOGO, (97 * scale, 22 * scale), "%s/chromium/product_logo_name_22.png" % folder)
    save(LOGO_WHITE, (97 * scale, 22 * scale), "%s/chromium/product_logo_name_22_white.png" % folder)
for size in (16, 32):
    save(ICON, size, "default_100_percent/chromium/linux/product_logo_%d.png" % size)
save(TILE, 600, "chromium/win/tiles/Logo.png")
save(TILE, 176, "chromium/win/tiles/SmallLogo.png")

(THEME / "chromium" / "product_logo.svg").write_text(ICON, encoding="utf-8", newline="\n")
print("chromium/product_logo.svg")
(THEME / "chromium" / "linux" / "product_logo_32.xpm").write_text(
    xpm(render(ICON, 32, 32), "linux_icon_chromium_32_xpm"), encoding="utf-8", newline="\n")
print("chromium/linux/product_logo_32.xpm")

# Windows: the executable's icon, at every size Windows asks for.
sizes = [16, 24, 32, 48, 64, 128, 256]
pictures = [render(ICON, size, size) for size in sizes]
pictures[-1].save(THEME / "chromium" / "win" / "chromium.ico", format="ICO",
                  sizes=[(size, size) for size in sizes], append_images=pictures[:-1])
print("chromium/win/chromium.ico")
