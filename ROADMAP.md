# Roadmap

What is being worked on, in order, and what is done. An item is ticked when it is
built, tested and committed, not when it is started. Items are added as real use
shows what is missing; the ones marked *(needs)* wait for something outside the code.

## 1. Proxies you can rely on

A profile is only as good as its proxy, and proxies are where real use differs most
from tests.

- [x] Survive a residential proxy: time limits, several lookup services, retries, IPv4 for WebRTC
- [x] Check a proxy before using it: where it comes out, how fast, from the UI, the API and MCP
- [x] SOCKS5 against a real provider
- [x] A long session: what happens when the exit changes or goes away while browsing
- [x] The exit address of every profile, running or stopped, in the interface, the API and MCP
- [x] A start that does not wait for an exit already seen twice

## 2. Managing many profiles

- [x] Edit a profile from the interface (name, proxy, place, start page)
- [x] Duplicate a profile
- [x] Create many at once, each with its own identity and its own proxy from a list
- [x] Cookies in the interface: export a profile's, import a session into it
- [x] Tags, and filtering by them
- [x] Ready-made setups to choose from: common laptops, desktops and phones
- [x] One shape for a profile's state in every API and MCP reply
- [x] A report of the TLS and HTTP/2 shape a profile's browser makes, beside the version it claims

## 3. Proof that it works

- [x] The whole kernel test suite and the end-to-end test on Linux, on the current kernel
- [ ] The Linux sandbox helper's install step, run for real *(needs: leave to change AppArmor on a test machine)*
- [x] A check of the public detection sites that judges every verdict, to run by hand or from a scheduler, so a regression is noticed
- [ ] Windows 10, macOS hosts *(needs: machines)*
- [x] A check that Puppeteer and Playwright, driving a profile, leave nothing a page can tell them by
- [x] The same for Selenium: a driver program built with the kernel, which leaves none of the names the stock one does

## 4. A kernel that gives less away

