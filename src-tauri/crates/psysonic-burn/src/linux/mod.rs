//! The Linux burn backend: SG_IO straight to the drive.
//!
//! Linux has no IMAPI2 and no DiscRecording, so there is no library here to
//! disagree with — every command is one this crate builds. That makes it the
//! most direct of the three backends, and the one where `mmc/` and `cdtext/`
//! carry the most weight: the cue sheet, the Write Parameters page and the
//! CD-TEXT packs are the same tested code the Windows path burns with.
//!
//! Because there is no library layer, there is also no separate IMAPI2-style
//! fallback. Session-At-Once is the only write path, with or without CD-TEXT;
//! `sao::write_session` just leaves the lead-in alone when none was asked for.

mod sao;
mod sg;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::AppHandle;

use crate::cdrom_info::{parse_cdrom_info, CdromDrive};
use crate::mmc::scsi;
use crate::model::{
    BurnMediaInfo, BurnOptions, BurnOutcome, BurnPhase, BurnRecorder, BurnWriteCapabilities,
    CdTextVerification, DEFAULT_80_MIN_SECTORS,
};
use crate::render::RenderedTrack;
use sg::ScsiDevice;

/// Where the kernel lists optical drives.
const CDROM_INFO: &str = "/proc/sys/dev/cdrom/info";

/// Seconds for the short, informational commands.
const TIMEOUT_QUERY: u32 = 15;
/// A full blank rewrites the surface and genuinely takes this long.
const TIMEOUT_BLANK: u32 = 60 * 60;

/// Read the kernel's drive table.
///
/// One big read, deliberately, rather than `read_to_string`: files under
/// `/proc/sys` come from the sysctl interface, which reports a size of zero and
/// serves the whole table in a single read. `read_to_string` sizes its buffer
/// from that zero, takes one short chunk and then sees EOF — it came back with
/// 32 bytes here, the first line cut mid-word, and every drive silently
/// vanished because the parser was handed a truncated table.
fn read_kernel_table(path: &str) -> Option<String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).ok()?;
    // Comfortably larger than the table for any plausible number of drives.
    let mut buffer = vec![0_u8; 16 * 1024];
    let read = file.read(&mut buffer).ok()?;
    buffer.truncate(read);
    String::from_utf8(buffer).ok()
}

fn drives() -> Vec<CdromDrive> {
    read_kernel_table(CDROM_INFO)
        .map(|text| parse_cdrom_info(&text))
        .unwrap_or_default()
}

/// Only `/dev/srN` paths this machine actually reported, so a recorder id
/// coming back from the frontend can never open an arbitrary file.
fn resolve(recorder_id: &str) -> Result<CdromDrive, String> {
    drives()
        .into_iter()
        .find(|drive| drive.device_path() == recorder_id || drive.name == recorder_id)
        .ok_or_else(|| format!("no optical drive called {recorder_id} is attached"))
}

/// A drive's model name, from sysfs. Cosmetic, so a failure is not an error.
fn model_name(drive: &CdromDrive) -> String {
    let read = |field: &str| {
        std::fs::read_to_string(format!("/sys/block/{}/device/{field}", drive.name))
            .map(|value| value.trim().to_string())
            .unwrap_or_default()
    };
    let label = format!("{} {}", read("vendor"), read("model"))
        .trim()
        .to_string();
    if label.is_empty() {
        drive.name.clone()
    } else {
        label
    }
}

/// What the drive says it can do, from feature `002Eh`.
fn capabilities(device: &ScsiDevice) -> BurnWriteCapabilities {
    let mut buffer = [0_u8; 64];
    let cdb = scsi::get_configuration_cdb(scsi::FEATURE_CD_MASTERING, buffer.len() as u16);
    match device.receive(&cdb, &mut buffer, TIMEOUT_QUERY) {
        Ok(read) => scsi::parse_cd_mastering_feature(&buffer[..read]).unwrap_or_default(),
        // A drive that will not answer is reported as not having answered,
        // never as incapable: the UI says different things about the two.
        Err(_) => BurnWriteCapabilities::default(),
    }
}

pub fn list_recorders() -> Result<Vec<BurnRecorder>, String> {
    let mut recorders = Vec::new();

    for drive in drives() {
        let caps = ScsiDevice::open(std::path::Path::new(&drive.device_path()), false)
            .ok()
            .map(|device| capabilities(&device))
            .unwrap_or_default();

        recorders.push(BurnRecorder {
            id: drive.device_path(),
            name: model_name(&drive),
            volume_paths: vec![drive.device_path()],
            can_write_cd: drive.can_write_cd(),
            supports_cd_text: caps.can_write_cd_text(),
            capabilities: caps,
        });
    }

    Ok(recorders)
}

