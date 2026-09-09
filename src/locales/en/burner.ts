export const burner = {
  title: 'CD Burner',
  discTitleLabel: 'Disc title',
  discTitlePlaceholder: 'Name this disc…',

  // Drive + media
  recorder: 'Recorder',
  noRecorders: 'No CD writer found',
  refreshDrives: 'Refresh drives',
  eraseDisc: 'Erase disc',
  reloadDisc: 'Reload disc',
  reloading: 'Ejecting the disc…',
  reloadDone: 'Disc ejected. Push it back in, then press Refresh.',
  reloadHint:
    'The drive may still be describing this disc the way it did when the last rehearsal ended. Ejecting and reloading makes it look again.',
  erasing: 'Erasing the disc…',
  eraseDone: 'Disc erased.',
  mediaLabel: 'Media',
  mediaBlankSuffix: ', blank',
  noDisc: 'No disc',
  capacityLabel: 'Capacity',
  capacityValue: '{{minutes}} · {{sectors}} sectors',
  speedsLabel: 'Speeds',
  platformUnsupported:
    'CD burning is available on Windows and macOS in this release. Linux support is planned.',

  // Ring
  ringLabel: 'Disc capacity: {{count}} tracks, {{used}} used of {{capacity}}',
  arcLabel: 'Track {{number}}, {{title}} by {{artist}}, {{duration}}',
  hubRemaining: 'REMAINING',
  hubOverCapacity: 'OVER BY',
  hubTrackNumber: 'TRACK {{number}}',
  hubTrackCount_one: '{{count}} track',
  hubTrackCount_other: '{{count}} tracks',
  // One per phase. Nothing here claims the disc is being written until it is.
  hubPhaseNote: {
    fetching: 'Downloading from your server',
    analyzing: 'Measuring loudness',
    rendering: 'Converting to CD audio',
    preparing: 'Preparing the disc',
    writing: 'Writing to disc',
    closing: 'Finalising the disc',
  },
  hubSectors: '{{used}} / {{capacity}} sectors',

  // Running order
  runningOrder: 'Running order',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} track',
  trackCount_other: '{{count}} tracks',
  emptyTitle: 'No tracks queued yet.',
  emptyHint: 'Right-click a track, album or playlist and choose “Add to CD”.',
  fetchNote: 'Tracks that are not cached locally are downloaded automatically when the burn starts.',
  removeTrack: 'Remove {{title}}',
  trackWillDownloadHint:
    'Not cached locally yet. The burn downloads it from your server before writing.',
  willDownload_one:
    '{{count}} track will be downloaded first (about {{size}}). Nothing is added to your offline library.',
  willDownload_other:
    '{{count}} tracks will be downloaded first (about {{size}}). Nothing is added to your offline library.',

  // Options
  options: 'Burn options',
  writeSpeed: 'Write speed',
  speedAuto: 'Automatic',
  gapless: 'Gapless',
  gaplessHint: 'No 2-second gap between tracks. Disc-At-Once, as a pressed CD is.',
  normalize: 'Match track levels',
  normalizeHint: 'Analyses loudness and levels every track, so a compilation plays evenly.',
  testWrite: 'Test write',
  testWriteHint: 'Rehearse the burn with the laser off. Nothing is written to the disc.',
  ejectWhenDone: 'Eject when finished',
  cdText: 'Write CD-TEXT',
  cdTextHint:
    'Stores track and artist names on the disc, for players that can show them. Your drive reports it can do this.',
  cdTextUnavailable: 'This drive cannot write CD-TEXT.',
  cdTextNoAnswer:
    'This drive did not report its writing capabilities, so CD-TEXT cannot be offered safely.',
  cdTextNoSao:
    'CD-TEXT needs Session-At-Once recording, which this drive does not support.',
  cdTextNoSubchannel:
    'This drive cannot write the R-W subchannel that CD-TEXT lives in. The disc will still burn, without track names.',

  // Transport
  startBurn: 'Burn disc',
  startTestWrite: 'Test write',
  cancel: 'Stop',
  cancelling: 'Stopping…',
  clear: 'Clear',
  cancelSpoilsDisc:
    'The CD-R is being burned now. Stopping leaves the disc unusable — a CD-R cannot be rewritten.',

  // Blockers
  blockerEmpty: 'Add at least one track to burn a disc.',
  blockerOverCapacity: 'Over capacity by {{over}}. Remove a track or use an 80-minute disc.',
  blockerTooManyTracks: 'A CD holds at most {{max}} tracks; this queue has {{count}}.',

  // Readout
  readoutPhase: 'Phase',
  readoutMode: 'Write mode',
  readoutPosition: 'Position (MSF)',
  readoutSectors: 'Sectors',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Idle',
  phase: {
    fetching: 'Downloading',
    analyzing: 'Analysing',
    rendering: 'Rendering',
    preparing: 'Preparing',
    writing: 'Writing',
    closing: 'Closing',
  },

  // Toasts
  toastAdded_one: 'Added {{count}} track to the CD.',
  toastAdded_other: 'Added {{count}} tracks to the CD.',
  toastAddedSome_one: 'Added {{count}} track; skipped {{skipped}} already queued or over the limit.',
  toastAddedSome_other: 'Added {{count}} tracks; skipped {{skipped}} already queued or over the limit.',
  toastAlreadyQueued: 'Already on the CD.',
  toastDiscFull: 'The disc already holds the maximum of {{max}} tracks.',
  toastCancelled: 'Burn stopped.',
  toastBurnDone_one: 'Disc written — {{count}} track.',
  toastBurnDone_other: 'Disc written — {{count}} tracks.',
  toastTestWriteDone: 'Test write finished. Nothing was written to the disc.',
  toastCdTextVerified_one: 'CD-TEXT verified on the disc ({{count}} pack).',
  toastCdTextVerified_other: 'CD-TEXT verified on the disc ({{count}} packs).',
  toastCdTextUnconfirmed:
    'The disc burned and the audio is fine, but no CD-TEXT was found when reading it back. Drives often cache the disc’s contents from when it was inserted, so this may just be a stale read — eject the disc, put it back in and press “Check disc for CD-TEXT”.',
  toastCdTextUnreadable:
    'The disc burned and the audio is fine. This drive would not report the disc’s CD-TEXT, so whether it was written cannot be confirmed here — try the disc in a player that shows track names.',
  checkCdText: 'Check disc for CD-TEXT',
  checkingCdText: 'Reading the disc…',
  checkCdTextFound_one: 'CD-TEXT is on the disc ({{count}} pack).',
  checkCdTextFound_other: 'CD-TEXT is on the disc ({{count}} packs).',
  checkCdTextAbsent:
    'No CD-TEXT found on this disc. If it was just burned, try ejecting and reinserting it first.',

  // Context menu
  addToCd: 'Add to CD',
};
