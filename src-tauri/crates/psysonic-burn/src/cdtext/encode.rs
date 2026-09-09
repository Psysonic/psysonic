//! Building CD-TEXT packs.
//!
//! Text items for one pack type are concatenated NUL-terminated and cut into
//! 12-byte payloads. Disc-level text is item 0; tracks are items 1..n. Every
//! pack records which item its *first* byte belongs to and how much of that
//! item already went out, so a player can resynchronise mid-stream.

use super::crc::pack_crc;
use super::{CdTextInput, CHARSET_ISO_8859_1, LANGUAGE_ENGLISH};

/// Bytes in one CD-TEXT pack: 4 header + 12 payload + 2 CRC.
pub const PACK_BYTES: usize = 18;

/// Payload bytes per pack.
const PAYLOAD_BYTES: usize = 12;

/// Pack types this encoder emits.
const PACK_TITLE: u8 = 0x80;
const PACK_PERFORMER: u8 = 0x81;
const PACK_SIZE_INFO: u8 = 0x8F;

/// Red Book track ceiling; also the highest track number a pack can name.
const MAX_TRACKS: usize = 99;

/// A block may not exceed 255 packs — the sequence number is one byte, and the
/// SIZE_INFO record stores the highest sequence number in one byte too.
const MAX_PACKS: usize = 255;

/// Block number. One block = one language; we ship block 0.
const BLOCK_NUMBER: u8 = 0;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CdTextError {
    /// Nothing to write — no disc title, no performer, no track text.
    Empty,
    /// More tracks than a CD can hold.
    TooManyTracks(usize),
    /// The text does not fit in a single 255-pack block.
    TooMuchText { packs: usize },
}

impl std::fmt::Display for CdTextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CdTextError::Empty => write!(f, "there is no CD-TEXT to write"),
            CdTextError::TooManyTracks(count) => {
                write!(f, "a CD holds at most {MAX_TRACKS} tracks; got {count}")
            }
            CdTextError::TooMuchText { packs } => write!(
                f,
                "the titles and performers need {packs} CD-TEXT packs but a block holds {MAX_PACKS}; \
                 shorten the longest names"
            ),
        }
    }
}

impl std::error::Error for CdTextError {}

/// Fold one string into ISO-8859-1 bytes.
///
/// Anything outside Latin-1 is transliterated rather than dropped: a player
/// showing "Zubr Kolektyw" is a small lie, but a truncated or mojibake title
/// burned onto a disc that cannot be rewritten is a worse one. Characters with
/// no sensible fallback become `?`, which reads as obviously-missing.
pub fn to_latin1(text: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            // Directly representable, minus the C1 control block that players
            // treat as undefined.
            c if (c as u32) < 0x80 => out.push(c as u8),
            c if (0xA0..=0xFF).contains(&(c as u32)) => out.push(c as u32 as u8),
            // Common typography that would otherwise vanish.
            '\u{2018}' | '\u{2019}' | '\u{201B}' => out.push(b'\''),
            '\u{201C}' | '\u{201D}' => out.push(b'"'),
            '\u{2013}' | '\u{2014}' | '\u{2212}' => out.push(b'-'),
            '\u{2026}' => out.extend_from_slice(b"..."),
            '\u{00A0}' | '\u{2007}' | '\u{202F}' => out.push(b' '),
            // Strip combining marks so decomposed accents fold to their base
            // letter instead of becoming two replacement characters.
            c if is_combining_mark(c) => {}
            other => out.push(transliterate(other)),
        }
    }
    out
}

fn is_combining_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F)
}

