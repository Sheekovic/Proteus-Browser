Proteus @VERSION@  (preview)
=============================

A browser in which every profile is its own device.
https://github.com/Sheekovic/Proteus-Browser


START

  Windows   double-click "Start Proteus.cmd"
  Linux     ./start-proteus.sh

A page opens in your usual browser at http://127.0.0.1:5310. Create a profile
there and press Start: a Proteus window opens for that profile.

Keep the Proteus window (the black one on Windows, the terminal on Linux) open
while you work. Closing it stops the running profiles.


WHAT IS IN THIS FOLDER

  kernel/     the browser: Chromium 158 with the Proteus patches
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
  - On Linux the browser needs unprivileged user namespaces for its sandbox.
    Ubuntu 24.04 and later restrict them; see the project page.
  - Not an optimised "official" build: it is somewhat slower than a retail browser.

Check how a profile looks to a website:
  https://sheekovic.github.io/Proteus-Browser/test.html


USE IT RESPONSIBLY

Proteus is for separating identities you are entitled to have: several accounts
of your own, testing, research, privacy. Not for fraud, evading a ban, or
impersonating someone else.

Licence: BSD 3-Clause (LICENSE.txt). Chromium and Node.js are under their own
licences (licenses/).
