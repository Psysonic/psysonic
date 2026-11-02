#![cfg(all(target_os = "linux", any(feature = "use_zbus", feature = "use_dbus")))]

use std::{
    process::Command,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};

const PATH: &str = "/org/mpris/MediaPlayer2";
const APP: &str = "org.mpris.MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

#[test]
fn desktop_entry_on_private_bus() {
    // Give only the child process a fresh bus; never mutate the test runner's
    // environment or connect to a desktop session. dbus-run-session reaps its
    // daemon. The explicit config avoids host session configuration entirely.
    let output = Command::new("dbus-run-session")
        .arg(concat!(
            "--config-file=",
            env!("CARGO_MANIFEST_DIR"),
            "/tests/session.conf"
        ))
        .arg("--")
        .arg(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "private_bus_worker", "--nocapture"])
        .env("SOUVLAKI_PRIVATE_BUS_TEST", "1")
        .env_remove("DBUS_SESSION_BUS_ADDRESS")
        .output()
        .expect("install dbus-run-session to run the isolated MPRIS regression");
    assert!(
        output.status.success(),
        "private bus test failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
#[ignore = "spawned only by desktop_entry_on_private_bus inside dbus-run-session"]
fn private_bus_worker() {
    assert_eq!(
        std::env::var("SOUVLAKI_PRIVATE_BUS_TEST").as_deref(),
        Ok("1")
    );
    let client = backend::Client::new();
    for (case, (configured, expected)) in [
        (Some("Psysonic"), "Psysonic"),
        (Some("psysonic"), "psysonic"),
        (
            Some("io.github.psysonic.psysonic"),
            "io.github.psysonic.psysonic",
        ),
        (None, ""),
        (Some(""), ""),
    ]
    .iter()
    .enumerate()
    {
        assert_desktop_entry(&client, *configured, expected, case);
    }
}

fn assert_desktop_entry(
    client: &backend::Client,
    configured: Option<&str>,
    expected: &str,
    case: usize,
) {
    let dbus_name = format!("desktop_entry_test_{case}");
    let mut controls = MediaControls::new(PlatformConfig {
        dbus_name: &dbus_name,
        display_name: "Psysonic",
        desktop_entry: configured,
        hwnd: None,
    })
    .unwrap();
    let (tx, rx) = mpsc::channel();
    controls
        .attach(move |event| tx.send(event).unwrap())
        .unwrap();

    let name = format!("org.mpris.MediaPlayer2.{dbus_name}");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(identity) = client.get_string(&name, "Identity") {
            assert_eq!(identity, "Psysonic");
            break;
        }
        assert!(Instant::now() < deadline, "MPRIS service did not start");
        thread::sleep(Duration::from_millis(10));
    }

    // Actual Properties.Get/GetAll requests, not cached proxy values.
    assert_eq!(client.get_string(&name, "DesktopEntry").unwrap(), expected);
    assert_eq!(client.get_all_entry(&name), expected);
    let xml = client.introspect(&name);
    let entry_position = xml
        .find("name=\"DesktopEntry\"")
        .expect("missing DesktopEntry in introspection");
    let tag_start = xml[..entry_position].rfind("<property").unwrap();
    let tag_end = entry_position + xml[entry_position..].find('>').unwrap();
    let tag = &xml[tag_start..tag_end];
    assert!(tag.contains("type=\"s\""), "{}", tag);
    assert!(tag.contains("access=\"read\""), "{}", tag);
    assert!(
        client.write_entry_rejected(&name),
        "DesktopEntry must be read-only"
    );
    assert_eq!(client.get_string(&name, "DesktopEntry").unwrap(), expected);

    client.play(&name);
    assert_eq!(
        rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        MediaControlEvent::Play
    );
    controls.detach().unwrap();
}

// Only wire-type adapters differ; both backends exercise the same assertions
// through the public MediaControls new/attach path.
#[cfg(feature = "use_zbus")]
mod backend {
    use super::*;
    use std::{collections::HashMap, convert::TryFrom};
    use zbus::blocking::{Connection, Proxy};
    use zvariant::{OwnedValue, Value};

    pub struct Client(Connection);

    impl Client {
        pub fn new() -> Self {
            Self(Connection::session().unwrap())
        }

        fn proxy<'a>(&'a self, name: &'a str, interface: &'a str) -> Proxy<'a> {
            Proxy::new(&self.0, name, PATH, interface).unwrap()
        }

        pub fn get_string(&self, name: &str, property: &str) -> TestResult<String> {
            let value: OwnedValue = self
                .proxy(name, "org.freedesktop.DBus.Properties")
                .call("Get", &(APP, property))?;
            Ok(String::try_from(value)?)
        }

        pub fn get_all_entry(&self, name: &str) -> String {
            let mut all: HashMap<String, OwnedValue> = self
                .proxy(name, "org.freedesktop.DBus.Properties")
                .call("GetAll", &(APP,))
                .unwrap();
            String::try_from(all.remove("DesktopEntry").unwrap()).unwrap()
        }

        pub fn introspect(&self, name: &str) -> String {
            self.proxy(name, "org.freedesktop.DBus.Introspectable")
                .call("Introspect", &())
                .unwrap()
        }

        pub fn write_entry_rejected(&self, name: &str) -> bool {
            let result: zbus::Result<()> = self
                .proxy(name, "org.freedesktop.DBus.Properties")
                .call("Set", &(APP, "DesktopEntry", Value::new("changed")));
            result.is_err()
        }

        pub fn play(&self, name: &str) {
            let _: () = self.proxy(name, PLAYER).call("Play", &()).unwrap();
        }
    }
}

#[cfg(feature = "use_dbus")]
mod backend {
    use super::*;
    use dbus::blocking::{
        stdintf::org_freedesktop_dbus::{Introspectable, Properties},
        Connection, Proxy,
    };

    pub struct Client(Connection);

    impl Client {
        pub fn new() -> Self {
            Self(Connection::new_session().unwrap())
        }

        fn proxy<'a>(&'a self, name: &'a str) -> Proxy<'a, &'a Connection> {
            self.0.with_proxy(name, PATH, Duration::from_secs(2))
        }

        pub fn get_string(&self, name: &str, property: &str) -> TestResult<String> {
            Ok(self.proxy(name).get(APP, property)?)
        }

        pub fn get_all_entry(&self, name: &str) -> String {
            let all = self.proxy(name).get_all(APP).unwrap();
            all.get("DesktopEntry")
                .unwrap()
                .0
                .as_str()
                .unwrap()
                .to_owned()
        }

        pub fn introspect(&self, name: &str) -> String {
            self.proxy(name).introspect().unwrap()
        }

        pub fn write_entry_rejected(&self, name: &str) -> bool {
            self.proxy(name)
                .set(APP, "DesktopEntry", "changed")
                .is_err()
        }

        pub fn play(&self, name: &str) {
            let _: () = self.proxy(name).method_call(PLAYER, "Play", ()).unwrap();
        }
    }
}
