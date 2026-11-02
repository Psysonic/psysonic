use std::ffi::c_void;

/// OS-specific configuration needed to create media controls.
#[derive(Debug)]
pub struct PlatformConfig<'a> {
    /// The name to be displayed to the user. (*Required on Linux*)
    pub display_name: &'a str,
    /// Should follow [the D-Bus spec](https://dbus.freedesktop.org/doc/dbus-specification.html#message-protocol-names-bus). (*Required on Linux*)
    pub dbus_name: &'a str,
    /// Installed desktop filename without `.desktop`, preserving case. (Linux only)
    /// `None` exports an empty MPRIS DesktopEntry string.
    pub desktop_entry: Option<&'a str>,
    /// An HWND. (*Required on Windows*)
    pub hwnd: Option<*mut c_void>,
}
