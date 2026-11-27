<sub>[← Proteus](../README.md) · [The API](api.md) · [Automation](automation.md) · [Updates](updates.md) · [Limitations](limitations.md)</sub>

# The API

```bash
# Create a profile
curl -X POST http://127.0.0.1:5310/api/profiles \
     -H 'Content-Type: application/json' \
     -d '{"name": "Shop account", "os": "windows", "timezone": "Europe/Berlin"}'

# Start it; the reply carries a DevTools endpoint ("debuggerUrl")
curl -X POST http://127.0.0.1:5310/api/profiles/<id>/start \
     -H 'Content-Type: application/json' -d '{}'

# Ten at once, each with its own identity and its own proxy from a list
curl -X POST http://127.0.0.1:5310/api/profiles/bulk \
     -H 'Content-Type: application/json' \
     -d '{"count": 10, "name": "Shop", "common": {"os": "windows"}, "proxies": "host:port:user:password\n…"}'

# Where does a proxy come out?
curl -X POST http://127.0.0.1:5310/api/proxy/check \
     -H 'Content-Type: application/json' -d '{"profileId": "<id>"}'

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
[`manager/src/server.ts`](../manager/src/server.ts).

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
configurations, not readings of real devices; for those, see
[Device fingerprints from real devices](../README.md#identities-from-real-devices).

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
`localhost` ([`transport.ts`](../manager/src/transport.ts)). It takes about half a second,
works on a running or a stopped profile, touches neither its browser data nor its
tabs, uses no proxy and can reach nothing but the recorder. `tls.ja4` is the
[JA4](https://github.com/FoxIO-LLC/ja4) TLS fingerprint; `http2.fingerprint` is
settings, window update, priority frames and pseudo-header order. `expected` is what a
stock browser of the claimed kind sent to the same recorder, and `differences` says in
words what does not fit (an extra TLS extension, a claimed version the kernel is not,
…). `agrees` is true when there is none.

A profile is started so that its handshake is the one its claim goes with
([`transportClaim.ts`](../manager/src/transportClaim.ts)). Chromium builds that are not
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
