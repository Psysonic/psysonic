//! `SG_IO`: sending SCSI command blocks to an optical drive on Linux.
//!
//! This is the whole of the platform difference. Windows reaches the drive
//! through `IDiscRecorder2Ex::SendCommand*`, which is IMAPI2 wrapping the same
//! commands; here the ioctl is the wrapper, and everything above it — the cue
//! sheet, the mode page, the CD-TEXT packs — is the shared, tested code in
//! `mmc/` and `cdtext/`.
//!
//! No exclusive-access dance: Linux has no equivalent of
//! `AcquireExclusiveAccess`, and an `O_EXCL` open on the block device is what
//! keeps other programs (and the desktop's own automounter) off the drive
//! while a burn is running.

use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

use crate::mmc::scsi::{describe_sense, sense_triplet};

/// The ioctl itself.
const SG_IO: libc::c_ulong = 0x2285;

/// `sg_io_hdr_t::interface_id` must be `'S'` or the kernel rejects the call.
const INTERFACE_ID_SCSI: libc::c_int = b'S' as libc::c_int;

/// `dxfer_direction` values.
const SG_DXFER_NONE: libc::c_int = -1;
const SG_DXFER_TO_DEV: libc::c_int = -2;
const SG_DXFER_FROM_DEV: libc::c_int = -3;

/// Eject and close the tray, for the reload that clears stale drive state.
const CDROMEJECT: libc::c_ulong = 0x5309;
const CDROMCLOSETRAY: libc::c_ulong = 0x5319;

/// Bytes of sense data asked for on every command.
const SENSE_LEN: usize = 32;

/// The kernel's `sg_io_hdr_t`, field for field.
///
/// The layout is ABI, not a convenience: a mismatch here does not fail to
/// compile, it sends a drive a command built from the wrong bytes.
#[repr(C)]
struct SgIoHdr {
    interface_id: libc::c_int,
    dxfer_direction: libc::c_int,
    cmd_len: libc::c_uchar,
    mx_sb_len: libc::c_uchar,
    iovec_count: libc::c_ushort,
    dxfer_len: libc::c_uint,
    dxferp: *mut libc::c_void,
    cmdp: *mut libc::c_uchar,
    sbp: *mut libc::c_uchar,
    timeout: libc::c_uint,
    flags: libc::c_uint,
    pack_id: libc::c_int,
    usr_ptr: *mut libc::c_void,
    status: libc::c_uchar,
    masked_status: libc::c_uchar,
    msg_status: libc::c_uchar,
    sb_len_wr: libc::c_uchar,
    host_status: libc::c_ushort,
    driver_status: libc::c_ushort,
    resid: libc::c_int,
    duration: libc::c_uint,
    info: libc::c_uint,
}

/// What went wrong, in terms a caller can act on.
#[derive(Debug)]
pub struct ScsiError {
    /// Human-readable, already including the decoded sense.
    pub message: String,
    /// Sense key, ASC and ASCQ, when the drive supplied them.
    pub sense: Option<(u8, u8, u8)>,
}

impl ScsiError {
    fn io(context: &str, error: std::io::Error) -> Self {
        Self {
            message: format!("{context}: {error}"),
            sense: None,
        }
    }
}

impl std::fmt::Display for ScsiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// An opened optical drive.
pub struct ScsiDevice {
    file: File,
    path: String,
}

