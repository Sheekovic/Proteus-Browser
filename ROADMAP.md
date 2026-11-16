# Roadmap

What is being worked on, in order, and what is done. An item is ticked when it is
built, tested and committed, not when it is started. Items are added as real use
shows what is missing; the ones marked *(needs)* wait for something outside the code.

## 1. Proxies you can rely on

A profile is only as good as its proxy, and proxies are where real use differs most
from tests.

- [x] Survive a residential proxy: time limits, several lookup services, retries, IPv4 for WebRTC
- [x] Check a proxy before using it: where it comes out, how fast, from the UI, the API and MCP
- [ ] SOCKS5 against a real provider
- [ ] A long session: what happens when the exit changes or goes away while browsing

## 2. Managing many profiles

- [x] Edit a profile from the interface (name, proxy, place, start page)
- [x] Duplicate a profile
- [x] Create many at once, each with its own identity and its own proxy from a list
- [x] Cookies in the interface: export a profile's, import a session into it
- [x] Tags, and filtering by them

## 3. Proof that it works

- [ ] The whole kernel test suite and the end-to-end test on Linux, on the current kernel
- [ ] The Linux sandbox helper's install step, run for real *(needs: leave to change AppArmor on a test machine)*
- [ ] A scheduled check of the public detection sites, so a regression is noticed
- [ ] Windows 10, macOS hosts *(needs: machines)*

## 4. A kernel that gives less away

- [ ] Media devices: the number and kind of cameras, microphones and speakers from the profile
- [ ] Generated identities with a graphics card's real capabilities *(needs: readings from more devices)*
- [ ] Battery and network information that fit the claimed device
- [ ] The TLS handshake of a non-Chrome identity *(large: another network stack's fingerprint)*
- [ ] A Firefox kernel *(large: a second engine)*

## 5. Shipping

- [x] Preview bundles for Windows and Linux that run as they are
- [ ] An optimised "official" build
- [ ] An installer, and a signed one *(needs: a code-signing certificate)*
- [ ] Release builds made by one command on the build server

## Done before this list existed

Kernel patches 0001–0025 (identity, hardware, graphics and their capabilities, canvas,
WebGL and audio noise, fonts, locale, WebRTC, geolocation, voices, phone profiles,
Safari-on-iPhone profiles, the Proteus name and icon); the manager with its
interface, API and MCP endpoint; device readings from real hardware; the website with
its browser test; automated manager tests on every push.
