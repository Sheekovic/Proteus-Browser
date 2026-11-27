<sub>[← Proteus](../README.md) · [The API](api.md) · [Automation](automation.md) · [Updates](updates.md) · [Limitations](limitations.md)</sub>

# Updates

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
- The checksum shows the file is the one the release holds. Who made the release is
  shown by a signature on the list of checksums, made with a key that never leaves the
  maker's machine ([`sign-release.mjs`](../release/sign-release.mjs)): a Proteus that
  knows the key takes only a release it signed. Releases up to preview 8 were not
  signed and know no key: they go by the checksum alone, and so take the first signed
  release, which brings the key; every update after it is checked against it.
- A working tree (and the `dist` folder made from one) is not a release and is not
  updated this way. Nor is a Proteus whose data folder is inside its program folder.
- If an update did not take, `update/apply.log` in the data folder says what the last
  attempt did.