- [x] Media devices: the number, kind and names of cameras, microphones and speakers from the profile
- [x] Generated Windows and Mac identities with a graphics card's real capabilities, from published readings of real browsers
- [ ] The same for Linux and for phones *(needs: readings; the published ones have none complete)*
- [x] Screens from readings, each with the pixel ratio it was read at, and the browser started at that ratio
- [ ] Card, screen, memory and fonts from one reading, so an identity is one computer's and not a plausible mix *(needs: whole readings; the published model keeps them apart)*
- [x] An iPhone profile without what Safari was read not to have, and an Android one without what a phone's Chrome was read not to have
- [x] The members of every interface, not only the most looked-at: the configuration reaches the kernel's child processes deflated, so there is room for all of them
- [x] Static members, constants, and what a browser has in a page and not in a worker: read back, an Android profile has nothing its phone lacks and an iPhone profile four things nothing can remove
- [x] One screen, whatever the machine has; a Mac's work area below its menu bar
- [x] A camera picture from a video file instead of the machine's camera, with a silent microphone
- [x] Battery and network information that fit the claimed device
- [x] A phone profile's voices as its browser was read to list them: 92 from Chrome on a Galaxy, 68 from Safari on an iPhone, same names, languages and order
- [x] A voice's address (`voiceURI`) from the profile, as Safari's is not its name, and an empty first answer followed by the event, as Chrome on a phone gives
- [x] A memory value its browser can report, fitting the processor, and checked when set by hand
- [x] A TLS hello like stock Chrome's: without the experiment a Chromium build adds to it
- [x] Safari's TLS and HTTP/2 shape for iPhone profiles, as recorded from an iPhone (not over HTTP/3, which they do not use)
- [x] The machine's languages saved in the profile at its first start, so it is the same profile on another computer
- [ ] The TLS handshake of a non-Chrome identity *(large: another network stack's fingerprint)*
- [ ] A Firefox kernel *(large: a second engine)*

## 5. Shipping

- [x] Preview bundles for Windows and Linux that run as they are
- [x] An optimised "official" build in the bundles (`make-release.ps1 <version> -Official`): link-time optimisation, without profile-guided optimisation, which needs Google's profiles of its own builds
- [x] An installer in the Windows bundle: a copy under the user's programs, shortcuts, an entry to remove it (no administrator rights)
- [ ] A signed one *(needs: a code-signing certificate)*
- [x] "Is there a newer version?", asked of GitHub when the user asks
- [x] Fetching and putting in place the newer version from inside the app: asked for at each start, fetched when the user says so, checked against the release's checksums
- [ ] Releases that are signed, so that an update shows who made it and not only that it arrived whole — the signing and the check are written and tested (an Ed25519 signature of the list of checksums; `release/sign-release.mjs`, `manager/src/releaseKey.ts`). Left: make the key and put its public half in the manager *(the maker's to do: the key is theirs to keep)*
- [x] Release builds made by one command on the build server (`release/make-release.ps1`)

## 6. No limitation left in the README

The goal: every entry under [Limitations](README.md#limitations) removed because it
stopped being true, not reworded. One item per entry, with what removing it takes;
an entry is struck from the README in the commit that ticks its item here.

- [ ] **Chromium underneath** — HTTP/3 for the profiles whose browser uses it, first; the engine itself is the Firefox and WebKit items of section 4 *(large; a WebKit engine on Windows and Linux may never be ours to ship)*
- [x] **One kernel, two handshakes** — settled the other way round: instead of a handshake for each Chrome version a profile might claim, a Chrome profile cannot claim another version than its kernel's. It is moved to the kernel's when it starts (kernelVersion.ts), so claim and handshake are one version; Safari's one measured handshake is said under "Chromium underneath"
- [ ] **An identity put together** — card, screen, memory and fonts from one reading (the item in section 4), from readings of our own if the published ones stay apart *(needs: whole readings)*
- [ ] **Linux identities without a card's capabilities** — complete Linux readings *(needs: readings)*
- [ ] **A phone profile, as far as removing goes** — removing is done but for four names nothing can remove from outside (`Symbol.dispose` and `asyncDispose`, which a switch of the JavaScript engine would take away together with what Safari does have; `PERSISTENT` and `TEMPORARY` of a page's global object, fixed when the kernel is built). Adding, for Android: done but for three members (`hrefTranslate`, which needs a translating service that calls home, and two that Chrome 158 on the phone has and the kernel's does not yet). Left: the 99 names of Safari's, as objects that answer the way Safari's do; `navigator.gpu` described from the profile
- [ ] **The second screen** — two paths did show the machine's, found on a machine with three screens: `getScreenDetails()` listed all of them with their monitors' names, and a window on another screen was at a place its one screen does not have, as were the clicks in it. Edit 0033 gives the list the profile's one screen and keeps the window and the pointer inside it; it builds and the kernel's tests pass on Linux, which has one screen. Left: read it back on the machine with three, then strike the entry
- [ ] **A window at the profile's scale** — done in edit 0035: pages are laid out at the profile's ratio and the window is drawn at the machine's; a page reads what a browser really started at that ratio reads (118 checks at 1.25, 1.5 and 2 on the Linux build; the bars' thickness within a pixel). The size asked for a new window, `moveTo` and `resizeTo` are turned into the machine's units too (edit 0039; built, not exercised by a test). Left: read all of it back on Windows; a wheel's step, which the test does not make
- [ ] **A limit above the machine's** — done for every WebGL limit a profile claims below the machine's (edits 0034 and 0037: sizes and counts, and in the graphics process the shader compiler's uniforms, varyings and samplers). Left, and perhaps for good: a limit claimed above the machine's cannot be given, and claimed memory is not a limit a real machine refuses at either
- [ ] **One thing from the machine** — fonts: done, the stand-ins come with Proteus and are the same on every machine (edit 0038, `release/fonts.txt`). Left: graphics limits always from a reading, for the profiles that have none *(needs: readings for Linux and phones)*
- [ ] **Stand-in fonts** — done where the licences allow: Android's own fonts are shipped and drawn as themselves, and six of Windows' and Apple's are drawn with fonts of the same measures. Left, and for good unless licences change: the letters themselves of Windows' and Apple's fonts *(they cannot be redistributed)*; Android's Chinese and Korean faces (Japanese stands in)
- [ ] **One picture for every camera** — done: a covered lens by default (manager), offered in a camera's sizes and without pan, tilt or zoom (edit 0036). Left: the size list of the claimed camera itself *(needs: readings of cameras)*, a picture of its own for each camera a phone lists, sizes for a `.mjpeg` video
- [ ] **Tested on few machines** — Windows 10, Windows Server, macOS and more Linux hosts in the site check *(needs: machines; Windows Server 2022 was run once, by hand)*
- [ ] **No protection is complete** — stays: address reputation, behaviour and account history are not a browser's to control. The entry is kept and says only that.

## Done before this list existed

Kernel patches 0001–0025 (0026 and 0027 are the two items ticked in section 4) (identity, hardware, graphics and their capabilities, canvas,
WebGL and audio noise, fonts, locale, WebRTC, geolocation, voices, phone profiles,
Safari-on-iPhone profiles, the Proteus name and icon); the manager with its
interface, API and MCP endpoint; device readings from real hardware; the website with
its browser test; automated manager tests on every push.
