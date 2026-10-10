export const burner = {
  title: 'Αντιγραφή CD',
  discTitleLabel: 'Τίτλος Δίσκου',
  discTitlePlaceholder: 'Δώστε όνομα στο δίσκο…',

  // Drive + media
  recorder: 'Συσκευή εγγραφής',
  noRecorders: 'Δεν βρέθηκε συσκευή εγγραφής CD',
  refreshDrives: 'Ανανέωση συσκευών',
  eraseDisc: 'Διαγραφή δίσκου',
  reloadDisc: 'Επαναφόρτωση δίσκου',
  reloading: 'Εξαγωγή δίσκου…',
  reloadDone: 'Ο δίσκος έχει εξαχθεί. Βάλτε τον πάλι μέσα και πατήστε Ανανέωση.',
  reloadHint:
    'Η συσκευή εγγραφής μπορεί ακόμη να περιγράφει το δίσκο όπως κατά τη δοκιμή. Κάνοντας εξαγωγή και ανανέωση λύνεται το πρόβλημα.',
  erasing: 'Διαγραφή δίσκου…',
  eraseDone: 'Επιτυχής διαγραφή δίσκου.',
  mediaLabel: 'Πολυμέσα',
  mediaBlankSuffix: ', κενό',
  noDisc: 'Δεν υπάρχει δίσκος',
  capacityLabel: 'Χωρητικότητα',
  capacityValue: '{{minutes}} · {{sectors}} τομείς',
  platformUnsupported: 'Η αντιγραφή CD δεν είναι διαθέσιμη σε αυτή τη πλατφόρμα.',

  // Ring
  ringLabel: 'Χωρητικότητα δίσκου: {{count}} κομμάτια, {{used}} χρησιμοποιημένα από {{capacity}}',
  hubRemaining: 'ΑΠΟΜΕΝΟΥΝ',
  hubOverCapacity: 'ΠΑΝΩ ΑΠΟ ΧΩΡΗΤΙΚΟΤΗΤΑ',
  hubTrackOf: 'Κομμάτι {{number}} από {{total}}',
  hubTrackCount_one: '{{count}} κομμάτι',
  hubTrackCount_other: '{{count}} κομμάτια',
  // One per phase. Nothing here claims the disc is being written until it is.
  hubPhaseNote: {
    fetching: 'Λήψη από το διακομιστή σας',
    analyzing: 'Μέτρηση έντασης',
    rendering: 'Μετατροπή σε ήχο CD',
    preparing: 'Προετοιμασία του δίσκου',
    writing: 'Εγγραφή στον δίσκο',
    closing: 'Ολοκλήρωση του δίσκου',
  },


  // Running order
  runningOrder: 'Σειρά εκτέλεσης',

  // Column headings for the running order. Terse on purpose: they sit at 10px
  // in a row 24px tall, and the numbers beneath them are what is being read.
  colNumber: '#',
  colTrack: 'Κομμάτι',
  colArtist: 'Καλλιτέχνης',
  colTime: 'Χρόνος',
  colStart: 'Έναρξη',

  // Metrics, which change with what the page is doing.
  metricHeadroom: 'Περιθώριο',
  metricOverBy: 'Πέρασε το όριο κατά',
  metricToFetch: 'Για λήψη',
  metricWritten: 'Γράφτηκαν',
  metricTook: 'Χρειάστηκε',

  // The mode, beside the button it changes.
  modeLabel: 'Λειτουργία εγγραφής',
  modeBurn: 'Εγγραφή',
  modeRehearse: 'Δοκιμή',

  // Stopping. Only one of these costs anything.
  prepareStopFree: 'Δεν έχει γίνει εγγραφή ακόμη — δεν κοστίζει τίποτα να σταματήσετε τώρα.',
  abort: 'Διακοπή εγγραφής',
  abortConfirm: 'Καταστροφή δίσκου',
  burnAnother: 'Εγγραφή άλλου δίσκου',

  // What happened, and what the disc is now. The two are said separately: a
  // rehearsal can fail and leave a perfectly good blank, and a real burn can be
  // stopped one sector in and leave a coaster.
  outcomeWritten: 'Επιτυχής εγγραφή δίσκου — {{count}} κομμάτια · {{duration}} · χρειάστηκαν {{elapsed}}',
  outcomeRehearsed: 'Η δοκιμή ολοκληρώθηκε. Τίποτα δεν γράφτηκε στο δίσκο.',
  outcomeFailed: 'Η εγγραφή απέτυχε.',
  outcomeCancelled: 'Η εγγραφή διακόπηκε.',
  discSpoiled: 'Αυτό το CD-R έχει ήδη εγγραφεί μερικώς και δεν μπορεί να ξαναχρησιμοποιηθεί.',
  discBlank: 'Τίποτα δεν γράφτηκε· ο δίσκος είναι ακόμη κενός.',
  failHintBuffer:
    'Η συσκευή ξέμεινε από ήχο για να γράψει. Αυτό μπορεί να διορθωθεί σταματώντας τη βαριά χρήση της συσκευής και θέτοντας μικρότερη ταχύτητα εγγραφής.',
  failHintMedia: 'Ελέγξτε το δίσκο: για την εγγραφή χρειάζεται ένα κενό CD-R ή CD-RW.',
  failHintPermission: 'Κάτι άλλο κρατά κατειλημμένο το δίσκο. Κλείστε το και ξαναπροσπαθείστε.',

  speedTraceLabel: 'Ταχύτητα εγγραφής {{now}}×, κατώτατη {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} κομμάτι',
  trackCount_other: '{{count}} κομμάτια',
  emptyTitle: 'Δεν υπάρχουν κομμάτια στην ουρά.',
  emptyHint: 'Κάντε δεξί κλικ σε ένα κομμάτι, άλμπουμ ή λίστα αναπαραγωγής και επιλέξτε “Προσθήκη σε CD”.',
  fetchNote: 'Κομμάτια που δεν έχουν αποθηκευτεί τοπικά γίνονται λήψη αυτόματα όταν ξεκινά η εγγραφή.',
  removeTrack: 'Αφαίρεση {{title}}',
  rowWritten: 'Εγγράφηκε στο δίσκο',
  trackWillDownloadHint:
    'Μη αποθηκευμένο τοπικά. Η εγγραφή το κάνει λήψη πρώτα από το διακομιστή σας.',
  willDownload_one:
    '{{count}} κομμάτι θα γίνει λήψη πρώτα (περίπου {{size}}). Τίποτα δεν θα προστεθεί στη βιβλιοθήκη εκτός σύνδεσής σας.',
  willDownload_other:
    '{{count}} κομμάτια θα γίνουν λήψη πρώτα (περίπου {{size}}). Τίποτα δεν θα προστεθεί στη βιβλιοθήκη εκτός σύνδεσής σας.',

  // Metrics column
  metricElapsed: 'Χρόνος από την έναρξη',
  metricRemaining: 'Υπολειπόμενος χρόνος',
  metricTotal: 'Συνολικός χρόνος',
  metricRuntime: 'Χρόνος εκτέλεσης',
  metricSpeed: 'Ταχύτητα εγγραφής {{speed}}×',

  // Options
  options: 'Επιλογές εγγραφής',
  writeSpeed: 'Ταχύτητα εγγραφής',
  speedAuto: 'Αυτόματη',
  gapless: 'Gapless',
  gaplessHint: 'Χωρίς κενό 2 δευτερολέπτων μεταξύ των κομματιών. Άμεση εγγραφή δίσκου σε ένα ενιαίο πέρασμα.',
  normalize: 'Αντιστοίχιση έντασης κομματιών',
  normalizeHint: 'Αναλύει την ένταση και τα επίπεδα κάθε κομματιού ώστε οι συλλογές να παίζουν ομοιόμορφα.',
  ejectWhenDone: 'Εξαγωγή κατά την ολοκλήρωση',
  cdText: 'Εγγραφή κειμένου CD',
  cdTextHint:
    'Αποθηκεύει τα ονόματα κομματιών και καλλιτεχνών στο δίσκο για συσκευές αναπαραγωγής που μπορούν να τα δείξουν. Η συσκευή σας αναφέρει αν μπορεί να το κάνει.',
  cdTextUnavailable: 'Αυτή η συσκευή δεν μπορεί να γράψει κείμενο στο CD.',
  cdTextNoAnswer:
    'Αυτή η συσκευή δεν έκανε αναφορά για τις δυνατότητες εγγραφής της, επομένως η λειτουργία εγγραφής κειμένου στο CD δεν είναι ασφαλής.',
  cdTextNoSao:
    'Η εγγραφή κειμένου CD χρειάζεται τη λειτουργία Session-At-Once, που αυτή η συσκευή δεν υποστηρίζει.',
  cdTextNoSubchannel:
    'Αυτή η συσκευή δεν μπορεί να γράψει στο υποκανάλι R-W το οποίο φιλοξενεί το κείμενο CD. Η εγγραφή θα γίνει, χωρίς όμως τα ονόματα των κομματιών.',

  // Transport
  startBurn: 'Εγγραφή δίσκου',
  startTestWrite: 'Δοκιμαστική εγγραφή',
  cancel: 'Διακοπή',
  cancelling: 'Διακοπή…',
  clear: 'Εκκαθάριση',

  // The gutter between the disc and the running order.
  // The always-present line above the split. The idle variants are the ones
  // that show when there is nothing wrong, so they say what the disc will be
  // rather than leaving the page silent.
  alertReady_one: 'Έτοιμο · {{count}} κομμάτι · {{runtime}} · {{free}} ελεύθερο',
  alertReady_other: 'Έτοιμα · {{count}} κομμάτια · {{runtime}} · {{free}} ελεύθερα',
  alertNoDisc: 'Τοποθετήστε ένα κενό CD-R στη συσκευή για να κάνετε εγγραφή με αυτή τη σειρά.',
  alertMore_one: 'Εμφάνιση ενός ακόμη μηνύματος',
  alertMore_other: 'Εμφάνιση {{count}} ακόμη μηνυμάτων',

  // A rehearsal keeps saying so the whole way through: a job that reports
  // sectors with the laser off is exactly the one that can be misread as a
  // real burn.
  pillRehearsal: 'Δοκιμή',
  pillWriting: 'Εγγραφή',

  seamLabel: 'Εύρος τρέχουσας ενότητας',
  seamValue: '{{px}} pixels',

  // Reordering and removal are silent to a screen reader without these.
  movedTo: '{{title}} μετακινήθηκε στη θέση {{position}} από {{total}}',
  removedAnnounce: '{{title}} αφαιρέθηκε',


  cancelSpoilsDisc:
    'Γίνεται η εγγραφή του CD-R. Η διακοπή θα αφήσει το δίσκο ακατάλληλο για χρήση — ένα CD-R δεν μπορεί να ξαναεγγραφεί.',

  // Blockers
  // What the drive says about the disc in it. The backend sends a code
  // rather than a sentence, so these can be translated.
  mediaBlockerNoDisc: 'Δεν υπάρχει δίσκος στη συσκευή εγγραφής.',
  mediaBlockerNotCd: 'Τύπος: {{mediaType}}. CD ήχου χρειάζονται ένα κενό CD-R ή CD-RW.',
  mediaBlockerAlreadyWritten:
    'Αυτό ο δίσκος έχει ήδη εγγραφεί και κλείσει, επομένως δεν μπορεί να ξαναεγγραφεί.',
  mediaBlockerNotBlankRewritable: 'Αυτό το CD-RW ήδη έχει δεδομένα. Διαγράψτε τα πρωτού ξεκινήσετε νέα εγγραφή.',
  mediaBlockerNotBlankRecordable: 'Αυτό το CD-R δεν είναι κενό. Τα CD ήχου γράφονται μονομιάς.',
  mediaBlockerDriveRefused: 'Η συσκευή εγγραφής δεν δέχεται αυτόν το δίσκο.',
  mediaBlockerDriveSilent: 'Αδυναμία περιγραφής του δίσκου από τη συσκευή εγγραφής.',
  mediaBlockerUnknown: 'Αδυναμία εγγραφής στο δίσκο.',

  blockerEmpty: 'Προσθέστε τουλάχιστον ένα κομμάτι για εγγραφή στο δίσκο.',
  blockerOverCapacity: 'Πάνω από τη χωρητικότητα κατά {{over}}. Αφαιρέστε ένα κομμάτι η χρησιμοποιήστε ένα δίσκο 80 λεπτών.',
  blockerTooManyTracks: 'Ένα CD μπορεί να έχει το πολύ {{max}} κομμάτια· η ουρά έχει {{count}}.',

  // An advisory, not a blocker: the queue fits the disc in the drive, but runs
  // past the 74 minutes Red Book actually specifies.
  past74: 'Πάνω από το όριο 74:00 λεπτών. Χωράει στο δίσκο, αλλά κάποια παλιά CD δυσκολεύονται να παίξουν κομμάτια μετά από αυτό.',

  // Readout
  readoutPhase: 'Φάση',
  readoutMode: 'Λειτουργία εγγραφής',
  readoutPosition: 'Θέση(MSF)',
  readoutSectors: 'Τομέας',
  readoutBuffer: 'Μνήμη',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / ΤΕΣΤ',
  phaseIdle: 'Αδρανής',
  // Shown instead of the phase while a rehearsal writes with the laser off.
  phaseRehearsing: 'Δοκιμάζοντας',
  phase: {
    fetching: 'Λήψη',
    analyzing: 'Ανάλυση',
    rendering: 'Μετατροπή',
    preparing: 'Προετοιμασία',
    writing: 'Εγγραφή',
    closing: 'Κλείσιμο',
  },

  // Toasts
  toastAdded_one: 'Επιτυχής προσθήκη {{count}} κομματιού στο CD.',
  toastAdded_other: 'Επιτυχής προσθήκη {{count}} κομματιών στο CD.',
  toastAddedSome_one: 'Προστέθηκε {{count}} κομμάτι· παραλείφθησαν {{skipped}} ήδη στην ουρά ή πάνω από το όριο.',
  toastAddedSome_other: 'Προστέθηκαν {{count}} κομμάτια· παραλείφθησαν {{skipped}} ήδη στην ουρά ή πάνω από το όριο.',
  toastNewDiscStarted: 'Έναρξη διαδικασίας εγγραφής στο νέο δίσκο. Η σειρά των κομματιών από την προηγούμενη εγγραφή εκκαθαρίστηκε.',
  toastAlreadyQueued: 'Ήδη στο CD.',
  toastDiscFull: 'Ο δίσκος περιέχει το μέγιστο των {{max}} κομματιών.',
  // A running job took its track list when it started, so anything added
  // after that would show a running order the drive is not writing.
  toastBurnInProgress: 'Μία εγγραφή βρίσκεται σε εξέλιξη. Σταματήστε την πρωτού αλλάξετε την ουρά.',
  toastCancelled: 'Η εγγραφή ακυρώθηκε.',
  toastBurnDone_one: 'Εγγραφή ολοκληρώθηκε — {{count}} κομμάτι.',
  toastBurnDone_other: 'Εγγραφή ολοκληρώθηκε — {{count}} κομμάτια.',
  toastCdTextSkipped:
    'Ο δίσκος εγγράφηκε χωρίς κείμενο CD — η συσκευή δεν μπόρεσε να τα γράψει, επομένως οι συσκευές αναπαραγωγής δεν θα δείχνουν τα ονόματα των κομματιών.',
  toastTestWriteDone: 'Ολοκλήρωση δοκιμαστικής εγγραφής. Τίποτε δεν γράφτηκε στο δίσκο.',
  toastCdTextVerified_one: 'Κείμενο CD επικυρώθηκε στο δίσκο ({{count}} πακέτο).',
  toastCdTextVerified_other: 'Κείμενο CD επικυρώθηκε στο δίσκο ({{count}} πακέτα).',
  toastCdTextUnconfirmed:
    'Η εγγραφή ολοκληρώθηκε και ο ήχος είναι πλήρης, όμως δεν βρέθηκε κείμενο CD όταν αυτό διαβάστηκε. Οι συσκευές εγγραφής συχνά αποθηκεύουν στην κρυφή μνήμη τα περιεχόμενα του δίσκου όταν γίνεται η αρχική εισαγωγή, οπότε αυτό μπορεί να είναι αποτέλεσμα ανάγνωσης παροχημένων δεδομένων — δοκιμάστε το δίσκο σε μία συσκευή αναπαραγωγής που εμφανίζει ονόματα κομματιών.',
  toastCdTextUnreadable:
    'Η εγγραφή ολοκληρώθηκε και ο ήχος είναι πλήρης. Η συσκευή αναφοράς δεν έκανε αναφορά το κείμενο CD του δίσκου, επομένως δεν μπορεί να επιβεβαιωθεί η εγγραφή του κειμένου — δοκιμάστε το δίσκο σε μία συσκευή αναπαραγωγής που εμφανίζει ονόματα κομματιών.',

  // Track listing
  trackListing: 'Λίστα κομματιών',
  listingUntitled: 'Μιξ CD',
  listingSummary_one: '{{count}} κομμάτι · {{duration}}',
  listingSummary_other: '{{count}} κομμάτια · {{duration}}',
  listingCopy: 'Αντιγραφή',
  listingCopied: 'Επιτυχής αντιγραφή κομματιών.',
  listingCopyFailed: 'Αδυναμία αντιγραφής λίστας κομματιών.',
  listingSave: 'Αποθήκευση .txt',
  listingSaveTitle: 'Αποθήκευση λίστας κομματιών',
  listingSaved: 'Επιτυχής αποθήκευση λίστας κομματιών.',
  listingPrint: 'Εκτύπωση',

  // Context menu
  addToCd: 'Προσθήκη στο CD',
};