/// Best single-byte stand-in for a character outside Latin-1.
fn transliterate(c: char) -> u8 {
    match c {
        'Ā' | 'Ă' | 'Ą' => b'A',
        'ā' | 'ă' | 'ą' => b'a',
        'Ć' | 'Ĉ' | 'Ċ' | 'Č' => b'C',
        'ć' | 'ĉ' | 'ċ' | 'č' => b'c',
        'Đ' | 'Ď' => b'D',
        'đ' | 'ď' => b'd',
        'Ē' | 'Ĕ' | 'Ė' | 'Ę' | 'Ě' => b'E',
        'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => b'e',
        'Ğ' | 'Ġ' | 'Ģ' => b'G',
        'ğ' | 'ġ' | 'ģ' => b'g',
        'Ī' | 'Ĭ' | 'Į' | 'İ' => b'I',
        'ī' | 'ĭ' | 'į' | 'ı' => b'i',
        'Ĺ' | 'Ļ' | 'Ľ' | 'Ł' => b'L',
        'ĺ' | 'ļ' | 'ľ' | 'ł' => b'l',
        'Ń' | 'Ņ' | 'Ň' => b'N',
        'ń' | 'ņ' | 'ň' => b'n',
        'Ō' | 'Ŏ' | 'Ő' => b'O',
        'ō' | 'ŏ' | 'ő' => b'o',
        'Ŕ' | 'Ŗ' | 'Ř' => b'R',
        'ŕ' | 'ŗ' | 'ř' => b'r',
        'Ś' | 'Ŝ' | 'Ş' | 'Š' => b'S',
        'ś' | 'ŝ' | 'ş' | 'š' => b's',
        'Ţ' | 'Ť' | 'Ŧ' => b'T',
        'ţ' | 'ť' | 'ŧ' => b't',
        'Ũ' | 'Ū' | 'Ŭ' | 'Ů' | 'Ű' | 'Ų' => b'U',
        'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => b'u',
        'Ŷ' | 'Ÿ' => b'Y',
        'ŷ' => b'y',
        'Ź' | 'Ż' | 'Ž' => b'Z',
        'ź' | 'ż' | 'ž' => b'z',
        _ => b'?',
    }
}

/// One text item destined for a pack type.
struct Item {
    /// 0 for the disc, 1..n for tracks.
    track: u8,
    bytes: Vec<u8>,
}

/// Cut one pack type's items into packs.
///
/// Returns nothing when every item is empty — a pack type with no content is
/// simply absent from the block rather than emitted full of NULs.
fn packs_for_type(pack_type: u8, items: &[Item]) -> Vec<PartialPack> {
    if items.iter().all(|item| item.bytes.is_empty()) {
        return Vec::new();
    }

    let mut out: Vec<PartialPack> = Vec::new();
    let mut payload: Vec<u8> = Vec::with_capacity(PAYLOAD_BYTES);
    // Which item the next byte belongs to, and how much of it has gone out.
    let mut pending_track = items.first().map_or(0, |item| item.track);
    let mut pending_offset = 0_usize;

    for item in items {
        // Each item is terminated, so a player knows where one title ends.
        let mut stream = item.bytes.clone();
        stream.push(0);

        for (offset, byte) in stream.iter().enumerate() {
            if payload.is_empty() {
                pending_track = item.track;
                pending_offset = offset;
            }
            payload.push(*byte);
            if payload.len() == PAYLOAD_BYTES {
                out.push(PartialPack {
                    pack_type,
                    track: pending_track,
                    char_position: pending_offset.min(15) as u8,
                    payload: std::mem::take(&mut payload),
                });
                payload.reserve(PAYLOAD_BYTES);
            }
        }
    }

    if !payload.is_empty() {
        payload.resize(PAYLOAD_BYTES, 0);
        out.push(PartialPack {
            pack_type,
            track: pending_track,
            char_position: pending_offset.min(15) as u8,
            payload,
        });
    }
    out
}

/// A pack before its sequence number and CRC are known.
struct PartialPack {
    pack_type: u8,
    track: u8,
    char_position: u8,
    payload: Vec<u8>,
}