impl ScsiDevice {
    /// Open a drive for commands.
    ///
    /// `O_NONBLOCK` matters: without it, opening `/dev/sr0` with no disc in it
    /// blocks until one appears, which would hang a drive listing on an empty
    /// tray. `O_EXCL` keeps everything else off the drive for the session.
    pub fn open(path: &Path, exclusive: bool) -> Result<Self, String> {
        let mut flags = libc::O_NONBLOCK;
        if exclusive {
            flags |= libc::O_EXCL;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(flags)
            .open(path)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::PermissionDenied => format!(
                    "no permission to use {}. Adding your user to the `cdrom` group \
                     and logging back in is the usual fix.",
                    path.display()
                ),
                _ => format!("could not open {}: {e}", path.display()),
            })?;
        Ok(Self {
            file,
            path: path.display().to_string(),
        })
    }

    /// Send a command with no data phase.
    pub fn execute(&self, cdb: &[u8], timeout_s: u32) -> Result<(), ScsiError> {
        self.transfer(cdb, SG_DXFER_NONE, &mut [], timeout_s)
            .map(|_| ())
    }

    /// Send a command that carries data to the drive.
    ///
    /// GOOD status is not the whole answer. usb-storage reports data that never
    /// reached the drive as a residue *alongside* GOOD — a USB controller has
    /// been seen stopping a `WRITE(10)` after 9 216 of 32 768 bytes with exactly
    /// that result — so a send the drive was handed less of is a failure. Some
    /// bridges report a residue that is not real; the kernel's quirk list
    /// (`US_FL_IGNORE_RESIDUE`) makes usb-storage ignore it for those.
    pub fn send(&self, cdb: &[u8], data: &[u8], timeout_s: u32) -> Result<(), ScsiError> {
        // The kernel does not write to the buffer on a to-device transfer, but
        // the header field is not const, so the copy buys a sound `&mut`
        // rather than casting one out of a shared reference.
        let mut owned = data.to_vec();
        let moved = self.transfer(cdb, SG_DXFER_TO_DEV, &mut owned, timeout_s)?;
        if moved < data.len() {
            return Err(ScsiError {
                message: format!(
                    "the drive's connection delivered {moved} of {} bytes",
                    data.len()
                ),
                sense: None,
            });
        }
        Ok(())
    }

    /// Send a command that reads data back, returning how many bytes arrived.
    pub fn receive(
        &self,
        cdb: &[u8],
        buffer: &mut [u8],
        timeout_s: u32,
    ) -> Result<usize, ScsiError> {
        self.transfer(cdb, SG_DXFER_FROM_DEV, buffer, timeout_s)
    }

    fn transfer(
        &self,
        cdb: &[u8],
        direction: libc::c_int,
        buffer: &mut [u8],
        timeout_s: u32,
    ) -> Result<usize, ScsiError> {
        let mut sense = [0_u8; SENSE_LEN];
        let mut cdb_owned = cdb.to_vec();

        let mut header = SgIoHdr {
            interface_id: INTERFACE_ID_SCSI,
            dxfer_direction: direction,
            cmd_len: cdb_owned.len() as libc::c_uchar,
            mx_sb_len: SENSE_LEN as libc::c_uchar,
            iovec_count: 0,
            dxfer_len: buffer.len() as libc::c_uint,
            dxferp: if buffer.is_empty() {
                std::ptr::null_mut()
            } else {
                buffer.as_mut_ptr().cast()
            },
            cmdp: cdb_owned.as_mut_ptr(),
            sbp: sense.as_mut_ptr(),
            timeout: timeout_s.saturating_mul(1000),
            flags: 0,
            pack_id: 0,
            usr_ptr: std::ptr::null_mut(),
            status: 0,
            masked_status: 0,
            msg_status: 0,
            sb_len_wr: 0,
            host_status: 0,
            driver_status: 0,
            resid: 0,
            duration: 0,
            info: 0,
        };

        // SAFETY: `header` is a correctly shaped `sg_io_hdr_t` whose three
        // pointers address live local buffers, each with the length recorded in
        // the matching field. The call borrows them only for its duration.
        let rc = unsafe { libc::ioctl(self.file.as_raw_fd(), SG_IO, &raw mut header) };
        if rc < 0 {
            return Err(ScsiError::io(
                &format!("the drive rejected a command on {}", self.path),
                std::io::Error::last_os_error(),
            ));
        }

        // A command can fail three ways: the ioctl itself (above), the drive
        // (status plus sense), or the transport (host/driver). All three have to
        // be checked, or a refused write reads as a successful one.
        //
        // The drive is asked first because the kernel raises DRIVER_SENSE in
        // `driver_status` on every CHECK CONDITION, purely to say the sense
        // buffer is worth reading. Testing the transport ahead of the status
        // turned every refusal the drive had explained into "the drive's
        // connection failed" and discarded the sense along with it, costing the
        // caller both the real message and the 2/04/08 backoff that carries
        // every write on this path — the lead-in and the program area alike —
        // past a drive that is briefly not ready.
        if header.status != 0 {
            let decoded = sense_triplet(&sense, header.sb_len_wr as usize);
            return Err(ScsiError {
                message: match decoded {
                    Some((key, asc, ascq)) => describe_sense(key, asc, ascq),
                    None => format!("the drive reported status {:#04x}", header.status),
                },
                sense: decoded,
            });
        }

        if header.host_status != 0 || header.driver_status != 0 {
            return Err(ScsiError {
                message: format!(
                    "the drive's connection failed (host {:#06x}, driver {:#06x})",
                    header.host_status, header.driver_status
                ),
                sense: None,
            });
        }

        let moved = buffer.len().saturating_sub(header.resid.max(0) as usize);
        Ok(moved)
    }

    /// Eject the disc, then ask for the tray back.
    pub fn reload(&self) -> Result<(), String> {
        // SAFETY: both take no argument beyond the descriptor.
        let ejected = unsafe { libc::ioctl(self.file.as_raw_fd(), CDROMEJECT) };
        if ejected < 0 {
            return Err(format!(
                "the drive would not eject the disc: {}",
                std::io::Error::last_os_error()
            ));
        }
        // Slot and slim drives have no motorised tray; the disc is out, which
        // is enough for the user to push it back in themselves.
        // SAFETY: as above.
        unsafe { libc::ioctl(self.file.as_raw_fd(), CDROMCLOSETRAY) };
        Ok(())
    }
}
