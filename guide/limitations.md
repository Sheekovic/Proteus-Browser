<sub>[← Proteus](../README.md) · [The API](api.md) · [Automation](automation.md) · [Updates](updates.md) · [Limitations](limitations.md)</sub>

# Limitations

Worth knowing before relying on it:

- **It is Chromium underneath.** An iPhone profile reports Safari's identity and
  lacks what Safari lacks, and its TLS and HTTP/2 handshake is Safari's, but a site
  that probes engine behaviour can still tell it is not WebKit. The handshake is that
  of the one Safari that was measured, and such a profile does not use HTTP/3. There
  is no Firefox kernel. (A Chrome profile always claims the Chrome its kernel is: one
  made for another kernel is moved to this one when it starts, so what it says and how
  it shakes hands are the same version.)
- **A generated identity is put together, not copied from one computer.** A new
  Windows or Mac identity takes a graphics card that Chrome reported on a real
  computer, with that card's own WebGL limits, extensions, shader precision and WebGPU
  names, and a processor it was seen with (178 cards on Windows, 16 Apple chips). Its
  screen is one that was read as well, with its work area, colour depth and pixel ratio
  (22 on Windows, 37 on a Mac, 22 on Linux). But card and screen are drawn each on its
  own, and the memory and the fonts are chosen from what is common, so the whole is a
  plausible computer, not a record of one; a profile made from a device's own reading
  is. A Linux identity still names a card without its capabilities and reports the
  machine's own: the readings have none complete for Linux.
