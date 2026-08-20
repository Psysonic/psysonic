#!/usr/bin/env bash
# Post-process a Tauri-built AppImage so its AppRun prefers the host WebKitGTK
# stack when one is available.
#
# Rationale: the AppImage bundles the Ubuntu build of WebKitGTK. On hosts with
# a newer graphics stack (Mesa/libglvnd on Fedora 42+, atomic distros like
# Bluefin/Silverblue) that build fails to create an EGL display
# (EGL_BAD_PARAMETER) and WebKitWebProcess aborts, leaving a blank window.
# The host WebKitGTK, when installed, is always a better fit; the bundled copy
# remains as a fallback for hosts without webkit2gtk-4.1.
#
# Usage: appimage-prefer-host-webkit.sh <path-to.AppImage>
# Requires: appimagetool (path via $APPIMAGETOOL, default: from $PATH).
set -euo pipefail

appimage="$(readlink -f "$1")"
appimagetool="${APPIMAGETOOL:-appimagetool}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
cd "$workdir"

"$appimage" --appimage-extract >/dev/null

apprun=squashfs-root/AppRun
# Sanity check: only patch the linuxdeploy-generated AppRun we know the shape of.
grep -q 'apprun-hooks' "$apprun" || {
    echo "error: unexpected AppRun format in $appimage, refusing to patch" >&2
    exit 1
}
grep -q 'PSYSONIC_FORCE_BUNDLED_WEBKIT' "$apprun" && {
    echo "AppRun already patched, nothing to do"
    exit 0
}

binary="$(ls squashfs-root/usr/bin)"
[ "$(echo "$binary" | wc -l)" -eq 1 ] || {
    echo "error: expected exactly one binary in usr/bin" >&2
    exit 1
}

block="$(cat <<'EOF'

# Prefer the host WebKitGTK stack when available. The bundled (Ubuntu) build of
# WebKitGTK is incompatible with newer host graphics stacks (Mesa/libglvnd on
# e.g. Fedora 42+): EGL display creation fails with EGL_BAD_PARAMETER and
# WebKitWebProcess aborts, leaving a blank window. LD_LIBRARY_PATH outranks the
# binary's RUNPATH ($ORIGIN/../lib), so pointing it at the host libdir makes
# every library resolve from the host instead of the bundled copies.
# Set PSYSONIC_FORCE_BUNDLED_WEBKIT=1 to skip this and use the bundled stack.
if [ -z "${PSYSONIC_FORCE_BUNDLED_WEBKIT:-}" ]; then
    host_webkit="$(ldconfig -p 2>/dev/null | awk '/libwebkit2gtk-4\.1\.so\.0 .*x86-64/{print $NF; exit}')"
    if [ -n "$host_webkit" ] && [ -e "$host_webkit" ]; then
        host_libdir="$(dirname "$host_webkit")"
        export LD_LIBRARY_PATH="$host_libdir${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        exec "$this_dir"/usr/bin/@BINARY@ "$@"
    fi
fi
EOF
)"
block="${block//@BINARY@/$binary}"

# ENVIRON (unlike awk -v) does not mangle backslash escapes in the block text.
BLOCK="$block" awk '{print} /^this_dir=/{print ENVIRON["BLOCK"]}' "$apprun" > "$apprun.new"
mv "$apprun.new" "$apprun"
chmod +x "$apprun"

ARCH=x86_64 "$appimagetool" squashfs-root "$appimage.patched" >/dev/null
mv "$appimage.patched" "$appimage"
echo "patched: $appimage"