impl PartialPack {
    fn finish(&self, sequence: u8) -> [u8; PACK_BYTES] {
        let mut pack = [0_u8; PACK_BYTES];
        pack[0] = self.pack_type;
        pack[1] = self.track;
        pack[2] = sequence;
        // bit 7 = double-byte characters (never, for Latin-1);
        // bits 6..4 = block number; bits 3..0 = character position.
        pack[3] = ((BLOCK_NUMBER & 0x07) << 4) | (self.char_position & 0x0F);
        pack[4..16].copy_from_slice(&self.payload);
        let crc = pack_crc(&pack[..16]);
        pack[16] = crc[0];
        pack[17] = crc[1];
        pack
    }
}

/// Encode a whole block: title packs, performer packs, then SIZE_INFO.
pub fn encode_packs(input: &CdTextInput) -> Result<Vec<[u8; PACK_BYTES]>, CdTextError> {
    if input.tracks.len() > MAX_TRACKS {
        return Err(CdTextError::TooManyTracks(input.tracks.len()));
    }

    let titles: Vec<Item> = std::iter::once(Item {
        track: 0,
        bytes: to_latin1(input.disc_title.trim()),
    })
    .chain(input.tracks.iter().enumerate().map(|(index, track)| Item {
        track: (index + 1) as u8,
        bytes: to_latin1(track.title.trim()),
    }))
    .collect();

    let performers: Vec<Item> = std::iter::once(Item {
        track: 0,
        bytes: to_latin1(input.disc_performer.trim()),
    })
    .chain(input.tracks.iter().enumerate().map(|(index, track)| Item {
        track: (index + 1) as u8,
        bytes: to_latin1(track.performer.trim()),
    }))
    .collect();

    let mut partials = packs_for_type(PACK_TITLE, &titles);
    partials.extend(packs_for_type(PACK_PERFORMER, &performers));

    if partials.is_empty() {
        return Err(CdTextError::Empty);
    }

    // SIZE_INFO counts itself, so the total is known before it is built.
    let total = partials.len() + 3;
    if total > MAX_PACKS {
        return Err(CdTextError::TooMuchText { packs: total });
    }

    let mut counts = [0_u8; 16];
    for partial in &partials {
        let index = (partial.pack_type - 0x80) as usize;
        counts[index] = counts[index].saturating_add(1);
    }
    counts[(PACK_SIZE_INFO - 0x80) as usize] = 3;

    let mut packs: Vec<[u8; PACK_BYTES]> = partials
        .iter()
        .enumerate()
        .map(|(index, partial)| partial.finish(index as u8))
        .collect();

    let last_sequence = (total - 1) as u8;
    let last_track = input.tracks.len().max(1) as u8;
    for (part, payload) in size_info_payloads(&counts, last_sequence, last_track)
        .into_iter()
        .enumerate()
    {
        let partial = PartialPack {
            pack_type: PACK_SIZE_INFO,
            // For SIZE_INFO the track byte counts the record part, 0..2.
            track: part as u8,
            char_position: 0,
            payload: payload.to_vec(),
        };
        packs.push(partial.finish((partials.len() + part) as u8));
    }

    Ok(packs)
}