- **A phone profile has what its browser was read to have, as far as removing goes.**
  The kernel is desktop Chrome. What it offers a page was compared, name by name, with
  what Safari on an iPhone 17 Pro Max and Chrome on a Galaxy offer
  ([`read-surface.mjs`](../manager/tools/read-surface.mjs) serves the page that reads it).
  An iPhone profile hides everything Safari was read not to have: the 291 members of
  the global object (`EyeDropper`, `Notification`, `requestIdleCallback`, WebUSB,
  WebXR, …; all but `MediaSource` and its buffers, kept so that video in pieces still
  plays), what Safari has in a page and not in a worker or the other way round, the
  423 members of 117 interfaces, their static members and their constants. Read back
  on the kernel, four are left that nothing can remove from outside: `Symbol.dispose`
  and `Symbol.asyncDispose`, and the constants `PERSISTENT` and `TEMPORARY` of a
  page's global object. The other side, what Safari has and the kernel lacks, a page
  is given as far as a name goes: of the 99 names (`ApplePaySession`, `GestureEvent`,
  …) the profile has 96, each an interface with the members, constants and parent it
  was read to have on the phone, a function or an event handler, and none of them
  does anything: there are no objects of these interfaces, and they answer only the
  question whether they are there. Three are objects that are simply there in Safari
  and cannot be made up (`browser`, `openDatabase`, `pushManager`). Some 225 members
  of interfaces both browsers have are still missing, since one that did nothing
  would mislead a page that uses it; and `navigator.gpu` is hidden although Safari
  has it, because the kernel's would describe this machine's graphics card. An Android
  profile was compared with a Galaxy's Chrome before and after an update (152 and
  158, one older and one newer than the kernel) and hides what neither has (window
  sharing, local fonts, the built-in language models, …), with `navigator.contacts`,
  `NDEFReader`, `BarcodeDetector` and the like switched on. Read back on the kernel
  it has nothing the phone's Chrome 158 lacks, in a page or in a worker, and of the
  members the phone has, three are missing: a link's `hrefTranslate`, which waits for
  a translating service a profile's browser does not start, and two members of a
  resource's timing that the kernel's version of Chrome does not have yet. (The
  others the phone has and a desktop Chrome keeps switched off are switched on: a
  file field's `capture`, `navigator.globalPrivacyControl`, and the like.)
- **A window's frame is this machine's.** How thick the bars around the page are
  (the window's size less the page's) is what this machine's windows have, whatever
  system the profile claims; a Mac's or a Linux desktop's are not known and not
  imitated. A profile run without a window (`--headless=new` among the extra launch
  arguments) has the bars a window on Windows has: read in a window and without one,
  the same profile agreed in every one of thirty things a page reads, the browser's
  name, plugins, permissions, graphics card and voices among them.
- **A phone's screen colours are this machine's.** Whether the screen shows the P3
  gamut and a high dynamic range follows the claimed system for a computer and an
  iPhone (a Windows or Linux computer neither, a Mac P3, an iPhone both); for an
  Android phone nothing was read, and a page gets what the monitor has.
- **A profile's page has the profile's scale, its window the machine's.** A screen
  comes with the pixel ratio it was read at (1536 by 864 is a 1920 by 1080 panel at
  125%, a Mac's is 2). Pages are laid out at that ratio, so that everything a page
  measures agrees with it, while the window and its bars are drawn at your monitor's
  own scale. Nothing is resampled: on a monitor at another scale a page's text is
  smaller or larger than in your other programs, as it would be on the profile's
  screen. Read back on Windows, on a monitor at 150% with two more beside it, a
  profile at 100%, 125% and 200% agreed with a browser really started at that scale
  in everything a page measures. What does not come out to the pixel: a window can
  only be as large as whole units of the machine allow, so a size a page asks of a
  window (`resizeTo`, a new window's size) may read back a pixel or two off, and a
  click a driving program places lands within a pixel of where it aimed. A profile
  made before this has no ratio and uses the machine's.
- **A limit above the machine's is the machine's.** What goes beyond a WebGL limit
  of the profile's card is refused as that card refuses it, where the drawing is
  done: a texture or renderbuffer too large, a canvas wider than it can draw, and a
  shader that uses more uniforms, varyings or samplers than it has. A limit the
  profile claims above the machine's own is the machine's when tried, and the memory
  a profile claims is a number: a page that allocates gets what the machine has.
- **One thing still comes from the machine a profile runs on.** A profile without a
  device reading reports the machine's graphics limits (above). Moved to another
  computer, a profile keeps everything else.
- **Some fonts of another system are stand-ins.** A profile of a system other than
  the machine's own claims that system's fonts and hides the machine's. Android's
  fonts come with Proteus (Roboto, Noto Sans and Serif, the emoji, Droid Sans Mono and
  the rest: they may be passed on), so an Android profile draws them as a phone does,
  and draws the names Android only answers to (Arial, Times New Roman, …) with the
  faces Android uses. Windows' and Apple's fonts may not be passed on. Six of them
  are drawn with fonts made to have their measures, so text breaks its lines where
  the real one does though the letters differ (Arial and Helvetica as Arimo, Times
  New Roman as Tinos, Courier New as Cousine, Calibri as Carlito, Cambria as Caladea,
  Georgia as Gelasio); the others with a font of their kind, the same on every
  machine. A page finds every name; careful measurement of the glyphs can tell such a
  stand-in from the real font. Japanese stands in for all of Android's Chinese,
  Japanese and Korean. Read back on Windows and on Linux, an Android profile finds
  every one of Android's fonts and they measure the same on both. Without the `fonts`
  folder (running from the repository, or a release updated from one that had none)
  the stand-ins are fonts of the machine.
- **A profile's cameras show one picture.** A covered lens, or a `.y4m` video, is
  offered in the sizes a camera has (up to 1280 by 720 on a computer, 1920 by 1080 on
  a phone), cut and scaled from the one picture; that list is the same for every
  profile and not the claimed camera's own, a `.mjpeg` video has its one size, and
  every camera a profile lists shows the same picture. A profile set to use the
  machine's camera gives this machine's picture and sound and the sizes its hardware
  offers.
- **Tested on few machines.** Results on detection sites depend on the host; what
  holds on one Windows 11 machine is not a guarantee elsewhere.
- **No protection is complete.** Sites combine many signals — address reputation,
  behaviour, account history — that no browser controls.
