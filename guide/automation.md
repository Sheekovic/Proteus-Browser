<sub>[← Proteus](../README.md) · [The API](api.md) · [Automation](automation.md) · [Updates](updates.md) · [Limitations](limitations.md)</sub>

# Driving a profile

## Puppeteer, Playwright and Selenium

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

[`manager/test/e2e/automation.mjs`](../manager/test/e2e/automation.mjs) checks it on the
real kernel, with a page that looks for what detection scripts look for. Driven by
either library, on kernel 157.0.8103.79: `navigator.webdriver` is false, nothing the
page logs is read by the debugger client (the page's own getter is not run), no names
are left on the page, the page area and pixel ratio stay the profile's, and a click is
the browser's own, placed on the screen where the window is, after the pointer moved
there. Two things are the script's own business. A function of the page that the
script calls sees the caller in its stack (`pptr:evaluate` for Puppeteer, an `eval`
frame for Playwright), so a script should read from a page and not call into it. And
how fast and how straight the pointer moves is the library's, not a hand's.

Selenium drives a browser through a driver program, and the stock one (chromedriver)
gives itself away: it keeps seven names on every page it drives
(`cdc_adoQpoasnfa76pfcZLmcfl_Array`, …), which is the first thing a site looks for.
The kernel folder has a `chromedriver` of its own, built with the kernel and of its
version, that does not make them. Point Selenium at it and at the running profile:

```python
from selenium import webdriver
from selenium.webdriver.chrome.service import Service

options = webdriver.ChromeOptions()
options.debugger_address = "127.0.0.1:53421"    # the profile's DevTools address
driver = webdriver.Chrome(service=Service(r"...\Proteus\kernel\chromedriver.exe"), options=options)
```

The same check, speaking to that driver as Selenium does, finds what it finds for the
two libraries: nothing of the above, and a page function the script calls sees an
`eval` frame in its stack. With the stock driver of the same version it finds the
seven names.

## What a profile's camera shows

A page that is allowed the camera of a profile gets a covered lens: a dark picture
with the grain of a sensor, each profile's its own, and a silent microphone. The room
this machine stands in and the voice in it are the same in every profile, so no
profile gives them away unless it is told to. The devices keep the names the profile
gives them, and the user is still asked before a page gets either.

A profile can show something else: set `cameraFile` (in the profile's settings, or
through the API) to the path of a `.y4m` or `.mjpeg` video, which the page then gets
in a loop with a silent microphone, or to `machine` for a video call: pages you allow
then get this machine's own camera and microphone. A profile saved before profiles
had devices of their own uses the machine's as before.

## MCP (for AI assistants)

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

[`.claude/skills/proteus`](../.claude/skills/proteus/SKILL.md) is a skill that teaches an
assistant to do all of this: Claude Code picks it up by itself inside this repository,
and copying the folder to `~/.claude/skills/` makes it available everywhere.

The API and the MCP endpoint have no login. They answer only requests addressed to
localhost and refuse requests from other websites' pages. Whoever can reach them can
run scripts in your profiles' pages and read their cookies, which is the point of
them — so do not put the manager's port behind a proxy that others can reach.
