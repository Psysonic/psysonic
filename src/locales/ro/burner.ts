export const burner = {
  title: 'Inscriptor CD',
  discTitleLabel: 'Titlul discului',
  discTitlePlaceholder: 'Denumește acest disc…',

  recorder: 'Inscriptor',
  noRecorders: 'Nu s-a găsit niciun inscriptor CD',
  refreshDrives: 'Reîmprospătează unitățile',
  eraseDisc: 'Șterge discul',
  reloadDisc: 'Reîncarcă discul',
  reloading: 'Se scoate discul…',
  reloadDone: 'Disc scos. Împinge-l la loc, apoi apasă Reîmprospătează.',
  reloadHint:
    'Unitatea poate descrie încă acest disc așa cum era la finalul ultimei repetiții. Scoaterea și reîncărcarea o fac să se uite din nou.',
  erasing: 'Se șterge discul…',
  eraseDone: 'Disc șters.',
  mediaLabel: 'Suport',
  mediaBlankSuffix: ', gol',
  noDisc: 'Niciun disc',
  capacityLabel: 'Capacitate',
  capacityValue: '{{minutes}} · {{sectors}} sectoare',
  platformUnsupported: 'Inscripționarea CD-urilor nu este disponibilă pe această platformă.',

  ringLabel: 'Capacitatea discului: {{count}} melodii, {{used}} folosiți din {{capacity}}',
  hubRemaining: 'RĂMAS',
  hubOverCapacity: 'DEPĂȘIRE CU',
  hubTrackOf: 'Melodia {{number}} din {{total}}',
  hubTrackCount_one: '{{count}} melodie',
  hubTrackCount_few: '{{count}} melodii',
  hubTrackCount_other: '{{count}} de melodii',
  hubPhaseNote: {
    fetching: 'Se descarcă de pe serverul tău',
    analyzing: 'Se măsoară sonoritatea',
    rendering: 'Se convertește în audio CD',
    preparing: 'Se pregătește discul',
    writing: 'Se scrie pe disc',
    closing: 'Se finalizează discul',
  },

  runningOrder: 'Ordinea de redare',

  colNumber: '#',
  colTrack: 'Melodie',
  colArtist: 'Artist',
  colTime: 'Durată',
  colStart: 'Început',

  metricHeadroom: 'Rezervă',
  metricOverBy: 'Depășire cu',
  metricToFetch: 'De descărcat',
  metricWritten: 'Scrise',
  metricTook: 'A durat',

  modeLabel: 'Mod de scriere',
  modeBurn: 'Inscripționează',
  modeRehearse: 'Repetiție',

  prepareStopFree: 'Nu s-a scris încă nimic — oprirea acum nu costă nimic.',
  abort: 'Anulează inscripționarea',
  abortConfirm: 'Strică discul',
  burnAnother: 'Inscripționează altul',

  outcomeWritten: 'Disc inscripționat — {{count}} melodii · {{duration}} · a durat {{elapsed}}',
  outcomeRehearsed: 'Repetiție încheiată. Nu s-a scris nimic pe disc.',
  outcomeFailed: 'Inscripționarea a eșuat.',
  outcomeCancelled: 'Inscripționarea a fost oprită.',
  discSpoiled: 'Acest CD-R a fost scris parțial și nu mai poate fi refolosit.',
  discBlank: 'Nu s-a scris nimic; discul este în continuare gol.',
  failHintBuffer:
    'Unitatea a rămas fără audio de scris. De obicei ajută să închizi lucrările grele de disc și să inscripționezi mai încet.',
  failHintMedia: 'Verifică discul: un CD audio are nevoie de un CD-R sau CD-RW gol.',
  failHintPermission: 'Altceva ține ocupată unitatea. Închide-l și încearcă din nou.',

  speedTraceLabel: 'Se scrie la {{now}}×, minim {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} melodie',
  trackCount_few: '{{count}} melodii',
  trackCount_other: '{{count}} de melodii',
  emptyTitle: 'Încă nicio melodie în coadă.',
  emptyHint: 'Dă clic dreapta pe o melodie, un album sau o listă și alege „Adaugă pe CD”.',
  fetchNote:
    'Melodiile care nu sunt în memoria locală se descarcă automat la începutul inscripționării.',
  removeTrack: 'Elimină {{title}}',
  rowWritten: 'Scrisă pe disc',
  trackWillDownloadHint:
    'Încă nu este în memoria locală. Inscripționarea o descarcă de pe serverul tău înainte de a scrie.',
  willDownload_one:
    'Se va descărca mai întâi {{count}} melodie (aproximativ {{size}}). Nu se adaugă nimic în biblioteca offline.',
  willDownload_few:
    'Se vor descărca mai întâi {{count}} melodii (aproximativ {{size}}). Nu se adaugă nimic în biblioteca offline.',
  willDownload_other:
    'Se vor descărca mai întâi {{count}} de melodii (aproximativ {{size}}). Nu se adaugă nimic în biblioteca offline.',

  metricElapsed: 'Timp scurs',
  metricRemaining: 'Timp rămas',
  metricTotal: 'Timp total',
  metricRuntime: 'Durata discului',
  metricSpeed: 'Se scrie la {{speed}}×',

  options: 'Opțiuni de inscripționare',
  writeSpeed: 'Viteză de scriere',
  speedAuto: 'Automată',
  gapless: 'Fără pauze',
  gaplessHint: 'Fără pauza de 2 secunde între melodii. Disc-At-Once, ca la un CD presat.',
  normalize: 'Egalizează nivelurile',
  normalizeHint:
    'Analizează sonoritatea și nivelează fiecare melodie, ca o compilație să sune uniform.',
  ejectWhenDone: 'Scoate la final',
  cdText: 'Scrie CD-TEXT',
  cdTextHint:
    'Salvează numele melodiilor și ale artiștilor pe disc, pentru playerele care le pot afișa. Unitatea ta raportează că poate face asta.',
  cdTextUnavailable: 'Această unitate nu poate scrie CD-TEXT.',
  cdTextNoAnswer:
    'Această unitate nu și-a raportat capacitățile de scriere, așa că CD-TEXT nu poate fi oferit în siguranță.',
  cdTextNoSao:
    'CD-TEXT necesită înregistrare Session-At-Once, pe care această unitate nu o acceptă.',
  cdTextNoSubchannel:
    'Această unitate nu poate scrie subcanalul R-W în care stă CD-TEXT. Discul se va inscripționa oricum, fără numele melodiilor.',

  startBurn: 'Inscripționează discul',
  startTestWrite: 'Scriere de test',
  cancel: 'Oprește',
  cancelling: 'Se oprește…',
  clear: 'Golește',

  alertReady_one: 'Gata · {{count}} melodie · {{runtime}} · {{free}} liberi',
  alertReady_few: 'Gata · {{count}} melodii · {{runtime}} · {{free}} liberi',
  alertReady_other: 'Gata · {{count}} de melodii · {{runtime}} · {{free}} liberi',
  alertNoDisc: 'Pune un CD-R gol în unitate pentru a inscripționa această ordine.',
  alertMore_one: 'Arată încă 1 mesaj',
  alertMore_few: 'Arată încă {{count}} mesaje',
  alertMore_other: 'Arată încă {{count}} de mesaje',

  pillRehearsal: 'Repetiție',
  pillWriting: 'Se scrie',

  seamLabel: 'Lățimea ordinii de redare',
  seamValue: '{{px}} pixeli',

  movedTo: '{{title}} mutată pe poziția {{position}} din {{total}}',
  removedAnnounce: '{{title}} eliminată',

  cancelSpoilsDisc:
    'CD-R-ul se inscripționează chiar acum. Oprirea face discul inutilizabil — un CD-R nu poate fi rescris.',

  mediaBlockerNoDisc: 'Niciun disc în unitate.',
  mediaBlockerNotCd: 'Acesta este {{mediaType}}. Un CD audio are nevoie de un CD-R sau CD-RW gol.',
  mediaBlockerAlreadyWritten:
    'Acest disc este deja inscripționat și închis, așa că nu mai poate fi inscripționat.',
  mediaBlockerNotBlankRewritable:
    'Acest CD-RW conține deja date. Șterge-l înainte de inscripționare.',
  mediaBlockerNotBlankRecordable:
    'Acest CD-R nu este gol. Un CD audio trebuie inscripționat dintr-o singură dată.',
  mediaBlockerDriveRefused: 'Unitatea nu acceptă acest disc.',
  mediaBlockerDriveSilent: 'Unitatea nu a descris acest disc.',
  mediaBlockerUnknown: 'Pe acest disc nu se poate scrie.',

  blockerEmpty: 'Adaugă cel puțin o melodie pentru a inscripționa un disc.',
  blockerOverCapacity:
    'Capacitate depășită cu {{over}}. Elimină o melodie sau folosește un disc de 80 de minute.',
  blockerTooManyTracks: 'Un CD ține cel mult {{max}} melodii; această coadă are {{count}}.',

  past74:
    'Peste 74:00. Încape pe acest disc, dar unele playere CD mai vechi au dificultăți dincolo de acest punct.',

  readoutPhase: 'Fază',
  readoutMode: 'Mod de scriere',
  readoutPosition: 'Poziție (MSF)',
  readoutSectors: 'Sectoare',
  readoutBuffer: 'Tampon',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inactiv',
  phaseRehearsing: 'Repetiție în curs',
  phase: {
    fetching: 'Se descarcă',
    analyzing: 'Se analizează',
    rendering: 'Se convertește',
    preparing: 'Se pregătește',
    writing: 'Se scrie',
    closing: 'Se închide',
  },

  toastAdded_one: 'S-a adăugat {{count}} melodie pe CD.',
  toastAdded_few: 'S-au adăugat {{count}} melodii pe CD.',
  toastAdded_other: 'S-au adăugat {{count}} de melodii pe CD.',
  toastAddedSome_one:
    'S-a adăugat {{count}} melodie; s-au omis {{skipped}} deja în coadă sau peste limită.',
  toastAddedSome_few:
    'S-au adăugat {{count}} melodii; s-au omis {{skipped}} deja în coadă sau peste limită.',
  toastAddedSome_other:
    'S-au adăugat {{count}} de melodii; s-au omis {{skipped}} deja în coadă sau peste limită.',
  toastNewDiscStarted:
    'A început un disc nou. Ordinea melodiilor de la inscripționarea anterioară a fost golită.',
  toastAlreadyQueued: 'Este deja pe CD.',
  toastDiscFull: 'Discul conține deja maximul de {{max}} melodii.',
  toastBurnInProgress: 'O inscripționare este în curs. Oprește-o înainte de a schimba coada.',
  toastCancelled: 'Inscripționare oprită.',
  toastBurnDone_one: 'Disc inscripționat — {{count}} melodie.',
  toastBurnDone_few: 'Disc inscripționat — {{count}} melodii.',
  toastBurnDone_other: 'Disc inscripționat — {{count}} de melodii.',
  toastCdTextSkipped:
    'Discul s-a inscripționat fără CD-TEXT — această unitate nu l-a putut scrie aici, așa că playerele nu vor afișa numele melodiilor.',
  toastTestWriteDone: 'Scrierea de test s-a încheiat. Nu s-a scris nimic pe disc.',
  toastCdTextVerified_one: 'CD-TEXT verificat pe disc ({{count}} pachet).',
  toastCdTextVerified_few: 'CD-TEXT verificat pe disc ({{count}} pachete).',
  toastCdTextVerified_other: 'CD-TEXT verificat pe disc ({{count}} de pachete).',
  toastCdTextUnconfirmed:
    'Discul s-a inscripționat și sunetul este în regulă, dar la recitire nu s-a găsit niciun CD-TEXT. Unitățile rețin adesea conținutul discului din momentul în care a fost introdus, așa că poate fi o citire învechită — încearcă discul într-un player care afișează numele melodiilor.',
  toastCdTextUnreadable:
    'Discul s-a inscripționat și sunetul este în regulă. Această unitate nu a vrut să raporteze CD-TEXT-ul discului, așa că aici nu se poate confirma dacă a fost scris — încearcă discul într-un player care afișează numele melodiilor.',

  trackListing: 'Lista melodiilor',
  listingUntitled: 'CD compilație',
  listingSummary_one: '{{count}} melodie · {{duration}}',
  listingSummary_few: '{{count}} melodii · {{duration}}',
  listingSummary_other: '{{count}} de melodii · {{duration}}',
  listingCopy: 'Copiază',
  listingCopied: 'Lista melodiilor a fost copiată.',
  listingCopyFailed: 'Lista melodiilor nu a putut fi copiată.',
  listingSave: 'Salvează .txt',
  listingSaveTitle: 'Salvează lista melodiilor',
  listingSaved: 'Lista melodiilor a fost salvată.',
  listingPrint: 'Tipărește',

  addToCd: 'Adaugă pe CD',
};
