export const burner = {
  title: 'CD-brenner',
  discTitleLabel: 'Platetittel',
  discTitlePlaceholder: 'Gi denne platen et navn…',

  recorder: 'Brenner',
  noRecorders: 'Fant ingen CD-brenner',
  refreshDrives: 'Oppdater stasjoner',
  eraseDisc: 'Slett platen',
  reloadDisc: 'Les platen på nytt',
  reloading: 'Løser ut platen…',
  reloadDone: 'Platen er løst ut. Skyv den inn igjen, og trykk deretter Oppdater.',
  reloadHint:
    'Stasjonen beskriver kanskje fortsatt denne platen slik den var da forrige prøve ble avsluttet. Å løse den ut og laste den inn igjen får den til å se etter på nytt.',
  erasing: 'Sletter platen…',
  eraseDone: 'Platen er slettet.',
  mediaLabel: 'Medium',
  mediaBlankSuffix: ', tom',
  noDisc: 'Ingen plate',
  capacityLabel: 'Kapasitet',
  capacityValue: '{{minutes}} · {{sectors}} sektorer',
  platformUnsupported: 'CD-brenning er ikke tilgjengelig på denne plattformen.',

  ringLabel: 'Platekapasitet: {{count}} spor, {{used}} brukt av {{capacity}}',
  hubRemaining: 'GJENSTÅR',
  hubOverCapacity: 'OVER MED',
  hubTrackOf: 'Spor {{number}} av {{total}}',
  hubTrackCount_one: '{{count}} spor',
  hubTrackCount_other: '{{count}} spor',
  hubPhaseNote: {
    fetching: 'Laster ned fra serveren din',
    analyzing: 'Måler lydstyrke',
    rendering: 'Konverterer til CD-lyd',
    preparing: 'Forbereder platen',
    writing: 'Skriver til platen',
    closing: 'Ferdigstiller platen',
  },

  runningOrder: 'Rekkefølge',

  colNumber: '#',
  colTrack: 'Spor',
  colArtist: 'Artist',
  colTime: 'Tid',
  colStart: 'Start',

  metricHeadroom: 'Margin',
  metricOverBy: 'Over med',
  metricToFetch: 'Å laste ned',
  metricWritten: 'Skrevet',
  metricTook: 'Tok',

  modeLabel: 'Skrivemodus',
  modeBurn: 'Brenn',
  modeRehearse: 'Prøve',

  prepareStopFree: 'Ingenting er skrevet ennå — å stoppe nå koster ingenting.',
  abort: 'Avbryt brenningen',
  abortConfirm: 'Ødelegg platen',
  burnAnother: 'Brenn en til',

  outcomeWritten: 'Plate brent — {{count}} spor · {{duration}} · tok {{elapsed}}',
  outcomeRehearsed: 'Prøven er ferdig. Ingenting ble skrevet til platen.',
  outcomeFailed: 'Brenningen mislyktes.',
  outcomeCancelled: 'Brenningen ble stoppet.',
  discSpoiled: 'Denne CD-R-en er delvis skrevet og kan ikke brukes på nytt.',
  discBlank: 'Ingenting ble skrevet; platen er fortsatt tom.',
  failHintBuffer:
    'Stasjonen gikk tom for lyd å skrive. Å lukke tunge diskoppgaver og brenne saktere hjelper som regel.',
  failHintMedia: 'Sjekk platen: en lyd-CD trenger en tom CD-R eller CD-RW.',
  failHintPermission: 'Noe annet holder på stasjonen. Lukk det og prøv igjen.',

  speedTraceLabel: 'Skriver på {{now}}×, laveste {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} spor',
  trackCount_other: '{{count}} spor',
  emptyTitle: 'Ingen spor i køen ennå.',
  emptyHint: 'Høyreklikk et spor, et album eller en spilleliste og velg «Legg til på CD».',
  fetchNote:
    'Spor som ikke er hurtiglagret lokalt, lastes ned automatisk når brenningen starter.',
  removeTrack: 'Fjern {{title}}',
  rowWritten: 'Skrevet til platen',
  trackWillDownloadHint:
    'Ikke hurtiglagret lokalt ennå. Brenningen laster det ned fra serveren din før den skriver.',
  willDownload_one:
    '{{count}} spor lastes ned først (omtrent {{size}}). Ingenting legges til i offline-biblioteket ditt.',
  willDownload_other:
    '{{count}} spor lastes ned først (omtrent {{size}}). Ingenting legges til i offline-biblioteket ditt.',

  metricElapsed: 'Medgått tid',
  metricRemaining: 'Gjenstående tid',
  metricTotal: 'Total tid',
  metricRuntime: 'Platens lengde',
  metricSpeed: 'Skriver på {{speed}}×',

  options: 'Brennevalg',
  writeSpeed: 'Skrivehastighet',
  speedAuto: 'Automatisk',
  gapless: 'Uten pauser',
  gaplessHint: 'Ingen pause på 2 sekunder mellom sporene. Disc-At-Once, som på en presset CD.',
  normalize: 'Jevn ut nivåene',
  normalizeHint: 'Måler lydstyrken og jevner ut hvert spor, så en samling spilles jevnt.',
  ejectWhenDone: 'Løs ut når ferdig',
  cdText: 'Skriv CD-TEXT',
  cdTextHint:
    'Lagrer spor- og artistnavn på platen, for spillere som kan vise dem. Stasjonen din melder at den kan dette.',
  cdTextUnavailable: 'Denne stasjonen kan ikke skrive CD-TEXT.',
  cdTextNoAnswer:
    'Denne stasjonen meldte ikke fra om skriveegenskapene sine, så CD-TEXT kan ikke tilbys trygt.',
  cdTextNoSao: 'CD-TEXT krever Session-At-Once-opptak, som denne stasjonen ikke støtter.',
  cdTextNoSubchannel:
    'Denne stasjonen kan ikke skrive R-W-underkanalen der CD-TEXT bor. Platen brennes likevel, uten spornavn.',

  startBurn: 'Brenn plate',
  startTestWrite: 'Prøveskriving',
  cancel: 'Stopp',
  cancelling: 'Stopper…',
  clear: 'Tøm',

  alertReady_one: 'Klar · {{count}} spor · {{runtime}} · {{free}} ledig',
  alertReady_other: 'Klar · {{count}} spor · {{runtime}} · {{free}} ledig',
  alertNoDisc: 'Legg en tom CD-R i stasjonen for å brenne denne rekkefølgen.',
  alertMore_one: 'Vis 1 melding til',
  alertMore_other: 'Vis {{count}} meldinger til',

  pillRehearsal: 'Prøve',
  pillWriting: 'Skriver',

  seamLabel: 'Bredde på rekkefølgen',
  seamValue: '{{px}} piksler',

  movedTo: '{{title}} flyttet til plass {{position}} av {{total}}',
  removedAnnounce: '{{title}} fjernet',

  cancelSpoilsDisc:
    'CD-R-en brennes nå. Å stoppe gjør platen ubrukelig — en CD-R kan ikke skrives om.',

  mediaBlockerNoDisc: 'Ingen plate i stasjonen.',
  mediaBlockerNotCd: 'Dette er {{mediaType}}. En lyd-CD trenger en tom CD-R eller CD-RW.',
  mediaBlockerAlreadyWritten:
    'Denne platen er allerede skrevet og lukket, så den kan ikke skrives til.',
  mediaBlockerNotBlankRewritable:
    'Denne CD-RW-en inneholder allerede data. Slett den før brenning.',
  mediaBlockerNotBlankRecordable: 'Denne CD-R-en er ikke tom. Lyd-CD-er må skrives i én omgang.',
  mediaBlockerDriveRefused: 'Stasjonen godtar ikke denne platen.',
  mediaBlockerDriveSilent: 'Stasjonen beskrev ikke denne platen.',
  mediaBlockerUnknown: 'Denne platen kan ikke skrives til.',

  blockerEmpty: 'Legg til minst ett spor for å brenne en plate.',
  blockerOverCapacity:
    'Over kapasiteten med {{over}}. Fjern et spor eller bruk en 80-minutters plate.',
  blockerTooManyTracks: 'En CD rommer høyst {{max}} spor; denne køen har {{count}}.',

  past74:
    'Over 74:00. Det får plass på denne platen, men enkelte eldre CD-spillere sliter forbi det.',

  readoutPhase: 'Fase',
  readoutMode: 'Skrivemodus',
  readoutPosition: 'Posisjon (MSF)',
  readoutSectors: 'Sektorer',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inaktiv',
  phaseRehearsing: 'Prøver',
  phase: {
    fetching: 'Laster ned',
    analyzing: 'Analyserer',
    rendering: 'Konverterer',
    preparing: 'Forbereder',
    writing: 'Skriver',
    closing: 'Lukker',
  },

  toastAdded_one: 'La til {{count}} spor på CD-en.',
  toastAdded_other: 'La til {{count}} spor på CD-en.',
  toastAddedSome_one:
    'La til {{count}} spor; hoppet over {{skipped}} som allerede lå i køen eller var over grensen.',
  toastAddedSome_other:
    'La til {{count}} spor; hoppet over {{skipped}} som allerede lå i køen eller var over grensen.',
  toastNewDiscStarted: 'Ny plate startet. Rekkefølgen fra forrige brenning ble tømt.',
  toastAlreadyQueued: 'Allerede på CD-en.',
  toastDiscFull: 'Platen inneholder allerede maksimalt {{max}} spor.',
  toastBurnInProgress: 'En brenning pågår. Stopp den før du endrer køen.',
  toastCancelled: 'Brenningen er stoppet.',
  toastBurnDone_one: 'Plate brent — {{count}} spor.',
  toastBurnDone_other: 'Plate brent — {{count}} spor.',
  toastCdTextSkipped:
    'Platen ble brent uten CD-TEXT — denne stasjonen fikk ikke skrevet det her, så spillere viser ikke spornavn.',
  toastTestWriteDone: 'Prøveskrivingen er ferdig. Ingenting ble skrevet til platen.',
  toastCdTextVerified_one: 'CD-TEXT bekreftet på platen ({{count}} pakke).',
  toastCdTextVerified_other: 'CD-TEXT bekreftet på platen ({{count}} pakker).',
  toastCdTextUnconfirmed:
    'Platen ble brent og lyden er i orden, men det ble ikke funnet noe CD-TEXT ved tilbakelesing. Stasjoner husker ofte innholdet på platen fra da den ble satt inn, så dette kan rett og slett være en utdatert lesing — prøv platen i en spiller som viser spornavn.',
  toastCdTextUnreadable:
    'Platen ble brent og lyden er i orden. Denne stasjonen ville ikke melde fra om platens CD-TEXT, så her kan det ikke bekreftes om det ble skrevet — prøv platen i en spiller som viser spornavn.',

  trackListing: 'Sporliste',
  listingUntitled: 'Samle-CD',
  listingSummary_one: '{{count}} spor · {{duration}}',
  listingSummary_other: '{{count}} spor · {{duration}}',
  listingCopy: 'Kopier',
  listingCopied: 'Sporlisten er kopiert.',
  listingCopyFailed: 'Kunne ikke kopiere sporlisten.',
  listingSave: 'Lagre .txt',
  listingSaveTitle: 'Lagre sporlisten',
  listingSaved: 'Sporlisten er lagret.',
  listingPrint: 'Skriv ut',

  addToCd: 'Legg til på CD',
};
