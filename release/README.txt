Proteus @VERSION@  (preview)
=============================

A browser in which every profile is its own device.
https://github.com/Sheekovic/Proteus-Browser


START

  Windows   double-click "Start Proteus.cmd"
            or "Install Proteus.cmd" first: it puts a copy in your own programs
            folder with a shortcut in the Start menu and on the desktop (no
            administrator rights; remove it again under "Installed apps")
  Linux     ./start-proteus.sh

The Proteus window opens. Create a profile there and press Start: a browser
window opens for that profile.

Closing the Proteus window ends Proteus. If profiles are still running they are
kept, and end when you close the small console window (Windows) or press Ctrl+C
in the terminal (Linux).

Updates: at each start Proteus asks GitHub whether there is a newer version (one
small request; turn it off in the settings). When there is, the window says so
and offers to update. Nothing is downloaded until you press Update; then the
new version is fetched, checked against the release's checksum, and put in the
place of this one. Profiles and settings stay.

For programs and AI assistants: the same things can be done through the API at
http://127.0.0.1:5310/api and the MCP endpoint at http://127.0.0.1:5310/mcp.


WHAT IS IN THIS FOLDER

  kernel/     the browser: Chromium 157 with the Proteus patches
  manager/    the app that stores profiles and starts the kernel
  node/       the Node.js runtime the manager runs on
  licenses/   licences of the software included

Your profiles are not stored here. They are in
  Windows   %APPDATA%\Proteus
  Linux     ~/.proteus
so you can replace this folder with a newer one and keep them.


THIS IS A PREVIEW

  - Windows will warn that the program is from an unknown publisher: the files
    are not code-signed. Choose "More info", then "Run anyway".
  - Antivirus software may scan the browser for a minute the first time it runs.
  - On Linux systems that restrict unprivileged user namespaces (Ubuntu 23.10
    and later), run this once so the browser can use its sandbox:
        sudo ./linux-sandbox.sh --install
    The start script tells you when it is needed.
  - Not an optimised "official" build: it is somewhat slower than a retail browser.

Check how a profile looks to a website:
  https://sheekovic.github.io/Proteus-Browser/test.html


USE IT RESPONSIBLY

Proteus is for separating identities you are entitled to have: several accounts
of your own, testing, research, privacy. Not for fraud, evading a ban, or
impersonating someone else.

Licence: BSD 3-Clause (LICENSE.txt). Chromium and Node.js are under their own
licences (licenses/).
