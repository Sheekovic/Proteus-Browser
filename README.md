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
| Phones | Android (Chrome) and iPhone (Safari) profiles: phone screen and page area, touch, pixel ratio, mobile layout |

The noise is deliberately conservative. It is applied only to content that already
differs between devices (text, curves, gradients), never to flat fills or to pixels a
page wrote itself, so the checks sites use to catch noise — draw a known colour, read
it back — still pass. Reading the same thing twice gives the same answer.

Without a profile the kernel behaves like the Chromium it is built from.

### Manager

- Profiles stored as plain JSON files, each with its own browser data directory.
- Identity generators for Windows, macOS, Linux, Android and iPhone.
- Proxies per profile (HTTP and SOCKS5, with or without a login).
- Proxies checked before use (where one comes out, and how fast), and tolerant of the
  way real ones behave: retries, several lookup services, time limits.
- Many profiles at once from a pasted proxy list, each a device of its own; editing,
  duplicating and tagging them; cookies in and out as the files other browsers export.
- Optional matching of time zone, WebRTC address and location to the proxy's exit.
- A light interface in a window of its own, drawn by the kernel itself, so nothing
  heavier than a web page is running.
- Everything it does can be done by a program: a JSON API, and the same abilities as
  [Model Context Protocol](https://modelcontextprotocol.io) tools for AI assistants.
  Both are bound to `127.0.0.1` only.
- Driving the browser, not only starting it: open tabs, go to a page, read its text,
  run a script in it, take a picture of it, read and set cookies.
- Every started profile also exposes a DevTools endpoint, so Puppeteer, Playwright or
  Selenium can drive it directly.
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

### MCP (for AI assistants)

The manager is also a [Model Context Protocol](https://modelcontextprotocol.io)
server, so an assistant can create profiles, start them and work in them. It offers
24 tools: profiles (`list_profiles`, `create_profile`, `create_profiles`, `duplicate_profile`,
`update_profile`, `delete_profile`, `start_profile`, `stop_profile`, `new_identity`), proxies
(`check_proxy`), devices and settings, and the browser itself (`list_tabs`, `open_tab`, `navigate`, `page_text`,
`evaluate`, `screenshot`, `close_tab`, `get_cookies`, `set_cookies`).

- Assistants that connect over HTTP use `http://127.0.0.1:5310/mcp` while the manager
  runs.
- Assistants that start a program and talk to it use the bridge, which forwards to
  the running manager:

  ```json
  { "mcpServers": { "proteus": { "command": "node", "args": ["/path/to/manager/src/mcp-stdio.ts"] } } }
  ```

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
limits, font names from a fixed list, speech voices. It does not read the IP address,
location, language, time zone, cookies or history, and nothing leaves the page until
you press a button.

Profiles made from one reading are the same *model* of device, each with its own
noise seed — not copies of one device.

## Building the kernel

The kernel is Chromium **158.0.8127.37** (pinned in
[`kernel/CHROMIUM_VERSION`](kernel/CHROMIUM_VERSION)) with the patches in
[`kernel/patches`](kernel/patches) applied in order.

A Chromium build needs a capable machine: roughly 100 GB of disk, 32 GB of RAM, and
hours for the first build. In outline:

1. Fetch that Chromium release and its build dependencies, following
   [Chromium's own instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/get_the_code.md)
   for your platform.
2. Apply the patches:
   ```bash
   cd chromium/src
   git am /path/to/Proteus/kernel/patches/*.patch
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
checks what pages see:

```bash
python kernel/tests/serve.py kernel/tests 8793 &
node manager/test/e2e/real-kernel.mjs <path to chrome> http://127.0.0.1:8793
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
  lacks what Safari lacks, but a site that probes engine behaviour, or looks at the
  TLS handshake, can still tell it is not WebKit. There is no Firefox kernel.
- **Generated identities name a graphics card without its capabilities.** Only
  profiles made from a real device's reading report that card's WebGL limits; the
  others report the machine's own.
- **A limit is a claim.** A page that actually allocates beyond a claimed limit
  succeeds if the real hardware allows it.
- **Fonts of another system are stand-ins.** A profile of a system other than the
  machine's own — which includes every phone profile — claims that system's fonts and
  hides the machine's, but draws them with substitutes. A page finds the names;
  careful measurement of the glyphs can tell a substitute from the real font.
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

## License

Proteus is released under the [BSD 3-Clause License](LICENSE).

The kernel patches modify [Chromium](https://www.chromium.org/), which is the work of
The Chromium Authors and is distributed under its own licences (BSD 3-Clause for
Chromium itself, others for the third-party code it includes). Those continue to
apply to the code the patches are applied to.