pub fn probe_media(recorder_id: &str) -> Result<BurnMediaInfo, String> {
    let drive = resolve(recorder_id)?;
    let device = ScsiDevice::open(std::path::Path::new(&drive.device_path()), false)?;

    let empty = BurnMediaInfo {
        present: false,
        blank: false,
        erasable: false,
        media_type: String::new(),
        capacity_sectors: 0,
        write_speeds: Vec::new(),
        blocker: Some("No disc in the drive.".to_string()),
    };

    // No disc, or one the drive has not finished looking at.
    if device
        .execute(&scsi::test_unit_ready_cdb(), TIMEOUT_QUERY)
        .is_err()
    {
        return Ok(empty);
    }

    let mut config = [0_u8; 32];
    let read = device
        .receive(
            &scsi::get_configuration_header_cdb(config.len() as u16),
            &mut config,
            TIMEOUT_QUERY,
        )
        .unwrap_or(0);
    let Some(profile) = scsi::parse_current_profile(&config[..read]) else {
        return Ok(empty);
    };

    let media_type = scsi::profile_label(profile).to_string();
    let erasable = profile == scsi::PROFILE_CD_RW;
    let is_cd = matches!(
        profile,
        scsi::PROFILE_CD_ROM | scsi::PROFILE_CD_R | scsi::PROFILE_CD_RW
    );

    // The drive's own answer, the same one the Windows path had to fall back to
    // asking for after IMAPI2's heuristic proved unreliable after a rehearsal.
    let status = disc_status(&device);
    let blank = status == Some(scsi::DiscStatus::Empty);

    let capacity_sectors = disc_capacity_sectors(&device).unwrap_or(DEFAULT_80_MIN_SECTORS);

    let blocker = if !is_cd {
        Some(format!(
            "This is {media_type}. Audio CDs need a blank CD-R or CD-RW."
        ))
    } else if profile == scsi::PROFILE_CD_ROM {
        Some("This is a pressed CD-ROM and cannot be written to.".to_string())
    } else if status.is_none() {
        Some("The drive would not describe this disc.".to_string())
    } else if !blank {
        Some(if erasable {
            "This CD-RW already holds data. Erase it before burning.".to_string()
        } else {
            "This CD-R is not blank. Audio CDs must be written in one go.".to_string()
        })
    } else {
        None
    };

    Ok(BurnMediaInfo {
        present: true,
        blank: blank && is_cd && profile != scsi::PROFILE_CD_ROM,
        erasable,
        media_type,
        capacity_sectors,
        // Speed selection is not offered on this backend yet; the drive picks.
        write_speeds: Vec::new(),
        blocker,
    })
}

/// `READ DISC INFORMATION` byte 2, bits 1..0.
fn disc_status(device: &ScsiDevice) -> Option<scsi::DiscStatus> {
    let mut buffer = [0_u8; 34];
    let cdb = crate::mmc::read_disc_information_cdb(buffer.len() as u16);
    let read = device.receive(&cdb, &mut buffer, TIMEOUT_QUERY).ok()?;
    if read < 3 {
        return None;
    }
    Some(scsi::DiscStatus::from_disc_information(buffer[2]))
}

/// The disc's usable capacity, in sectors.
///
/// ATIP first: a blank CD-R has no table of contents, so the last possible
/// lead-out start is the only place its capacity is written down. A disc that
/// already has a TOC answers from that instead. Falling back to the 80-minute
/// assumption is safe — the planner refuses anything that will not fit
/// whichever number it gets — but getting it right matters, because a capacity
/// read from the wrong descriptor looks entirely plausible.
fn disc_capacity_sectors(device: &ScsiDevice) -> Option<u32> {
    let mut atip = [0_u8; 32];
    let cdb = scsi::read_toc_cdb(scsi::TOC_FORMAT_ATIP, 0, atip.len() as u16);
    if let Ok(read) = device.receive(&cdb, &mut atip, TIMEOUT_QUERY) {
        if let Some(sectors) = scsi::parse_atip_capacity(&atip[..read]) {
            return Some(sectors);
        }
    }

    let mut toc = [0_u8; 64];
    let cdb = scsi::read_toc_cdb(scsi::TOC_FORMAT_TOC, scsi::TRACK_LEAD_OUT, toc.len() as u16);
    let read = device.receive(&cdb, &mut toc, TIMEOUT_QUERY).ok()?;
    scsi::parse_toc_lead_out(&toc[..read])
}

