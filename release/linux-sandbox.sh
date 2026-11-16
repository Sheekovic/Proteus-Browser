#!/bin/sh
# Lets the Proteus kernel use its sandbox on Linux systems that restrict unprivileged
# user namespaces (Ubuntu 23.10 and later do, through AppArmor).
#
# The kernel isolates websites from your system with user namespaces. Where those are
# restricted, a program may use them only if an AppArmor profile says so; Chrome's
# installer adds one for Chrome, and this does the same for the kernel in this
# folder. Without it the kernel refuses to start ("No usable sandbox").
#
#   ./linux-sandbox.sh            say whether anything needs doing
#   sudo ./linux-sandbox.sh --install     add the profile (once; again if you move this folder)
#   sudo ./linux-sandbox.sh --remove      take it out again
here=$(cd "$(dirname "$0")" && pwd)
kernel="$here/kernel/chrome"
profile=/etc/apparmor.d/proteus-kernel
restricted=/proc/sys/kernel/apparmor_restrict_unprivileged_userns

needed() {
  [ -r "$restricted" ] && [ "$(cat "$restricted")" = "1" ]
}
installed() {
  [ -r "$profile" ] && grep -qF "\"$kernel\"" "$profile"
}

case "${1:-}" in
  --install)
    [ "$(id -u)" = "0" ] || { echo "Run this with sudo."; exit 1; }
    command -v apparmor_parser >/dev/null || { echo "AppArmor is not installed here; nothing to do."; exit 0; }
    cat > "$profile" <<EOF
# Added by Proteus (linux-sandbox.sh). Lets the Proteus kernel create the user
# namespaces its sandbox is made of. Remove with: sudo "$here/linux-sandbox.sh" --remove
abi <abi/4.0>,
include <tunables/global>

profile proteus-kernel "$kernel" flags=(unconfined) {
  userns,
  include if exists <local/proteus-kernel>
}
EOF
    apparmor_parser -r "$profile" && echo "Done. Proteus can now start with its sandbox on."
    ;;
  --remove)
    [ "$(id -u)" = "0" ] || { echo "Run this with sudo."; exit 1; }
    [ -e "$profile" ] || { echo "Nothing to remove."; exit 0; }
    apparmor_parser -R "$profile" 2>/dev/null
    rm -f "$profile" && echo "Removed."
    ;;
  --check)
    # For start-proteus.sh: succeeds when the kernel can use its sandbox as things are.
    ! needed || installed
    ;;
  *)
    if ! needed; then
      echo "Nothing to do: this system lets the kernel use its sandbox."
    elif installed; then
      echo "Already set up for $kernel"
    else
      echo "This system restricts the feature the kernel's sandbox is built on."
      echo "Run once:   sudo \"$here/linux-sandbox.sh\" --install"
    fi
    ;;
esac
