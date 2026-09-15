//! Reading `/proc/sys/dev/cdrom/info`, the kernel's own drive table.
//!
//! Only the Linux backend uses this, but the parsing is pure and the file's
//! layout is the fiddly part, so it lives at the crate root and compiles
//! everywhere: the tests then run on any machine rather than only on the one
//! platform that can use the result.
//!
//! Asking the kernel beats probing the hardware. Listing drives should not
//! spin up every optical device in the machine just to find out it can write,
//! and this file already knows.

/// One drive, as the kernel describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdromDrive {
    /// Kernel name, e.g. `sr0`.
    pub name: String,
    pub can_write_cd_r: bool,
    pub can_write_cd_rw: bool,
}

impl CdromDrive {
    /// `/dev/sr0` and the like.
    pub fn device_path(&self) -> String {
        format!("/dev/{}", self.name)
    }

    /// Anything that can put a track on a CD.
    pub fn can_write_cd(&self) -> bool {
        self.can_write_cd_r || self.can_write_cd_rw
    }
}

/// Parse the whole file.
///
/// The layout is one row per property with a column per drive, so the drives
/// are read down the "drive name:" row and every later row is indexed by
/// position. A row shorter than the name row means the kernel told us less
/// than we asked; the missing columns are taken as "no", never as "yes".
pub fn parse_cdrom_info(text: &str) -> Vec<CdromDrive> {
    let names = row(text, "drive name").unwrap_or_default();
    if names.is_empty() {
        return Vec::new();
    }
    let cd_r = row(text, "Can write CD-R").unwrap_or_default();
    let cd_rw = row(text, "Can write CD-RW").unwrap_or_default();

    names
        .iter()
        .enumerate()
        .map(|(index, name)| CdromDrive {
            name: (*name).to_string(),
            can_write_cd_r: flag_at(&cd_r, index),
            can_write_cd_rw: flag_at(&cd_rw, index),
        })
        .collect()
}

/// The values on the row with this label, in column order.
fn row<'a>(text: &'a str, label: &str) -> Option<Vec<&'a str>> {
    text.lines()
        .find(|line| line.trim_start().starts_with(label))
        .and_then(|line| line.split_once(':'))
        .map(|(_, values)| values.split_whitespace().collect())
}

/// `1` is yes; anything else, including a missing column, is no.
fn flag_at(values: &[&str], index: usize) -> bool {
    values.get(index).is_some_and(|value| *value == "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two drives, as the kernel lays them out: newest device first.
    const TWO_DRIVES: &str = "\
CD-ROM information, Id: cdrom.c 3.20 2003/12/17

drive name:\t\tsr1\tsr0
drive speed:\t\t24\t48
drive # of slots:\t1\t1
Can close tray:\t\t1\t1
Can open tray:\t\t1\t1
Can read multisession:\t1\t1
Can write CD-R:\t\t0\t1
Can write CD-RW:\t0\t1
Can write DVD-R:\t0\t0
";

    #[test]
    fn every_drive_in_the_table_is_listed() {
        let drives = parse_cdrom_info(TWO_DRIVES);
        assert_eq!(drives.len(), 2);
        assert_eq!(drives[0].name, "sr1");
        assert_eq!(drives[1].name, "sr0");
    }

    #[test]
    fn write_capability_follows_the_column_not_the_order_found() {
        // sr1 is a reader, sr0 a writer. Reading the row without tracking the
        // column would swap them and offer a burn on the wrong drive.
        let drives = parse_cdrom_info(TWO_DRIVES);
        assert!(!drives[0].can_write_cd());
        assert!(drives[1].can_write_cd());
        assert!(drives[1].can_write_cd_r);
        assert!(drives[1].can_write_cd_rw);
    }

    #[test]
    fn device_paths_are_built_from_the_kernel_name() {
        let drives = parse_cdrom_info(TWO_DRIVES);
        assert_eq!(drives[1].device_path(), "/dev/sr0");
    }

    #[test]
    fn a_machine_with_no_optical_drive_yields_nothing() {
        // What the file looks like with the module loaded but no hardware.
        let empty = "CD-ROM information, Id: cdrom.c 3.20 2003/12/17\n\ndrive name:\n";
        assert!(parse_cdrom_info(empty).is_empty());
    }

    #[test]
    fn a_missing_file_is_not_a_drive() {
        assert!(parse_cdrom_info("").is_empty());
    }

    #[test]
    fn a_short_row_reads_as_no_rather_than_yes() {
        // Only one capability column for two drives. The absent one must not
        // inherit the present one's answer.
        let ragged = "drive name:\t\tsr1\tsr0\nCan write CD-R:\t\t1\n";
        let drives = parse_cdrom_info(ragged);
        assert!(drives[0].can_write_cd_r);
        assert!(!drives[1].can_write_cd_r);
    }

    #[test]
    fn cd_r_and_cd_rw_rows_are_told_apart() {
        // "Can write CD-R" is a prefix of "Can write CD-RW", so a naive
        // starts_with would read the RW row for both.
        let drives = parse_cdrom_info("drive name:\t\tsr0\nCan write CD-R:\t\t0\nCan write CD-RW:\t1\n");
        assert!(!drives[0].can_write_cd_r);
        assert!(drives[0].can_write_cd_rw);
    }
}
