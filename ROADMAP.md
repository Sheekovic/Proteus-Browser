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
- [ ] The same for Selenium *(needs: a driver program of the kernel's version)*

## 4. A kernel that gives less away

- [x] Media devices: the number, kind and names of cameras, microphones and speakers from the profile
- [x] Generated Windows and Mac identities with a graphics card's real capabilities, from published readings of real browsers
- [ ] The same for Linux and for phones *(needs: readings; the published ones have none complete)*
- [x] Screens from readings, each with the pixel ratio it was read at, and the browser started at that ratio
- [ ] Card, screen, memory and fonts from one reading, so an identity is one computer's and not a plausible mix *(needs: whole readings; the published model keeps them apart)*
- [x] An iPhone profile without what Safari was read not to have, and an Android one without what a phone's Chrome was read not to have
- [ ] The members of every interface, not only the most looked-at *(needs: a smaller way to tell the kernel, or more room)*
- [ ] The Android list from a phone whose Chrome is the kernel's version *(needs: the page opened on such a phone)*
- [x] One screen, whatever the machine has; a Mac's work area below its menu bar
- [x] A camera picture from a video file instead of the machine's camera, with a silent microphone
- [x] Battery and network information that fit the claimed device
- [x] A memory value its browser can report, fitting the processor, and checked when set by hand
- [x] A TLS hello like stock Chrome's: without the experiment a Chromium build adds to it
- [x] Safari's TLS and HTTP/2 shape for iPhone profiles, as recorded from an iPhone (not over HTTP/3, which they do not use)
- [x] The machine's languages saved in the profile at its first start, so it is the same profile on another computer
- [ ] The TLS handshake of a non-Chrome identity *(large: another network stack's fingerprint)*
- [ ] A Firefox kernel *(large: a second engine)*

## 5. Shipping

- [x] Preview bundles for Windows and Linux that run as they are
- [ ] An optimised "official" build *(in progress: `server-build.sh <target> ... official` builds it next to the fast one)*
- [x] An installer in the Windows bundle: a copy under the user's programs, shortcuts, an entry to remove it (no administrator rights)
- [ ] A signed one *(needs: a code-signing certificate)*
- [x] "Is there a newer version?", asked of GitHub when the user asks
- [ ] Fetching and putting in place the newer version from inside the app
- [x] Release builds made by one command on the build server (`release/make-release.ps1`)

## Done before this list existed

Kernel patches 0001–0025 (0026 and 0027 are the two items ticked in section 4) (identity, hardware, graphics and their capabilities, canvas,
WebGL and audio noise, fonts, locale, WebRTC, geolocation, voices, phone profiles,
Safari-on-iPhone profiles, the Proteus name and icon); the manager with its
interface, API and MCP endpoint; device readings from real hardware; the website with
its browser test; automated manager tests on every push.