/// A cheap fingerprint of what is in the drive.
///
/// Polled while the burner page is open so an inserted disc is noticed without
/// the user hunting for Refresh. Deliberately not a full `probe_media`: that
/// reads ATIP and the TOC, which can make the drive seek, and doing it every
/// few seconds would keep the drive awake for nothing.
///
/// Two small commands, neither of which moves the head: the current profile
/// says whether there is a disc and what kind, and the disc status says whether
/// it is still blank - which is what changes after a rehearsal.
pub fn media_state(recorder_id: &str) -> Result<String, String> {
    let drive = resolve(recorder_id)?;
    let Ok(device) = ScsiDevice::open(std::path::Path::new(&drive.device_path()), false) else {
        // A drive that will not open is reported as empty rather than as an
        // error: the poll runs constantly and must never raise a toast.
        return Ok("unavailable".to_string());
    };

    let mut config = [0_u8; 32];
    let profile = device
        .receive(
            &scsi::get_configuration_header_cdb(config.len() as u16),
            &mut config,
            TIMEOUT_QUERY,
        )
        .ok()
        .and_then(|read| scsi::parse_current_profile(&config[..read]));

    let Some(profile) = profile else {
        return Ok("empty".to_string());
    };

    let status = disc_status(&device);
    Ok(format!("{profile:04x}:{status:?}"))
}

pub fn burn(
    app: AppHandle,
    job_id: String,
    tracks: Vec<RenderedTrack>,
    options: BurnOptions,
    cancel: Arc<AtomicBool>,
) -> Result<BurnOutcome, String> {
    let drive = resolve(&options.recorder_id)?;
    // Exclusive from here: the desktop's automounter poking the drive during a
    // write is exactly the kind of interruption that spoils a CD-R.
    let device = ScsiDevice::open(std::path::Path::new(&drive.device_path()), true)?;

    crate::job::emit_progress(&app, &job_id, BurnPhase::Preparing, None, 0, 0, None);

    let caps = capabilities(&device);
    let block = if options.cd_text && caps.can_write_cd_text() {
        crate::linux::sao::cd_text_block(&options, &tracks)
    } else {
        None
    };

    if options.cd_text && block.is_none() {
        crate::app_eprintln!("[burn] CD-TEXT was asked for but this drive cannot write it");
    }

    let sectors = sao::write_session(
        &app,
        &job_id,
        &device,
        &tracks,
        block.as_ref(),
        options
            .media_catalog_number
            .as_deref()
            .filter(|c| !c.trim().is_empty()),
        options.test_write,
        caps.buffer_underrun_free,
        &cancel,
    )?;

    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }

    crate::job::emit_progress(
        &app,
        &job_id,
        BurnPhase::Closing,
        None,
        sectors,
        sectors,
        None,
    );

    // Read back rather than trust the write. A rehearsal wrote nothing, so
    // there is nothing to confirm and asking would only report a false absence.
    let verification = (block.is_some() && !options.test_write).then(|| read_cd_text(&device));

    // A rehearsal leaves the drive holding a session it opened and never closed,
    // so it stops reporting the disc as blank until the medium is reloaded -
    // confirmed on this drive, where a clean test write was immediately followed
    // by "This CD-R is not blank". Clearing that is not a convenience eject, it
    // is what keeps the disc usable, so it happens whatever the option says.
    if options.test_write || options.eject_when_done {
        let _ = device.reload();
    }

    Ok(BurnOutcome {
        sectors,
        cd_text_written: block.is_some(),
        cd_text_verification: verification,
    })
}

/// Read the disc's CD-TEXT back and count the packs that pass their CRC.
fn read_cd_text(device: &ScsiDevice) -> CdTextVerification {
    let mut buffer = vec![0_u8; 4 + 2048];
    // Format 0101b is the CD-TEXT the lead-in carries.
    let cdb = scsi::read_toc_cdb(0x05, 0, buffer.len().min(u16::MAX as usize) as u16);
    let Ok(read) = device.receive(&cdb, &mut buffer, TIMEOUT_QUERY) else {
        return CdTextVerification::unreadable(
            "the drive would not report the disc's CD-TEXT",
        );
    };
    // Four bytes of TOC header, then whole 18-byte packs.
    if read <= 4 {
        return CdTextVerification::found(0);
    }
    CdTextVerification::found(crate::cdtext::count_valid_packs(&buffer[4..read]) as u32)
}

pub fn verify_cd_text(recorder_id: &str) -> Result<CdTextVerification, String> {
    let drive = resolve(recorder_id)?;
    let device = ScsiDevice::open(std::path::Path::new(&drive.device_path()), false)?;
    Ok(read_cd_text(&device))
}

pub fn erase(recorder_id: &str, quick: bool) -> Result<(), String> {
    let drive = resolve(recorder_id)?;
    let device = ScsiDevice::open(std::path::Path::new(&drive.device_path()), true)?;
    device
        .execute(&scsi::blank_cdb(quick), TIMEOUT_BLANK)
        .map_err(|e| format!("the disc could not be erased: {e}"))
}

pub fn reload_media(recorder_id: &str) -> Result<(), String> {
    let drive = resolve(recorder_id)?;
    let device = ScsiDevice::open(std::path::Path::new(&drive.device_path()), false)?;
    device.reload()
}