/// The 36-byte SIZE_INFO record, split into three 12-byte payloads.
///
/// Offsets (verified against the libcdio CD-TEXT format reference):
/// `0` charset, `1` first track, `2` last track, `3` copyright,
/// `4..20` pack counts for types 0x80..0x8F, `20..28` highest sequence number
/// per block, `28..36` language code per block.
fn size_info_payloads(counts: &[u8; 16], last_sequence: u8, last_track: u8) -> [[u8; 12]; 3] {
    let mut record = [0_u8; 36];
    record[0] = CHARSET_ISO_8859_1;
    record[1] = 1;
    record[2] = last_track;
    record[3] = 0; // Not asserting a copyright we do not know about.
    record[4..20].copy_from_slice(counts);
    record[20] = last_sequence; // block 0
    record[28] = LANGUAGE_ENGLISH; // block 0

    let mut out = [[0_u8; 12]; 3];
    for (part, chunk) in record.as_chunks::<12>().0.iter().enumerate() {
        out[part].copy_from_slice(chunk);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cdtext::{CdTextTrack, PACKS_PER_SECTOR};

    fn input(disc: &str, performer: &str, tracks: &[(&str, &str)]) -> CdTextInput {
        CdTextInput {
            disc_title: disc.into(),
            disc_performer: performer.into(),
            tracks: tracks
                .iter()
                .map(|(title, artist)| CdTextTrack {
                    title: (*title).into(),
                    performer: (*artist).into(),
                })
                .collect(),
        }
    }

    /// Reassemble the NUL-separated items for one pack type — the decode side
    /// of the encoder, used to prove round-trips rather than trusting layout.
    fn decode_items(packs: &[[u8; PACK_BYTES]], pack_type: u8) -> Vec<String> {
        let mut stream = Vec::new();
        for pack in packs.iter().filter(|p| p[0] == pack_type) {
            stream.extend_from_slice(&pack[4..16]);
        }
        let mut items: Vec<String> = stream
            .split(|b| *b == 0)
            .map(|chunk| chunk.iter().map(|b| *b as char).collect())
            .collect();
        // The last pack is zero-padded to 12 bytes, so the split leaves the
        // final terminator's empty piece plus one per padding byte. Trailing
        // empties are padding; an empty item *between* two others is real
        // (a track with no performer) and must survive.
        while items.last().is_some_and(|item| item.is_empty()) {
            items.pop();
        }
        items
    }

    #[test]
    fn titles_round_trip_through_the_pack_stream() {
        let packs = encode_packs(&input(
            "Long Way Round",
            "Various Artists",
            &[("Kolibri", "Ansel Mora"), ("Static Bloom", "The Faraday Cage")],
        ))
        .expect("encodes");

        assert_eq!(
            decode_items(&packs, PACK_TITLE),
            vec!["Long Way Round", "Kolibri", "Static Bloom"],
        );
        assert_eq!(
            decode_items(&packs, PACK_PERFORMER),
            vec!["Various Artists", "Ansel Mora", "The Faraday Cage"],
        );
    }

    /// Decode one pack type into (track number -> text), which is how a player
    /// actually resolves per-track fields.
    fn decode_by_track(packs: &[[u8; PACK_BYTES]], pack_type: u8) -> Vec<(u8, String)> {
        // Rebuild the byte stream and remember which item each byte belongs to,
        // starting from the track number the first pack of the type declares.
        let mut track = packs
            .iter()
            .find(|p| p[0] == pack_type)
            .map(|p| p[1])
            .unwrap_or(0);
        let mut out = Vec::new();
        let mut current = Vec::new();
        for pack in packs.iter().filter(|p| p[0] == pack_type) {
            for byte in &pack[4..16] {
                if *byte == 0 {
                    out.push((track, current.iter().map(|b: &u8| *b as char).collect()));
                    current.clear();
                    track = track.saturating_add(1);
                } else {
                    current.push(*byte);
                }
            }
        }
        out
    }

    #[test]
    fn every_track_on_a_compilation_keeps_its_own_performer() {
        // Fourteen tracks, fourteen different artists — the case where a
        // disc-level performer means nothing and only per-track ones do.
        let artists: Vec<String> = (1..=14).map(|n| format!("Artist Number {n}")).collect();
        let titles: Vec<String> = (1..=14).map(|n| format!("Song Number {n}")).collect();
        let tracks: Vec<(&str, &str)> = titles
            .iter()
            .zip(artists.iter())
            .map(|(t, a)| (t.as_str(), a.as_str()))
            .collect();

        let packs = encode_packs(&input("Mixtape", "", &tracks)).expect("encodes");

        // Track 0 is the (empty) disc performer; tracks 1..=14 are the real ones.
        let performers = decode_by_track(&packs, PACK_PERFORMER);
        for (index, artist) in artists.iter().enumerate() {
            let track_number = (index + 1) as u8;
            let found = performers
                .iter()
                .find(|(track, _)| *track == track_number)
                .map(|(_, text)| text.as_str());
            assert_eq!(found, Some(artist.as_str()), "track {track_number} lost its artist");
        }

        // And the titles line up with the same track numbers.
        let found_titles = decode_by_track(&packs, PACK_TITLE);
        for (index, title) in titles.iter().enumerate() {
            let track_number = (index + 1) as u8;
            let found = found_titles
                .iter()
                .find(|(track, _)| *track == track_number)
                .map(|(_, text)| text.as_str());
            assert_eq!(found, Some(title.as_str()), "track {track_number} lost its title");
        }
    }

    #[test]
    fn a_fourteen_artist_compilation_fits_a_single_block() {
        let artists: Vec<String> = (1..=14)
            .map(|n| format!("A Reasonably Long Band Name {n}"))
            .collect();
        let titles: Vec<String> = (1..=14)
            .map(|n| format!("A Reasonably Long Song Title {n}"))
            .collect();
        let tracks: Vec<(&str, &str)> = titles
            .iter()
            .zip(artists.iter())
            .map(|(t, a)| (t.as_str(), a.as_str()))
            .collect();

        let packs = encode_packs(&input("Mixtape", "Various Artists", &tracks)).expect("encodes");
        assert!(packs.len() <= 255, "{} packs is over a block", packs.len());
    }

    #[test]
    fn an_empty_disc_performer_does_not_shift_the_track_numbering() {
        // A compilation sends no disc-level performer. Track 0 must still hold
        // its (empty) slot, or every track's artist would be off by one.
        let packs = encode_packs(&input("Mixtape", "", &[("One", "Alpha"), ("Two", "Beta")]))
            .expect("encodes");
        let performers = decode_by_track(&packs, PACK_PERFORMER);
        assert_eq!(performers[0], (0, String::new()), "disc-level slot must be present");
        assert_eq!(performers[1], (1, "Alpha".to_string()));
        assert_eq!(performers[2], (2, "Beta".to_string()));
    }

    #[test]
    fn a_single_artist_disc_repeats_the_performer_on_every_track() {
        // The common case: one album, one artist, a disc name of the user's
        // choosing. The disc-level performer is set *and* each track carries
        // its own copy — that is what a player reads when it shows "now
        // playing", so omitting the per-track ones would leave it blank.
        let tracks: Vec<(&str, &str)> = [
            "Sabotage", "Intergalactic", "Sure Shot", "Root Down",
        ]
        .iter()
        .map(|title| (*title, "Beastie Boys"))
        .collect();

        let packs = encode_packs(&input("Kewl Mix", "Beastie Boys", &tracks)).expect("encodes");

        // Item 0 is the disc, items 1..n the tracks.
        assert_eq!(
            decode_items(&packs, PACK_TITLE),
            vec!["Kewl Mix", "Sabotage", "Intergalactic", "Sure Shot", "Root Down"],
        );
        assert_eq!(decode_items(&packs, PACK_PERFORMER), vec!["Beastie Boys"; 5]);
    }

    #[test]
    fn the_disc_title_is_not_confused_with_the_first_track() {
        // A player reads the disc name from track 0 of the TITLE packs; if the
        // disc title leaked into track 1 the whole disc would be off by one.
        let packs = encode_packs(&input("Kewl Mix", "Beastie Boys", &[("Sabotage", "Beastie Boys")]))
            .expect("encodes");
        let by_track = decode_by_track(&packs, PACK_TITLE);
        assert_eq!(by_track[0], (0, "Kewl Mix".to_string()));
        assert_eq!(by_track[1], (1, "Sabotage".to_string()));
    }

    #[test]
    fn a_title_longer_than_one_pack_spans_packs_intact() {
        let long = "A Title That Comfortably Exceeds Twelve Bytes Of Payload";
        let packs = encode_packs(&input(long, "P", &[])).expect("encodes");
        assert_eq!(decode_items(&packs, PACK_TITLE)[0], long);
    }

    #[test]
    fn every_pack_carries_a_valid_crc() {
        let packs = encode_packs(&input("Disc", "Performer", &[("One", "A"), ("Two", "B")]))
            .expect("encodes");
        for (index, pack) in packs.iter().enumerate() {
            let expected = pack_crc(&pack[..16]);
            assert_eq!([pack[16], pack[17]], expected, "pack {index} has a bad CRC");
        }
    }

    #[test]
    fn sequence_numbers_run_contiguously_from_zero() {
        let packs = encode_packs(&input("Disc", "Performer", &[("One", "A"), ("Two", "B")]))
            .expect("encodes");
        for (index, pack) in packs.iter().enumerate() {
            assert_eq!(pack[2], index as u8, "sequence broke at pack {index}");
        }
    }

    #[test]
    fn the_header_packs_the_block_number_and_character_position() {
        let packs = encode_packs(&input("Disc", "P", &[])).expect("encodes");
        for pack in &packs {
            assert_eq!(pack[3] & 0x80, 0, "double-byte flag must be clear for Latin-1");
            assert_eq!((pack[3] >> 4) & 0x07, BLOCK_NUMBER);
        }
    }

    #[test]
    fn the_first_pack_of_an_item_reports_character_position_zero() {
        let packs = encode_packs(&input("Disc", "P", &[])).expect("encodes");
        assert_eq!(packs[0][3] & 0x0F, 0);
    }

    #[test]
    fn character_position_is_capped_at_fifteen_for_long_items() {
        // 60 characters spans several packs; the later ones must report 15
        // rather than wrapping the four-bit field.
        let packs = encode_packs(&input(&"x".repeat(60), "P", &[])).expect("encodes");
        let positions: Vec<u8> = packs
            .iter()
            .filter(|p| p[0] == PACK_TITLE)
            .map(|p| p[3] & 0x0F)
            .collect();
        assert!(positions.contains(&15), "expected a capped position: {positions:?}");
        assert!(positions.iter().all(|p| *p <= 15));
    }

    #[test]
    fn a_pack_names_the_track_its_first_byte_belongs_to() {
        let packs = encode_packs(&input("D", "P", &[("T1", "A1"), ("T2", "A2")])).expect("encodes");
        // Short strings pack several items per pack, so the first title pack
        // must be attributed to the disc (track 0), not to a later track.
        let first_title = packs.iter().find(|p| p[0] == PACK_TITLE).expect("a title pack");
        assert_eq!(first_title[1], 0);
    }

    #[test]
    fn size_info_is_three_packs_and_comes_last() {
        let packs = encode_packs(&input("Disc", "P", &[("One", "A")])).expect("encodes");
        let tail = &packs[packs.len() - 3..];
        assert!(tail.iter().all(|p| p[0] == PACK_SIZE_INFO));
        assert_eq!(tail[0][1], 0);
        assert_eq!(tail[1][1], 1);
        assert_eq!(tail[2][1], 2);
        assert!(packs[..packs.len() - 3].iter().all(|p| p[0] != PACK_SIZE_INFO));
    }

    #[test]
    fn size_info_describes_the_block_it_belongs_to() {
        let packs = encode_packs(&input("Disc", "Performer", &[("One", "A"), ("Two", "B")]))
            .expect("encodes");
        let mut record = [0_u8; 36];
        for (part, pack) in packs[packs.len() - 3..].iter().enumerate() {
            record[part * 12..(part + 1) * 12].copy_from_slice(&pack[4..16]);
        }

        assert_eq!(record[0], CHARSET_ISO_8859_1);
        assert_eq!(record[1], 1, "first track");
        assert_eq!(record[2], 2, "last track");
        assert_eq!(record[3], 0, "copyright");

        let titles = packs.iter().filter(|p| p[0] == PACK_TITLE).count() as u8;
        let performers = packs.iter().filter(|p| p[0] == PACK_PERFORMER).count() as u8;
        assert_eq!(record[4], titles, "0x80 count");
        assert_eq!(record[5], performers, "0x81 count");
        assert_eq!(record[4 + 0x0F], 3, "0x8F counts itself");

        assert_eq!(record[20], (packs.len() - 1) as u8, "highest sequence number");
        assert_eq!(record[28], LANGUAGE_ENGLISH);
    }

    #[test]
    fn the_counts_in_size_info_match_the_packs_actually_emitted() {
        let packs = encode_packs(&input(
            &"long disc title ".repeat(4),
            &"long performer ".repeat(4),
            &[("a", "b"), ("c", "d"), ("e", "f")],
        ))
        .expect("encodes");
        let mut record = [0_u8; 36];
        for (part, pack) in packs[packs.len() - 3..].iter().enumerate() {
            record[part * 12..(part + 1) * 12].copy_from_slice(&pack[4..16]);
        }
        let counted: usize = record[4..20].iter().map(|c| *c as usize).sum();
        assert_eq!(counted, packs.len(), "SIZE_INFO must account for every pack");
    }

    #[test]
    fn non_latin1_text_is_transliterated_rather_than_mangled() {
        let packs = encode_packs(&input("D", "Żubr Kolektyw", &[])).expect("encodes");
        assert_eq!(decode_items(&packs, PACK_PERFORMER)[0], "Zubr Kolektyw");
    }

    #[test]
    fn latin1_accents_survive_untouched() {
        let packs = encode_packs(&input("Hálo", "Café", &[])).expect("encodes");
        assert_eq!(decode_items(&packs, PACK_TITLE)[0], "Hálo");
        assert_eq!(decode_items(&packs, PACK_PERFORMER)[0], "Café");
    }

    #[test]
    fn smart_typography_folds_to_ascii_equivalents() {
        assert_eq!(to_latin1("Don\u{2019}t \u{201C}stop\u{201D} \u{2014} now\u{2026}"), b"Don't \"stop\" - now...".to_vec());
    }

    #[test]
    fn decomposed_accents_fold_to_their_base_letter() {
        // "e" + combining acute, rather than the precomposed form.
        assert_eq!(to_latin1("Cafe\u{0301}"), b"Cafe".to_vec());
    }

    #[test]
    fn an_empty_pack_type_is_omitted_entirely() {
        let packs = encode_packs(&input("Disc", "", &[("One", ""), ("Two", "")])).expect("encodes");
        assert!(packs.iter().all(|p| p[0] != PACK_PERFORMER));
        assert!(packs.iter().any(|p| p[0] == PACK_TITLE));
    }

    #[test]
    fn a_disc_with_no_text_at_all_is_rejected() {
        assert_eq!(encode_packs(&input("", "", &[("", "")])), Err(CdTextError::Empty));
    }

    #[test]
    fn more_than_99_tracks_is_rejected() {
        let tracks: Vec<(&str, &str)> = (0..100).map(|_| ("t", "a")).collect();
        assert_eq!(
            encode_packs(&input("D", "P", &tracks)),
            Err(CdTextError::TooManyTracks(100)),
        );
    }

    #[test]
    fn text_that_overflows_a_block_is_rejected_with_the_pack_count() {
        let long: String = "x".repeat(250);
        let tracks: Vec<(&str, &str)> = (0..90).map(|_| (long.as_str(), long.as_str())).collect();
        match encode_packs(&input("D", "P", &tracks)) {
            Err(CdTextError::TooMuchText { packs }) => assert!(packs > 255),
            other => panic!("expected an overflow error, got {other:?}"),
        }
    }

    #[test]
    fn a_realistic_disc_fits_comfortably_in_a_block() {
        let tracks: Vec<(&str, &str)> = (0..12)
            .map(|_| ("A Reasonably Long Track Title", "Bruce Hornsby & the Range"))
            .collect();
        let packs = encode_packs(&input("Scenes From The Southside", "Bruce Hornsby & the Range", &tracks))
            .expect("encodes");
        assert!(packs.len() <= 255, "{} packs", packs.len());
        // Sanity: that is a modest number of lead-in sectors.
        assert!(packs.len().div_ceil(PACKS_PER_SECTOR) < 60);
    }
}
