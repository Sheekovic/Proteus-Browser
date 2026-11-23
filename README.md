<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/proteus-logo-dark.svg">
    <img src="branding/proteus-logo.svg" alt="Proteus" width="420">
  </picture>
</p>

# Proteus

[![Manager tests](https://github.com/Sheekovic/Proteus-Browser/actions/workflows/manager-tests.yml/badge.svg)](https://github.com/Sheekovic/Proteus-Browser/actions/workflows/manager-tests.yml)
[![License: BSD 3-Clause](https://img.shields.io/badge/license-BSD%203--Clause-blue.svg)](LICENSE)

A browser for keeping separate online identities separate.

Proteus is two things that work together:

- **The kernel** — a set of patches on top of Chromium that let one JSON file decide
  how the browser describes its device to websites: user agent and client hints,
  screen, graphics card, fonts, voices, time zone, location, and the small rendering
  differences that canvas, WebGL and audio fingerprints are made of.
- **The manager** — a small local app that stores profiles, generates a coherent
  device identity for each one, and launches the kernel with it.

Each profile has its own cookies and storage and looks like a different device. The
same profile looks like the same device every time it starts.

**Website and browser test:** <https://sheekovic.github.io/Proteus-Browser/>

> **Status: early.** It works and is tested on Windows 11 and Linux. There are preview
> builds to try; there is no installer and nothing is code-signed yet.

## Download

Preview builds for Windows and Linux (x64) are on the
[releases page](https://github.com/Sheekovic/Proteus-Browser/releases). Each is one
folder holding the kernel, the manager and the Node.js runtime it needs: unpack it and
run `Start Proteus.cmd` (Windows) or `./start-proteus.sh` (Linux). Check the download
against `SHA256SUMS.txt`.

They are previews: unsigned, so Windows warns before running them, and not optimised
"official" builds. On Linux systems that restrict unprivileged user namespaces (Ubuntu
23.10 and later) the start script says so and names the one command that lets the
browser use its sandbox: `sudo ./linux-sandbox.sh --install`.

### Updates

A release folder updates itself. At each start, and once a day while it runs, the
manager asks GitHub which release is the newest: one small request, made by the manager
itself and not through any profile's proxy. When there is a newer one, a bar at the top
of the window says so, with an **Update** button. Nothing is downloaded before that
button is pressed. Then the release's file for your system is fetched into the data
folder, its SHA-256 is compared with the one the release lists, it is unpacked, and
Proteus closes, puts the new kernel, manager and Node.js in the place of the old ones
and opens again. Profiles and settings are not in the program folder and stay as they
are. No profile may be running when the new version is put in.

- Turn the asking off in the settings ("Ask GitHub at each start…"); the button
  "Check for a newer version" there still asks when pressed.
- The checksum shows the file is the one the release holds, not who made the release:
  both come from the same place over HTTPS, and nothing is signed.
- A working tree (and the `dist` folder made from one) is not a release and is not
  updated this way. Nor is a Proteus whose data folder is inside its program folder.
- If an update did not take, `update/apply.log` in the data folder says what the last
  attempt did.

## Contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Device fingerprints from real devices](#device-fingerprints-from-real-devices)
- [Building the kernel](#building-the-kernel)
- [Tests](#tests)
- [Repository layout](#repository-layout)
- [Limitations](#limitations)
- [Responsible use](#responsible-use)
- [License](#license)

## What it does

### Kernel

| Area | What a profile controls |
| --- | --- |
| Identity | `navigator.userAgent`, `platform`, `vendor`, client hints in script and in request headers, with brand lists generated the way that Chrome version builds them |
| Hardware | Processor count, device memory, screen and available screen size |
| Graphics | WebGL vendor and renderer, the card's limits, extensions and shader precision, WebGPU adapter info |
| Fingerprints | Canvas, WebGL and audio readbacks carry a small noise derived from the profile's seed: stable for a profile, different between profiles |
| Fonts | An allow-list of installed fonts, with substitutes for claimed fonts the machine lacks; phone profiles claim Android's or iOS's fonts, not the machine's |
| Locale | Languages, `Accept-Language`, time zone |
| Network | WebRTC that never reveals the machine's address, and shows the address you choose instead |
| Location | The position `navigator.geolocation` reports |
| Speech | The list of speech synthesis voices |
| Devices | Which microphones, cameras and speakers exist and what they are called, in the device list and on opened tracks; the battery; on Android, the kind of network connection |
| Phones | Android (Chrome) and iPhone (Safari) profiles: phone screen and page area, touch, pixel ratio, mobile layout |

The noise is deliberately conservative. It is applied only to content that already
differs between devices (text, curves, gradients), never to flat fills or to pixels a
page wrote itself, so the checks sites use to catch noise — draw a known colour, read
it back — still pass. Reading the same thing twice gives the same answer.

Without a profile the kernel behaves like the Chromium it is built from.

### Manager

- Profiles stored as plain JSON files, each with its own browser data directory.
- Identity generators for Windows, macOS, Linux, Android and iPhone, and ready-made
  setups (ordinary laptops, desktops and phones) to choose from instead. A Windows or
  Mac identity gets a graphics card read from a real computer, with its capabilities.
- Proxies per profile (HTTP and SOCKS5, with or without a login).
- Proxies checked before use (where one comes out, and how fast), and tolerant of the
  way real ones behave: retries, several lookup services, time limits.
- Many profiles at once from a pasted proxy list, each a device of its own; editing,
  duplicating and tagging them; cookies in and out as the files other browsers export.
- Optional matching of time zone, WebRTC address and location to the proxy's exit,
  and the exit address shown for every profile, running or stopped.
- A profile that came out at the same address twice starts without waiting for the
  lookup, which is repeated while the browser comes up.
- A light interface in a window of its own, drawn by the kernel itself, so nothing
  heavier than a web page is running.
- Everything it does can be done by a program: a JSON API, and the same abilities as
  [Model Context Protocol](https://modelcontextprotocol.io) tools for AI assistants.
  Both are bound to `127.0.0.1` only.
- Driving the browser, not only starting it: open tabs, go to a page, read its text,
  run a script in it, take a picture of it, read and set cookies.
- Every started profile also exposes a DevTools endpoint, so Puppeteer, Playwright or
  Selenium can drive it directly.
- Updates itself from the releases on GitHub, when you say so (see [Updates](#updates)).
- No dependencies: Node's standard library only.

## How it works

```
 profile.json ──► manager ──► kernel.json ──► chrome --proteus-config=kernel.json
   (stored)      (generates                    (the patched Chromium reads it in
                  and launches)                 every process and answers pages
                                                accordingly)
```

The kernel reads its configuration once at start and hands it to its child processes
on their command lines. Nothing is injected into pages: there is no extension and no
script running before the page's own. The values are changed where Chromium computes
them, so they are consistent in the page, in iframes and in workers, and native
functions still look native.

## Getting started

With a [preview build](#download) there is nothing to set up. To run from this
repository instead you need [Node.js](https://nodejs.org) 24 or newer and a built
kernel (see [Building the kernel](#building-the-kernel)).

```bash
cd manager
PROTEUS_KERNEL=/path/to/chrome node src/main.ts --open
```

The Proteus window opens. Create a profile and press **Start**.

- Starting Proteus while it is already running shows its window again.
- `--open` shows the manager in a window of its own; closing it ends Proteus, unless
  profiles are still running. `--open-browser` uses your usual browser instead, and
  without either the manager only serves <http://127.0.0.1:5310>.
- `PROTEUS_KERNEL` names the kernel the first time; after that it is remembered (and
  can be changed under **Settings**). A kernel in a `kernel` folder next to `manager`
  is found by itself.
- `--port <n>` or `PROTEUS_PORT` choose another port, and `PROTEUS_HOME` another data
  directory (the default is `%APPDATA%\Proteus` on Windows and `~/.proteus` elsewhere).

### API

```bash
# Create a profile
curl -X POST http://127.0.0.1:5310/api/profiles \
     -H 'Content-Type: application/json' \
     -d '{"name": "Shop account", "os": "windows", "timezone": "Europe/Berlin"}'

# Start it; the reply carries a DevTools endpoint ("debuggerUrl")
curl -X POST http://127.0.0.1:5310/api/profiles/<id>/start \
     -H 'Content-Type: application/json' -d '{}'

# Ten at once, each with its own identity and its own proxy from a list
curl -X POST http://127.0.0.1:5310/api/profiles/bulk \n     -H 'Content-Type: application/json' \n     -d '{"count": 10, "name": "Shop", "common": {"os": "windows"}, "proxies": "host:port:user:password
…"}'

# Where does a proxy come out?
curl -X POST http://127.0.0.1:5310/api/proxy/check \n     -H 'Content-Type: application/json' -d '{"profileId": "<id>"}'

# Open a page in it, read what it shows, take a picture
curl -X POST http://127.0.0.1:5310/api/profiles/<id>/tabs \
     -H 'Content-Type: application/json' -d '{"url": "https://example.com/"}'
curl http://127.0.0.1:5310/api/profiles/<id>/tabs/<tab>/text
curl -o page.png http://127.0.0.1:5310/api/profiles/<id>/tabs/<tab>/screenshot

# Run a script in the page
curl -X POST http://127.0.0.1:5310/api/profiles/<id>/tabs/<tab>/evaluate \
     -H 'Content-Type: application/json' -d '{"expression": "document.title"}'

# Move a session in: set cookies exported from another browser
curl -X PUT http://127.0.0.1:5310/api/profiles/<id>/cookies \
     -H 'Content-Type: application/json' \
     -d '[{"name": "sid", "value": "…", "domain": ".example.com", "path": "/", "secure": true}]'
```

`GET /api` lists every route; they are described at the top of
[`manager/src/server.ts`](manager/src/server.ts).

**A profile's state has one shape in every reply.** `state` is `"running"` or
`"stopped"`, and `status` holds the details:

```json
{ "id": "…", "name": "Shop account", "…": "…",
  "state": "running",
  "status": { "state": "running", "pid": 4242, "startedAt": "…", "debuggerUrl": "http://127.0.0.1:41233",
              "proxyExit": { "ip": "203.0.113.50", "timezone": "Asia/Tokyo" }, "exitSeenAt": "…" } }
```

The list, a single profile, and the replies to creating, editing and duplicating one
all look like that. They also carry `proxyExit` (or `lastProxyExit`), `exitSeenAt`,
`exitNow` and `exitProblem` at the top level when there is one, so `entry.proxyExit`
reads the same on a list entry as on a start reply. The status, start and stop replies carry `state` and `status` too,
and also keep the details at the top level (`debuggerUrl`, `pid`, …), where they were
before, so both `reply.status.debuggerUrl` and `reply.debuggerUrl` work there.

In `status`:

| Field | When | Meaning |
| --- | --- | --- |
| `proxyExit` | running, with a proxy | The address (and time zone, position) the proxy comes out on. With `matchProxy` on it is always there and the browser was matched to it. With `matchProxy` off nobody is asked at a start, so it is what the last proxy check or matched run found, if anything. |
| `exitSeenAt` | with `proxyExit` | When that address was last seen. |
| `lastProxyExit` | stopped, with a proxy | Where the proxy came out the last time it was asked, with `at`. |
| `exitNow` | running | The proxy has moved to this address since the start: restart the profile to match it. |
| `exitProblem` | running | Why the proxy could not be reached at the last look. |
| `lastExit` | stopped | How the last run ended, if it ended on its own. |

**Ready-made setups.** `GET /api/presets` lists them (`windows-office-laptop`,
`windows-laptop`, `windows-desktop`, `windows-gaming-desktop`, `macbook-air`,
`macbook-pro-14`, `linux-desktop`, `pixel-8`, `galaxy-a34`, `iphone-15`). Passing
`"preset": "<id>"` when creating a profile (or to the bulk route) fixes the screen,
graphics card, processor and memory to that device; the noise seed is new each time,
so two profiles from one preset are two devices of the same model. Without a preset
an identity is generated as before. They are hand-written compositions of common
configurations, not readings of real devices; for those, see below.

**How a profile introduces itself.** Before any page loads, a server sees the shape of
the browser's TLS hello and of its HTTP/2 opening, and can compare it with the version
the browser claims. `GET /api/profiles/<id>/transport` measures both and sets them
beside the claim:

```json
{ "claims":   { "browser": "Chrome", "version": "157.0.8103.79", "userAgent": "Mozilla/5.0 …" },
  "kernel":   { "version": "157.0.8103.79" },
  "produces": { "tls":   { "ja4": "t13d1517h2_8daaf6152771_cb7bf5808d99", "ciphers": ["1301", "…"], "extensions": ["0000", "…"], "…": "…" },
                "http2": { "fingerprint": "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p", "settings": [[1, 65536], "…"],
                           "pseudoHeaders": [":method", ":authority", ":scheme", ":path"], "headers": ["sec-ch-ua", "…"] },
                "userAgent": "Mozilla/5.0 …" },
  "expected": { "ja4": "t13d1517h2_8daaf6152771_cb7bf5808d99", "http2": "1:65536;…|m,a,s,p", "measuredFrom": "Chrome 157.0.8103.79, Windows 11" },
  "agrees": true, "differences": [], "notes": ["…"] }
```

`produces` is measured, each time: a second, windowless copy of the kernel is started
with the profile's settings in a folder of its own and sent to a recorder on
`localhost` ([`transport.ts`](manager/src/transport.ts)). It takes about half a second,
works on a running or a stopped profile, touches neither its browser data nor its
tabs, uses no proxy and can reach nothing but the recorder. `tls.ja4` is the
[JA4](https://github.com/FoxIO-LLC/ja4) TLS fingerprint; `http2.fingerprint` is
settings, window update, priority frames and pseudo-header order. `expected` is what a
stock browser of the claimed kind sent to the same recorder, and `differences` says in
words what does not fit (an extra TLS extension, a claimed version the kernel is not,
…). `agrees` is true when there is none.

A profile is started so that its handshake is the one its claim goes with
([`transportClaim.ts`](manager/src/transportClaim.ts)). Chromium builds that are not
Google's switch on an experiment Chrome has off (`AddTLSServerHandshakePadding`), which
adds a TLS extension, `0x12e0`; with it a profile sent
`t13d1518h2_8daaf6152771_4980c97edce0`. The manager now turns it off. What each
ready-made setup claims and produces, measured on Windows 11 with kernel 157.0.8103.79:

| Setup | Claims | TLS (JA4) | HTTP/2 | Agrees |
| --- | --- | --- | --- | --- |
| `windows-office-laptop` | Chrome 157.0.8103.79, Windows | `t13d1517h2_8daaf6152771_cb7bf5808d99` | `1:65536;2:0;4:6291456;6:262144\|15663105\|0\|m,a,s,p` | yes |
| `windows-laptop` | Chrome 157.0.8103.79, Windows | same | same | yes |
| `windows-desktop` | Chrome 157.0.8103.79, Windows | same | same | yes |
| `windows-gaming-desktop` | Chrome 157.0.8103.79, Windows | same | same | yes |
| `macbook-air` | Chrome 157.0.8103.79, macOS | same | same | yes |
| `macbook-pro-14` | Chrome 157.0.8103.79, macOS | same | same | yes |
| `linux-desktop` | Chrome 157.0.8103.79, Linux | same | same | yes |
| `pixel-8` | Chrome 157.0.8103.79, Android | same | same | yes |
| `galaxy-a34` | Chrome 157.0.8103.79, Android | same | same | yes |
| `iphone-15` | Safari 27.2, iPhone | `t13d2013h2_a09f3c656075_7f0f34a4126d` | `2:0;3:100;4:2097152;9:1\|10420225\|0\|m,s,a,p` | yes |

Nine of them claim the Chrome the kernel is, so they produce one shape: the same as
stock Chrome 157.0.8103.79 on the same machine, byte for byte in what the fingerprints
cover. The kernel is that same release: stable Chrome was 157.0.8103.79 for 99% of its
users when this was measured, with 158 at the start of its rollout, and a browser on
a version almost nobody has yet stands out by that alone. (An earlier kernel was
158.0.8127.37; its patch series is in the history of `kernel/patches`.) The version a
setup names is the kernel's: the manager reads it from the kernel itself, and a Chrome
profile made for another kernel version is moved to this one the next time it starts
(only the version changes; the device stays the same). So a newer kernel moves claim
and shape together. Three things the
table does not show:

- The reference was measured on Windows only. Chrome uses the same network code on
  macOS, Linux and Android, but no stock Chrome there was measured.
- The iPhone setup shakes hands as Safari does: the kernel (patch 0028) makes Safari's
  TLS hello and HTTP/2 opening when a profile's configuration asks for it. What it is
  held to was recorded from Safari 27.2 on an iPhone 17 Pro Max: the cipher suites,
  the extensions with their content and order, the HTTP/2 settings and window, and
  the headers of a page load (their order, Safari's `Accept`, and none of the two
  Chrome adds, `Upgrade-Insecure-Requests` and `Sec-Fetch-User`). Three things are not
  Safari's: such a profile stays off QUIC (HTTP/3), where the kernel would be Chrome
  again; the headers of requests other than a page load (pictures, scripts, `fetch`)
  were not measured, and over HTTP/1.1 they are Chrome's; and an iPhone profile made before
  this keeps the Safari 18.5 or 18.6 it claimed, held to the same shape.
- A profile whose User-Agent names another Chrome version than the kernel (set by
  hand, or made for an older kernel) still shakes hands as the kernel's version. The
  report says so; a new identity brings the claim back in line.

A connection that resumes an earlier session carries one more extension (`0x0029`),
in every Chrome; fingerprints taken on a second visit therefore differ from these.

**Memory.** `deviceMemory` is held to what the profile's browser can report:
`2, 4, 8, 16, 32` for Chrome on a computer and `1, 2, 4, 8` for Chrome on Android
(checked against an unmodified Chromium 158, which reports 32 on a machine with more;
Chrome versions before the limit was raised stopped at 8). A value outside that is
refused with `{"error": …}` naming the accepted ones, when the value or the system is
set. A generated profile gets a value that fits its processor. Profiles saved earlier
keep whatever they have.

**Start times.** Measured on Windows 11 with the earlier kernel, 158: a profile without a proxy
starts in about 1.5 s. Behind a proxy almost all of the time is the exit lookup: 3 s
to 27 s in our runs through a residential proxy. Once the exit has been the same
twice it is remembered for `exitCacheMinutes` (30 by default, a setting) and the
start takes about 1.4 s; the lookup then runs while the browser comes up, and
`exitNow` says so if the exit has moved after all. A proxy that gives a new address
on every connection never qualifies and is always asked first, as is any proxy with
the setting at 0.

**Lists a profile carries.** Fonts, voices and media devices are part of a profile
from the moment it is made. Its languages are not, unless given: the first time such a
profile runs, the manager asks its browser which languages (and, for profiles saved
by early versions, voices) it reported and saves them in the profile, so that it
reports the same on any computer afterwards.

### Puppeteer and Playwright

A started profile is driven by connecting to its `debuggerUrl`. The profile was
started by the manager, without the switches those libraries start a browser with, so
what a page looks at stays a person's browser:

```js
// Puppeteer. defaultViewport: null leaves the window as it is; without it Puppeteer
// sets the page area to 800 by 600, whatever the profile's screen.
const browser = await puppeteer.connect({ browserURL: status.debuggerUrl, defaultViewport: null });

// Playwright. Use the context that is there: a new one would be a browser without
// the profile's cookies.
const browser = await chromium.connectOverCDP(status.debuggerUrl);
const page = await browser.contexts()[0].newPage();
```

[`manager/test/e2e/automation.mjs`](manager/test/e2e/automation.mjs) checks it on the
real kernel, with a page that looks for what detection scripts look for. Driven by
either library, on kernel 157.0.8103.79: `navigator.webdriver` is false, nothing the
page logs is read by the debugger client (the page's own getter is not run), no names
are left on the page, the page area and pixel ratio stay the profile's, and a click is
the browser's own, placed on the screen where the window is, after the pointer moved
there. Two things are the script's own business. A function of the page that the
script calls sees the caller in its stack (`pptr:evaluate` for Puppeteer, an `eval`
frame for Playwright), so a script should read from a page and not call into it. And
how fast and how straight the pointer moves is the library's, not a hand's. Selenium
was not measured: it needs a driver program of the kernel's version.

### A camera picture from a file

A page that is allowed the camera gets this machine's camera. A profile can show a
video file instead: set `cameraFile` to the path of a `.y4m` or `.mjpeg` file (in the
profile's settings, or through the API). The page then gets the file's picture, in a
loop, and a silent microphone; the devices keep the names the profile gives them. The
user is still asked before a page gets either.

### MCP (for AI assistants)

The manager is also a [Model Context Protocol](https://modelcontextprotocol.io)
server, so an assistant can create profiles, start them and work in them. It offers
26 tools: profiles (`list_profiles`, `create_profile`, `create_profiles`, `duplicate_profile`,
`update_profile`, `delete_profile`, `start_profile`, `stop_profile`, `new_identity`), proxies
(`check_proxy`), the handshake report (`transport_report`), ready-made setups (`list_presets`), devices and settings, and the browser itself (`list_tabs`, `open_tab`, `navigate`, `page_text`,
`evaluate`, `screenshot`, `close_tab`, `get_cookies`, `set_cookies`).

- Assistants that connect over HTTP use `http://127.0.0.1:5310/mcp` while the manager
  runs.
- Assistants that start a program and talk to it use the bridge, which forwards to
  the running manager:

  ```json
  { "mcpServers": { "proteus": { "command": "node", "args": ["/path/to/manager/src/mcp-stdio.ts"] } } }
  ```

[`.claude/skills/proteus`](.claude/skills/proteus/SKILL.md) is a skill that teaches an
assistant to do all of this: Claude Code picks it up by itself inside this repository,
and copying the folder to `~/.claude/skills/` makes it available everywhere.

The API and the MCP endpoint have no login. They answer only requests addressed to
localhost and refuse requests from other websites' pages. Whoever can reach them can
run scripts in your profiles' pages and read their cookies, which is the point of
them — so do not put the manager's port behind a proxy that others can reach.

## Device fingerprints from real devices

A generated identity is built from lists of ordinary configurations. For more
variety, and for identities that match hardware that really exists, Proteus can read
a real device and make profiles from the reading.

1. Open the collector page on the device, in Chrome (or in Safari on an iPhone):
   - on the computer running the manager: **Device fingerprints → Read this
     computer's browser**;
   - on any other device: open [`manager/ui/collect.html`](manager/ui/collect.html)
     there. It is a single self-contained file; serve it over HTTPS so the browser
     shares its version details and model.
2. Press **Read this device**, then save the result or download it as a file.
3. Import the file in the manager and choose it under **Device identity** when
   creating a profile.

The page reads what any website can read about the device: browser and system
version, phone model, screen, processor count, memory class, graphics card name and
limits, font names from a fixed list, speech voices, and which kinds of media device are
listed (not their names). It does not read the IP address,
location, language, time zone, cookies or history, and nothing leaves the page until
you press a button.

Profiles made from one reading are the same *model* of device, each with its own
noise seed — not copies of one device.

## Building the kernel

The kernel is Chromium **157.0.8103.79** (pinned in
[`kernel/CHROMIUM_VERSION`](kernel/CHROMIUM_VERSION)) with the patches in
[`kernel/patches`](kernel/patches) applied in order. BoringSSL, the TLS library, is a
repository of its own inside a Chromium checkout, so the one patch that touches it is
kept apart, in [`kernel/patches/boringssl`](kernel/patches/boringssl).

A Chromium build needs a capable machine: roughly 100 GB of disk, 32 GB of RAM, and
hours for the first build. In outline:

1. Fetch that Chromium release and its build dependencies, following
   [Chromium's own instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/get_the_code.md)
   for your platform.
2. Apply the patches:
   ```bash
   cd chromium/src
   git am /path/to/Proteus/kernel/patches/*.patch
   git -C third_party/boringssl/src am /path/to/Proteus/kernel/patches/boringssl/*.patch
   ```
3. Configure with [`kernel/args.gn`](kernel/args.gn) and build:
   ```bash
   gn gen out/Release --args="$(cat /path/to/Proteus/kernel/args.gn)"
   autoninja -C out/Release chrome
   ```

`kernel/scripts` holds the scripts this project uses to do that on a Linux build
server, including a Windows cross-build. They are written for one setup and are kept
as a reference rather than a general build system; the ones that talk to a build
server read its address from the `PROTEUS_BUILD_HOST` environment variable
(`user@host`).

On that setup a release is one command: [`release/make-release.ps1`](release/make-release.ps1)
` <version>` rebuilds the Linux kernel, runs every kernel test on it, exports the patch
series, builds the Windows kernel and assembles both bundles, stopping at the first
failure. It publishes nothing.

[`release/update-dist.ps1`](release/update-dist.ps1) keeps a `dist` folder (not
committed) that runs the current working tree as it is — the newest kernel under
`out`, the manager, a shortcut with the Proteus icon — and, with `-InstallHook`,
refreshes it after every commit.

`kernel/src` and `kernel/scripts/edits` are the patches in their editable form: new
source files, and small scripts that make the in-place edits to Chromium's own files.

## Tests

**Manager** — unit and API tests, no browser needed:

```bash
cd manager
npm test
```

**Kernel** — each patch has a test page that reports what a page can observe, and a
script that compares a plain run with profile runs. On Windows, from Git Bash:

```bash
kernel/scripts/win-test.sh <folder with chrome.exe> identity locale mobile glcaps
```

**End to end** — starts the manager, creates profiles, launches the real kernel and
checks what pages see, and that the handshake agrees with the claim:

```bash
python kernel/tests/serve.py kernel/tests 8793 &
node manager/test/e2e/real-kernel.mjs <path to chrome> http://127.0.0.1:8793
```

**Automation** — drives a profile with Puppeteer and with Playwright and prints what
a page can tell (see [Puppeteer and Playwright](#puppeteer-and-playwright)). The two
libraries are not part of this repository:

```bash
mkdir libraries && cd libraries && npm init -y && npm install puppeteer-core playwright-core && cd ..
node manager/test/e2e/automation.mjs <path to chrome> libraries
```

**Updating** — a pretend release folder runs the manager, a pretend GitHub on this
machine offers a newer one, and the manager is asked to fetch it and put it in; the
script it leaves has to replace the folder and start Proteus again. Nothing is fetched
from the internet:

```bash
node manager/test/e2e/update.mjs
```

**Detection sites** — runs fresh Windows, Android and iPhone profiles past public
detection sites and compares each verdict with the expected one, so that a regression
(or a site getting stricter) is noticed. It needs the network and takes a while; run
it after kernel changes, before a release, or from a scheduler:

```bash
node manager/test/e2e/site-check.mjs <path to chrome>
```

[`kernel/tests/detect.html`](kernel/tests/detect.html) is a page of the consistency
checks detection scripts commonly run (does a known pixel read back unchanged, do
the page and a worker agree, do the fonts fit the claimed system, …). An unmodified
browser passes all of them, and so should a profile.

## Repository layout

```
kernel/
  CHROMIUM_VERSION   the Chromium release the patches apply to
  args.gn            build settings
  patches/           the kernel, as patches (apply with git am)
  src/               new source files, in Chromium's directory layout
  scripts/           build and test scripts; edits/ makes the in-place changes
  tests/             test pages and the scripts that check them
docs/                the website (GitHub Pages), including the browser test page
release/             what a release bundle adds, and the script that assembles one
manager/
  src/               the manager (TypeScript, run directly by Node)
  ui/                the web UI and the fingerprint collector page
  test/              unit, API and end-to-end tests
```

## Limitations

Worth knowing before relying on it:

- **It is Chromium underneath.** An iPhone profile reports Safari's identity and
  lacks what Safari lacks, and its TLS and HTTP/2 handshake is Safari's, but a site
  that probes engine behaviour can still tell it is not WebKit. It does not use
  HTTP/3. There is no Firefox kernel.
- **One kernel, two handshakes.** A Chrome profile shakes hands as the Chrome version
  the kernel was built from, an iPhone profile as the one Safari that was measured.
  A profile claiming another Chrome version is reported, not fixed.
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
  ([`read-surface.mjs`](manager/tools/read-surface.mjs) serves the page that reads it).
  An iPhone profile now hides the 291 members of the global object that Safari lacks
  (`EyeDropper`, `Notification`, `requestIdleCallback`, WebUSB, WebXR, …; all but
  `MediaSource` and its buffers, kept so that video in pieces still plays) and 177
  members of the interfaces pages look at first. What is left: 248 members of less
  looked-at interfaces, for which the kernel's configuration has no room; the 99 names
  Safari has and the kernel does not (`ApplePaySession`, `GestureEvent`, …), which
  cannot be added from outside; and `navigator.gpu`, hidden although Safari has it,
  because the kernel's would describe this machine's graphics card. An Android profile
  was compared with a Galaxy's Chrome before and after an update (152 and 158, one
  older and one newer than the kernel) and hides what neither has (window sharing,
  local fonts, the built-in language models, …), with `navigator.contacts`,
  `NDEFReader`, `BarcodeDetector` and the like switched on. Read back on the kernel,
  its global object has the same names as the phone's Chrome 158, in a page and in a
  worker; 14 members of interfaces that the phone has are still missing.
- **The second screen is the machine's.** A profile says it has one screen
  (`screen.isExtended` is false) whatever is plugged into the machine; an iPhone
  profile has no such member at all, as Safari has none.
- **A profile's window is drawn at the profile's scale.** A screen comes with the
  pixel ratio it was read at (1536 by 864 is a 1920 by 1080 panel at 125%, a Mac's is
  2), and the browser is started at that ratio so that what a page reads agrees with
  it. On your monitor that makes a profile's window look larger or smaller than your
  other programs. A profile made before this has no ratio and uses the machine's.
- **A limit is a claim.** A page that actually allocates beyond a claimed limit
  succeeds if the real hardware allows it.
- **Two things still come from the machine a profile runs on.** The stand-in fonts
  below are chosen from the machine's own, and a profile without a device reading
  reports the machine's graphics limits (above). Moved to another computer, a profile
  keeps everything else.
- **Fonts of another system are stand-ins.** A profile of a system other than the
  machine's own — which includes every phone profile — claims that system's fonts and
  hides the machine's, but draws them with substitutes. A page finds the names;
  careful measurement of the glyphs can tell a substitute from the real font.
- **A camera is still this machine's camera.** A profile decides which devices are
  listed and what they are called. A page that is allowed to open one gets this
  machine's picture and sound, and the resolutions its hardware offers; a listed
  device the machine has no counterpart for cannot be opened.
- **Tested on few machines.** Results on detection sites depend on the host; what
  holds on one Windows 11 machine is not a guarantee elsewhere.
- **No protection is complete.** Sites combine many signals — address reputation,
  behaviour, account history — that no browser controls.

## Responsible use

Proteus is for separating identities you are entitled to have: managing several
accounts of your own, testing how sites treat different devices, research, and
privacy. Use it within the law and within the terms of the services you use. Do not
use it for fraud, to evade a ban, or to impersonate someone else.

The patches are original work written for this project. Proteus is not affiliated
with, and contains no code or data from, any commercial anti-detect browser.

The graphics cards a new identity is drawn from
([`manager/src/gpus.json`](manager/src/gpus.json)) are taken from readings of real
browsers that Scrapfly published with
[fingerprint-generator](https://github.com/scrapfly/fingerprint-generator) under the
Apache License 2.0 ([its text](manager/licenses/fingerprint-generator-LICENSE.txt)).
[`manager/tools/build-readings.mjs`](manager/tools/build-readings.mjs) makes the file from a
release of that model: per card, the capabilities most often read with it, leaving
out software renderers, virtual machines and readings that lack something. On the
computer this was written on, the file's entry for its own card matched what the
kernel reads there in every one of 55 limits, both extension lists and the shader
precision.

## License

Proteus is released under the [BSD 3-Clause License](LICENSE).

The kernel patches modify [Chromium](https://www.chromium.org/), which is the work of
The Chromium Authors and is distributed under its own licences (BSD 3-Clause for
Chromium itself, others for the third-party code it includes). Those continue to
apply to the code the patches are applied to.
