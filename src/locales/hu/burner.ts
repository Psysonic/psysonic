export const burner = {
  title: 'CD-író',
  discTitleLabel: 'Lemez címe',
  discTitlePlaceholder: 'Nevezd el ezt a lemezt…',

  recorder: 'Író',
  noRecorders: 'Nem található CD-író',
  refreshDrives: 'Meghajtók frissítése',
  eraseDisc: 'Lemez törlése',
  reloadDisc: 'Lemez újraolvasása',
  reloading: 'Lemez kiadása…',
  reloadDone: 'Lemez kiadva. Told vissza, majd nyomd meg a Frissítés gombot.',
  reloadHint:
    'A meghajtó lehet, hogy még mindig úgy írja le ezt a lemezt, ahogy az utolsó próba végén volt. A kiadás és újratöltés ráveszi, hogy újra megnézze.',
  erasing: 'Lemez törlése…',
  eraseDone: 'A lemez törölve.',
  mediaLabel: 'Adathordozó',
  mediaBlankSuffix: ', üres',
  noDisc: 'Nincs lemez',
  capacityLabel: 'Kapacitás',
  capacityValue: '{{minutes}} · {{sectors}} szektor',
  platformUnsupported: 'A CD-írás ezen a platformon nem érhető el.',

  ringLabel: 'Lemezkapacitás: {{count}} szám, {{used}} felhasználva ebből: {{capacity}}',
  hubRemaining: 'HÁTRAVAN',
  hubOverCapacity: 'TÚLLÉPÉS',
  hubTrackOf: '{{number}}. szám a(z) {{total}}-ból',
  hubTrackCount_one: '{{count}} szám',
  hubTrackCount_other: '{{count}} szám',
  hubPhaseNote: {
    fetching: 'Letöltés a kiszolgálóról',
    analyzing: 'Hangerő mérése',
    rendering: 'Átalakítás CD-hanggá',
    preparing: 'Lemez előkészítése',
    writing: 'Írás a lemezre',
    closing: 'Lemez lezárása',
  },

  runningOrder: 'Lejátszási sorrend',

  colNumber: '#',
  colTrack: 'Szám',
  colArtist: 'Előadó',
  colTime: 'Idő',
  colStart: 'Kezdet',

  metricHeadroom: 'Tartalék',
  metricOverBy: 'Túllépés',
  metricToFetch: 'Letöltendő',
  metricWritten: 'Kiírva',
  metricTook: 'Időtartam',

  modeLabel: 'Írási mód',
  modeBurn: 'Írás',
  modeRehearse: 'Próba',

  prepareStopFree: 'Még semmi nem került kiírásra — a leállítás most nem kerül semmibe.',
  abort: 'Írás megszakítása',
  abortConfirm: 'Lemez tönkretétele',
  burnAnother: 'Újabb írása',

  outcomeWritten: 'Lemez kiírva — {{count}} szám · {{duration}} · időtartam: {{elapsed}}',
  outcomeRehearsed: 'A próba befejeződött. Semmi nem került a lemezre.',
  outcomeFailed: 'Az írás nem sikerült.',
  outcomeCancelled: 'Az írás leállt.',
  discSpoiled: 'Ez a CD-R részben íródott, és nem használható újra.',
  discBlank: 'Semmi nem került kiírásra; a lemez továbbra is üres.',
  failHintBuffer:
    'A meghajtónak elfogyott a kiírandó hang. Általában segít a nehéz lemezműveletek bezárása és a lassabb írás.',
  failHintMedia: 'Ellenőrizd a lemezt: egy hang-CD-hez üres CD-R vagy CD-RW kell.',
  failHintPermission: 'Valami más foglalja a meghajtót. Zárd be, és próbáld újra.',

  speedTraceLabel: 'Írás {{now}}× sebességgel, legalacsonyabb {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} szám',
  trackCount_other: '{{count}} szám',
  emptyTitle: 'Még nincs szám a sorban.',
  emptyHint:
    'Kattints jobb gombbal egy számra, albumra vagy lejátszási listára, és válaszd a „Hozzáadás a CD-hez” lehetőséget.',
  fetchNote:
    'A helyben nem gyorsítótárazott számok az írás indításakor automatikusan letöltődnek.',
  removeTrack: '{{title}} eltávolítása',
  rowWritten: 'Kiírva a lemezre',
  trackWillDownloadHint:
    'Még nincs a helyi gyorsítótárban. Az írás letölti a kiszolgálóról, mielőtt írna.',
  willDownload_one:
    'Először {{count}} szám töltődik le (körülbelül {{size}}). Semmi nem kerül az offline könyvtáradba.',
  willDownload_other:
    'Először {{count}} szám töltődik le (körülbelül {{size}}). Semmi nem kerül az offline könyvtáradba.',

  metricElapsed: 'Eltelt idő',
  metricRemaining: 'Hátralévő idő',
  metricTotal: 'Teljes idő',
  metricRuntime: 'Lemez hossza',
  metricSpeed: 'Írás {{speed}}× sebességgel',

  options: 'Írási beállítások',
  writeSpeed: 'Írási sebesség',
  speedAuto: 'Automatikus',
  gapless: 'Szünet nélkül',
  gaplessHint: 'Nincs 2 másodperces szünet a számok között. Disc-At-Once, mint egy préselt CD-n.',
  normalize: 'Hangerők kiegyenlítése',
  normalizeHint:
    'Megméri a hangerőt és szintezi minden számot, hogy egy válogatás egyenletesen szóljon.',
  ejectWhenDone: 'Kiadás a végén',
  cdText: 'CD-TEXT írása',
  cdTextHint:
    'A számok és előadók nevét a lemezre menti, azoknak a lejátszóknak, amelyek meg tudják jeleníteni. A meghajtód jelzi, hogy erre képes.',
  cdTextUnavailable: 'Ez a meghajtó nem tud CD-TEXT-et írni.',
  cdTextNoAnswer:
    'Ez a meghajtó nem jelezte az írási képességeit, ezért a CD-TEXT nem ajánlható fel biztonságosan.',
  cdTextNoSao: 'A CD-TEXT Session-At-Once írást igényel, amit ez a meghajtó nem támogat.',
  cdTextNoSubchannel:
    'Ez a meghajtó nem tudja írni az R-W alcsatornát, amelyben a CD-TEXT él. A lemez így is megíródik, csak a számnevek nélkül.',

  startBurn: 'Lemez írása',
  startTestWrite: 'Próbaírás',
  cancel: 'Leállítás',
  cancelling: 'Leállítás…',
  clear: 'Ürítés',

  alertReady_one: 'Kész · {{count}} szám · {{runtime}} · {{free}} szabad',
  alertReady_other: 'Kész · {{count}} szám · {{runtime}} · {{free}} szabad',
  alertNoDisc: 'Tegyél üres CD-R lemezt a meghajtóba ennek a sorrendnek a kiírásához.',
  alertMore_one: 'Még 1 üzenet megjelenítése',
  alertMore_other: 'Még {{count}} üzenet megjelenítése',

  pillRehearsal: 'Próba',
  pillWriting: 'Írás',

  seamLabel: 'A lejátszási sorrend szélessége',
  seamValue: '{{px}} képpont',

  movedTo: '{{title}} a(z) {{position}}. helyre került a(z) {{total}}-ból',
  removedAnnounce: '{{title}} eltávolítva',

  cancelSpoilsDisc:
    'A CD-R most íródik. A leállítás használhatatlanná teszi a lemezt — a CD-R nem írható újra.',

  mediaBlockerNoDisc: 'Nincs lemez a meghajtóban.',
  mediaBlockerNotCd: 'Ez {{mediaType}}. Egy hang-CD-hez üres CD-R vagy CD-RW kell.',
  mediaBlockerAlreadyWritten: 'Ez a lemez már meg van írva és le van zárva, ezért nem írható.',
  mediaBlockerNotBlankRewritable: 'Ez a CD-RW már tartalmaz adatot. Töröld írás előtt.',
  mediaBlockerNotBlankRecordable: 'Ez a CD-R nem üres. A hang-CD-t egy menetben kell megírni.',
  mediaBlockerDriveRefused: 'A meghajtó nem fogadja el ezt a lemezt.',
  mediaBlockerDriveSilent: 'A meghajtó nem adott leírást erről a lemezről.',
  mediaBlockerUnknown: 'Erre a lemezre nem lehet írni.',

  blockerEmpty: 'Adj hozzá legalább egy számot lemez írásához.',
  blockerOverCapacity:
    'A kapacitás {{over}} értékkel túllépve. Távolíts el egy számot, vagy használj 80 perces lemezt.',
  blockerTooManyTracks: 'Egy CD-re legfeljebb {{max}} szám fér; ebben a sorban {{count}} van.',

  past74:
    '74:00 felett. Ráfér erre a lemezre, de néhány régebbi CD-lejátszó ezen túl nehezen boldogul.',

  readoutPhase: 'Fázis',
  readoutMode: 'Írási mód',
  readoutPosition: 'Pozíció (MSF)',
  readoutSectors: 'Szektorok',
  readoutBuffer: 'Puffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Tétlen',
  phaseRehearsing: 'Próba folyamatban',
  phase: {
    fetching: 'Letöltés',
    analyzing: 'Elemzés',
    rendering: 'Átalakítás',
    preparing: 'Előkészítés',
    writing: 'Írás',
    closing: 'Lezárás',
  },

  toastAdded_one: '{{count}} szám hozzáadva a CD-hez.',
  toastAdded_other: '{{count}} szám hozzáadva a CD-hez.',
  toastAddedSome_one:
    '{{count}} szám hozzáadva; {{skipped}} kihagyva, mert már a sorban volt vagy túllépte a korlátot.',
  toastAddedSome_other:
    '{{count}} szám hozzáadva; {{skipped}} kihagyva, mert már a sorban volt vagy túllépte a korlátot.',
  toastNewDiscStarted: 'Új lemez indult. Az előző írás sorrendje törölve lett.',
  toastAlreadyQueued: 'Már rajta van a CD-n.',
  toastDiscFull: 'A lemezen már a maximális {{max}} szám van.',
  toastBurnInProgress: 'Írás van folyamatban. Állítsd le, mielőtt módosítod a sort.',
  toastCancelled: 'Az írás leállt.',
  toastBurnDone_one: 'Lemez kiírva — {{count}} szám.',
  toastBurnDone_other: 'Lemez kiírva — {{count}} szám.',
  toastCdTextSkipped:
    'A lemez CD-TEXT nélkül íródott — ez a meghajtó itt nem tudta megírni, ezért a lejátszók nem jelenítik meg a számneveket.',
  toastTestWriteDone: 'A próbaírás befejeződött. Semmi nem került a lemezre.',
  toastCdTextVerified_one: 'CD-TEXT ellenőrizve a lemezen ({{count}} csomag).',
  toastCdTextVerified_other: 'CD-TEXT ellenőrizve a lemezen ({{count}} csomag).',
  toastCdTextUnconfirmed:
    'A lemez megíródott és a hang rendben van, de visszaolvasáskor nem található CD-TEXT. A meghajtók gyakran a behelyezés pillanatától őrzik a lemez tartalmát, így ez lehet elavult olvasás is — próbáld ki a lemezt olyan lejátszóban, amely megjeleníti a számneveket.',
  toastCdTextUnreadable:
    'A lemez megíródott és a hang rendben van. Ez a meghajtó nem közölte a lemez CD-TEXT-jét, ezért itt nem erősíthető meg, hogy megíródott-e — próbáld ki a lemezt olyan lejátszóban, amely megjeleníti a számneveket.',

  trackListing: 'Számlista',
  listingUntitled: 'Válogatás CD',
  listingSummary_one: '{{count}} szám · {{duration}}',
  listingSummary_other: '{{count}} szám · {{duration}}',
  listingCopy: 'Másolás',
  listingCopied: 'Számlista másolva.',
  listingCopyFailed: 'A számlistát nem sikerült másolni.',
  listingSave: '.txt mentése',
  listingSaveTitle: 'Számlista mentése',
  listingSaved: 'Számlista mentve.',
  listingPrint: 'Nyomtatás',

  addToCd: 'Hozzáadás a CD-hez',
};
