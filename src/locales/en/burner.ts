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
  platformUnsupported: 'CD burning is not available on this platform.',

  // Ring
  ringLabel: 'Disc capacity: {{count}} tracks, {{used}} used of {{capacity}}',
  hubRemaining: 'REMAINING',
  hubOverCapacity: 'OVER BY',
  hubTrackOf: 'Track {{number}} of {{total}}',
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


  // Running order
  runningOrder: 'Running order',

  // Column headings for the running order. Terse on purpose: they sit at 10px
  // in a row 24px tall, and the numbers beneath them are what is being read.
  colNumber: '#',
  colTrack: 'Track',
  colArtist: 'Artist',
  colTime: 'Time',
  colStart: 'Start',

  // Metrics, which change with what the page is doing.
  metricHeadroom: 'Headroom',
  metricOverBy: 'Over by',
  metricToFetch: 'To fetch',
  metricWritten: 'Written',
  metricTook: 'Took',

  // The mode, beside the button it changes.
  modeLabel: 'Write mode',
  modeBurn: 'Burn',
  modeRehearse: 'Rehearse',

  // Stopping. Only one of these costs anything.
  prepareStopFree: 'Nothing has been written yet — stopping now costs nothing.',
  abort: 'Abort burn',
  abortConfirm: 'Ruin the disc',
  burnAnother: 'Burn another',

  // What happened, and what the disc is now. The two are said separately: a
  // rehearsal can fail and leave a perfectly good blank, and a real burn can be
  // stopped one sector in and leave a coaster.
  outcomeWritten: 'Disc written — {{count}} tracks · {{duration}} · took {{elapsed}}',
  outcomeRehearsed: 'Rehearsal finished. Nothing was written to the disc.',
  outcomeFailed: 'The burn failed.',
  outcomeCancelled: 'The burn was stopped.',
  discSpoiled: 'This CD-R has been partly written and cannot be reused.',
  discBlank: 'Nothing was written; the disc is still blank.',
  failHintBuffer:
    'The drive ran out of audio to write. Closing heavy disk work and burning slower usually fixes it.',
  failHintMedia: 'Check the disc: an audio CD needs a blank CD-R or CD-RW.',
  failHintPermission: 'Something else is holding the drive. Close it and try again.',

  speedTraceLabel: 'Writing at {{now}}×, lowest {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} track',
  trackCount_other: '{{count}} tracks',
  emptyTitle: 'No tracks queued yet.',
  emptyHint: 'Right-click a track, album or playlist and choose “Add to CD”.',
  fetchNote: 'Tracks that are not cached locally are downloaded automatically when the burn starts.',
  removeTrack: 'Remove {{title}}',
  rowWritten: 'Written to the disc',
  trackWillDownloadHint:
    'Not cached locally yet. The burn downloads it from your server before writing.',
  willDownload_one:
    '{{count}} track will be downloaded first (about {{size}}). Nothing is added to your offline library.',
  willDownload_other:
    '{{count}} tracks will be downloaded first (about {{size}}). Nothing is added to your offline library.',

  // Metrics column
  metricElapsed: 'Time Elapsed',
  metricRemaining: 'Time Remaining',
  metricTotal: 'Total Time',
  metricRuntime: 'Disc Runtime',
  metricSpeed: 'Writing at {{speed}}×',

  // Options
  options: 'Burn options',
  writeSpeed: 'Write speed',
  speedAuto: 'Automatic',
  gapless: 'Gapless',
  gaplessHint: 'No 2-second gap between tracks. Disc-At-Once, as a pressed CD is.',
  normalize: 'Match track levels',
  normalizeHint: 'Analyses loudness and levels every track, so a compilation plays evenly.',
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

  // The gutter between the disc and the running order.
  // The always-present line above the split. The idle variants are the ones
  // that show when there is nothing wrong, so they say what the disc will be
  // rather than leaving the page silent.
  alertReady_one: 'Ready · {{count}} track · {{runtime}} · {{free}} free',
  alertReady_other: 'Ready · {{count}} tracks · {{runtime}} · {{free}} free',
  alertNoDisc: 'Put a blank CD-R in the drive to burn this running order.',
  alertMore_one: 'Show 1 more message',
  alertMore_other: 'Show {{count}} more messages',

  // A rehearsal keeps saying so the whole way through: a job that reports
  // sectors with the laser off is exactly the one that can be misread as a
  // real burn.
  pillRehearsal: 'Rehearsal',
  pillWriting: 'Writing',

  seamLabel: 'Running order width',
  seamValue: '{{px}} pixels',

  // Reordering and removal are silent to a screen reader without these.
  movedTo: '{{title}} moved to position {{position}} of {{total}}',
  removedAnnounce: '{{title}} removed',


  cancelSpoilsDisc:
    'The CD-R is being burned now. Stopping leaves the disc unusable — a CD-R cannot be rewritten.',

  // Blockers
  blockerEmpty: 'Add at least one track to burn a disc.',
  blockerOverCapacity: 'Over capacity by {{over}}. Remove a track or use an 80-minute disc.',
  blockerTooManyTracks: 'A CD holds at most {{max}} tracks; this queue has {{count}}.',

  // An advisory, not a blocker: the queue fits the disc in the drive, but runs
  // past the 74 minutes Red Book actually specifies.
  past74: 'Past 74:00. It fits this disc, but some older CD players struggle beyond that.',

  // Readout
  readoutPhase: 'Phase',
  readoutMode: 'Write mode',
  readoutPosition: 'Position (MSF)',
  readoutSectors: 'Sectors',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Idle',
  // Shown instead of the phase while a rehearsal writes with the laser off.
  phaseRehearsing: 'Rehearsing',
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
  // A running job took its track list when it started, so anything added
  // after that would show a running order the drive is not writing.
  toastBurnInProgress: 'A burn is in progress. Stop it before changing the queue.',
  toastCancelled: 'Burn stopped.',
  toastBurnDone_one: 'Disc written — {{count}} track.',
  toastBurnDone_other: 'Disc written — {{count}} tracks.',
  toastTestWriteDone: 'Test write finished. Nothing was written to the disc.',
  toastCdTextVerified_one: 'CD-TEXT verified on the disc ({{count}} pack).',
  toastCdTextVerified_other: 'CD-TEXT verified on the disc ({{count}} packs).',
  toastCdTextUnconfirmed:
    'The disc burned and the audio is fine, but no CD-TEXT was found when reading it back. Drives often cache the disc’s contents from when it was inserted, so this may simply be a stale read — try the disc in a player that shows track names.',
  toastCdTextUnreadable:
    'The disc burned and the audio is fine. This drive would not report the disc’s CD-TEXT, so whether it was written cannot be confirmed here — try the disc in a player that shows track names.',

  // Track listing
  trackListing: 'Track listing',
  listingUntitled: 'Mix CD',
  listingSummary_one: '{{count}} track · {{duration}}',
  listingSummary_other: '{{count}} tracks · {{duration}}',
  listingCopy: 'Copy',
  listingCopied: 'Track listing copied.',
  listingCopyFailed: 'Could not copy the track listing.',
  listingSave: 'Save .txt',
  listingSaveTitle: 'Save the track listing',
  listingSaved: 'Track listing saved.',
  listingPrint: 'Print',

  // Context menu
  addToCd: 'Add to CD',
};
