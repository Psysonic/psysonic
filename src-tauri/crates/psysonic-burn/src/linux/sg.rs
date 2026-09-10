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

use crate::mmc::scsi::describe_sense;

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
        self.transfer(cdb, SG_DXFER_NONE, &mut [], timeout_s).map(|_| ())
    }

    /// Send a command that carries data to the drive.
    pub fn send(&self, cdb: &[u8], data: &[u8], timeout_s: u32) -> Result<(), ScsiError> {
        // The kernel does not write to the buffer on a to-device transfer, but
        // the header field is not const, so the copy buys a sound `&mut`
        // rather than casting one out of a shared reference.
        let mut owned = data.to_vec();
        self.transfer(cdb, SG_DXFER_TO_DEV, &mut owned, timeout_s)
            .map(|_| ())
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

/// Pull the key/ASC/ASCQ out of a sense buffer, fixed or descriptor format.
///
/// Response code `72h`/`73h` is the descriptor format, where the three live in
/// different bytes from the fixed format every older drive uses. Reading the
/// fixed offsets out of a descriptor buffer yields a plausible-looking and
/// entirely wrong diagnosis.
///
/// The two formats also need different amounts of the buffer filled in, so the
/// length is checked per format rather than once up front. A descriptor buffer
/// carries all three bytes by offset 3, so four is all it needs, where the
/// fixed format cannot answer until byte 13. Holding both to fourteen threw
/// away sense that was short but complete: a drive answering a write with a
/// descriptor 2/04/08 then looked undiagnosable and was never retried.
fn sense_triplet(sense: &[u8], written: usize) -> Option<(u8, u8, u8)> {
    let len = written.min(sense.len());
    if len < 4 {
        return None;
    }
    match sense[0] & 0x7F {
        0x72 | 0x73 => Some((sense[1] & 0x0F, sense[2], sense[3])),
        _ if len >= 14 => Some((sense[2] & 0x0F, sense[12], sense[13])),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_format_sense_reads_from_the_classic_offsets() {
        let mut sense = [0_u8; 32];
        sense[0] = 0x70;
        sense[2] = 0x05;
        sense[12] = 0x24;
        sense[13] = 0x00;
        assert_eq!(sense_triplet(&sense, 18), Some((0x05, 0x24, 0x00)));
    }

    #[test]
    fn descriptor_format_sense_reads_from_its_own_offsets() {
        // The same failure in the newer layout. Reading bytes 2/12/13 here
        // would report a completely different fault.
        let mut sense = [0_u8; 32];
        sense[0] = 0x72;
        sense[1] = 0x05;
        sense[2] = 0x24;
        sense[3] = 0x00;
        assert_eq!(sense_triplet(&sense, 18), Some((0x05, 0x24, 0x00)));
    }

    #[test]
    fn a_descriptor_header_on_its_own_is_enough_to_diagnose() {
        // Eight bytes is a whole descriptor header, and the key, ASC and ASCQ
        // all live inside it. The retryable lead-in sense arrives this way.
        let mut sense = [0_u8; 32];
        sense[0] = 0x72;
        sense[1] = 0x02;
        sense[2] = 0x04;
        sense[3] = 0x08;
        assert_eq!(sense_triplet(&sense, 8), Some((0x02, 0x04, 0x08)));
    }

    #[test]
    fn a_truncated_sense_buffer_is_not_guessed_at() {
        let sense = [0_u8; 32];
        assert_eq!(sense_triplet(&sense, 4), None);
    }

    #[test]
    fn a_short_fixed_format_buffer_is_not_guessed_at_either() {
        // Fixed format keeps ASC and ASCQ at bytes 12 and 13, so eight bytes
        // says nothing about them and the zeros sitting there must not be read
        // as a diagnosis.
        let mut sense = [0_u8; 32];
        sense[0] = 0x70;
        sense[2] = 0x05;
        assert_eq!(sense_triplet(&sense, 8), None);
    }
}
