export const burner = {
  title: 'Masterizzatore CD',
  discTitleLabel: 'Titolo del disco',
  discTitlePlaceholder: 'Dai un nome a questo disco…',

  // Drive + media
  recorder: 'Masterizzatore',
  noRecorders: 'Nessun masterizzatore CD trovato',
  refreshDrives: 'Aggiorna unità',
  eraseDisc: 'Cancella disco',
  reloadDisc: 'Ricarica disco',
  reloading: 'Espulsione del disco…',
  reloadDone: 'Disco espulso. Reinseriscilo, poi premi Aggiorna.',
  reloadHint:
    'L’unità potrebbe ancora descrivere il disco com’era alla fine dell’ultima prova. Espellerlo e ricaricarlo la costringe a rileggerlo.',
  erasing: 'Cancellazione del disco…',
  eraseDone: 'Disco cancellato.',
  mediaLabel: 'Supporto',
  mediaBlankSuffix: ', vuoto',
  noDisc: 'Nessun disco',
  capacityLabel: 'Capacità',
  capacityValue: '{{minutes}} · {{sectors}} settori',
  platformUnsupported: 'La masterizzazione di CD non è disponibile su questa piattaforma.',

  // Ring
  ringLabel: 'Capacità del disco: {{count}} brani, {{used}} usati su {{capacity}}',
  hubRemaining: 'RIMANENTE',
  hubOverCapacity: 'ECCEDENZA',
  hubTrackOf: 'Brano {{number}} di {{total}}',
  hubTrackCount_one: '{{count}} brano',
  hubTrackCount_many: '{{count}} brani',
  hubTrackCount_other: '{{count}} brani',
  // One per phase. Nothing here claims the disc is being written until it is.
  hubPhaseNote: {
    fetching: 'Download dal tuo server',
    analyzing: 'Misurazione del volume',
    rendering: 'Conversione in audio CD',
    preparing: 'Preparazione del disco',
    writing: 'Scrittura sul disco',
    closing: 'Finalizzazione del disco',
  },


  // Running order
  runningOrder: 'Scaletta',

  // Column headings for the running order. Terse on purpose: they sit at 10px
  // in a row 24px tall, and the numbers beneath them are what is being read.
  colNumber: '#',
  colTrack: 'Brano',
  colArtist: 'Artista',
  colTime: 'Durata',
  colStart: 'Inizio',

  // Metrics, which change with what the page is doing.
  metricHeadroom: 'Spazio libero',
  metricOverBy: 'Eccedenza',
  metricToFetch: 'Da scaricare',
  metricWritten: 'Scritto',
  metricTook: 'Durata',

  // The mode, beside the button it changes.
  modeLabel: 'Modalità di scrittura',
  modeBurn: 'Masterizza',
  modeRehearse: 'Prova',

  // Stopping. Only one of these costs anything.
  prepareStopFree: 'Non è ancora stato scritto nulla: fermarsi ora non costa niente.',
  abort: 'Interrompi masterizzazione',
  abortConfirm: 'Rovina il disco',
  burnAnother: 'Masterizzane un altro',

  // What happened, and what the disc is now. The two are said separately: a
  // rehearsal can fail and leave a perfectly good blank, and a real burn can be
  // stopped one sector in and leave a coaster.
  outcomeWritten: 'Disco scritto — {{count}} brani · {{duration}} · in {{elapsed}}',
  outcomeRehearsed: 'Prova terminata. Non è stato scritto nulla sul disco.',
  outcomeFailed: 'La masterizzazione non è riuscita.',
  outcomeCancelled: 'La masterizzazione è stata interrotta.',
  discSpoiled: 'Questo CD-R è stato scritto in parte e non può essere riutilizzato.',
  discBlank: 'Non è stato scritto nulla; il disco è ancora vuoto.',
  failHintBuffer:
    'All’unità è mancato l’audio da scrivere. Di solito si risolve chiudendo i processi che usano molto il disco e masterizzando più lentamente.',
  failHintMedia: 'Controlla il disco: un CD audio richiede un CD-R o CD-RW vuoto.',
  failHintPermission: 'Un altro programma sta usando l’unità. Chiudilo e riprova.',

  speedTraceLabel: 'Scrittura a {{now}}×, minimo {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} brano',
  trackCount_many: '{{count}} brani',
  trackCount_other: '{{count}} brani',
  emptyTitle: 'Nessun brano in coda.',
  emptyHint: 'Fai clic destro su un brano, un album o una playlist e scegli “Aggiungi al CD”.',
  fetchNote: 'I brani non presenti nella cache locale vengono scaricati automaticamente all’avvio della masterizzazione.',
  removeTrack: 'Rimuovi {{title}}',
  rowWritten: 'Scritto sul disco',
  trackWillDownloadHint:
    'Non ancora nella cache locale. La masterizzazione lo scarica dal tuo server prima di scriverlo.',
  willDownload_one:
    'Verrà prima scaricato {{count}} brano (circa {{size}}). Nulla viene aggiunto alla tua libreria offline.',
  willDownload_many:
    'Verranno prima scaricati {{count}} brani (circa {{size}}). Nulla viene aggiunto alla tua libreria offline.',
  willDownload_other:
    'Verranno prima scaricati {{count}} brani (circa {{size}}). Nulla viene aggiunto alla tua libreria offline.',

  // Metrics column
  metricElapsed: 'Tempo trascorso',
  metricRemaining: 'Tempo rimanente',
  metricTotal: 'Tempo totale',
  metricRuntime: 'Durata del disco',
  metricSpeed: 'Scrittura a {{speed}}×',

  // Options
  options: 'Opzioni di masterizzazione',
  writeSpeed: 'Velocità di scrittura',
  speedAuto: 'Automatica',
  gapless: 'Senza pause (gapless)',
  gaplessHint: 'Nessuna pausa di 2 secondi tra i brani. Disc-At-Once, come un CD stampato.',
  normalize: 'Uniforma il volume dei brani',
  normalizeHint: 'Analizza il volume e livella ogni brano, così una compilation suona omogenea.',
  ejectWhenDone: 'Espelli al termine',
  cdText: 'Scrivi CD-TEXT',
  cdTextHint:
    'Salva sul disco i nomi di brani e artisti, per i lettori in grado di mostrarli. La tua unità segnala di supportarlo.',
  cdTextUnavailable: 'Questa unità non può scrivere CD-TEXT.',
  cdTextNoAnswer:
    'Questa unità non ha comunicato le sue capacità di scrittura, quindi il CD-TEXT non può essere offerto in sicurezza.',
  cdTextNoSao:
    'Il CD-TEXT richiede la registrazione Session-At-Once, che questa unità non supporta.',
  cdTextNoSubchannel:
    'Questa unità non può scrivere il sottocanale R-W in cui risiede il CD-TEXT. Il disco verrà comunque masterizzato, senza i nomi dei brani.',

  // Transport
  startBurn: 'Masterizza disco',
  startTestWrite: 'Scrittura di prova',
  cancel: 'Ferma',
  cancelling: 'Interruzione…',
  clear: 'Svuota',

  // The gutter between the disc and the running order.
  // The always-present line above the split. The idle variants are the ones
  // that show when there is nothing wrong, so they say what the disc will be
  // rather than leaving the page silent.
  alertReady_one: 'Pronto · {{count}} brano · {{runtime}} · {{free}} liberi',
  alertReady_many: 'Pronto · {{count}} brani · {{runtime}} · {{free}} liberi',
  alertReady_other: 'Pronto · {{count}} brani · {{runtime}} · {{free}} liberi',
  alertNoDisc: 'Inserisci un CD-R vuoto nell’unità per masterizzare questa scaletta.',
  alertMore_one: 'Mostra 1 altro messaggio',
  alertMore_many: 'Mostra altri {{count}} messaggi',
  alertMore_other: 'Mostra altri {{count}} messaggi',

  // A rehearsal keeps saying so the whole way through: a job that reports
  // sectors with the laser off is exactly the one that can be misread as a
  // real burn.
  pillRehearsal: 'Prova',
  pillWriting: 'Scrittura',

  seamLabel: 'Larghezza della scaletta',
  seamValue: '{{px}} pixel',

  // Reordering and removal are silent to a screen reader without these.
  movedTo: '{{title}} spostato in posizione {{position}} di {{total}}',
  removedAnnounce: '{{title}} rimosso',


  cancelSpoilsDisc:
    'Il CD-R è in fase di masterizzazione. Fermarsi ora lo rende inutilizzabile: un CD-R non può essere riscritto.',

  // Blockers
  // What the drive says about the disc in it. The backend sends a code
  // rather than a sentence, so these can be translated.
  mediaBlockerNoDisc: 'Nessun disco nell’unità.',
  mediaBlockerNotCd: 'Questo è un {{mediaType}}. I CD audio richiedono un CD-R o CD-RW vuoto.',
  mediaBlockerAlreadyWritten:
    'Questo disco è già stato scritto e chiuso, quindi non è possibile scriverci.',
  mediaBlockerNotBlankRewritable: 'Questo CD-RW contiene già dati. Cancellalo prima di masterizzare.',
  mediaBlockerNotBlankRecordable: 'Questo CD-R non è vuoto. I CD audio devono essere scritti in un’unica passata.',
  mediaBlockerDriveRefused: 'L’unità non accetta questo disco.',
  mediaBlockerDriveSilent: 'L’unità non ha fornito informazioni su questo disco.',
  mediaBlockerUnknown: 'Impossibile scrivere su questo disco.',

  blockerEmpty: 'Aggiungi almeno un brano per masterizzare un disco.',
  blockerOverCapacity: 'Capacità superata di {{over}}. Rimuovi un brano o usa un disco da 80 minuti.',
  blockerTooManyTracks: 'Un CD contiene al massimo {{max}} brani; questa coda ne ha {{count}}.',

  // An advisory, not a blocker: the queue fits the disc in the drive, but runs
  // past the 74 minutes Red Book actually specifies.
  past74: 'Oltre 74:00. Entra in questo disco, ma alcuni lettori CD più vecchi potrebbero avere problemi oltre quel limite.',

  // Readout
  readoutPhase: 'Fase',
  readoutMode: 'Modalità di scrittura',
  readoutPosition: 'Posizione (MSF)',
  readoutSectors: 'Settori',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inattivo',
  // Shown instead of the phase while a rehearsal writes with the laser off.
  phaseRehearsing: 'Prova in corso',
  phase: {
    fetching: 'Download',
    analyzing: 'Analisi',
    rendering: 'Conversione',
    preparing: 'Preparazione',
    writing: 'Scrittura',
    closing: 'Chiusura',
  },

  // Toasts
  toastAdded_one: '{{count}} brano aggiunto al CD.',
  toastAdded_many: '{{count}} brani aggiunti al CD.',
  toastAdded_other: '{{count}} brani aggiunti al CD.',
  toastAddedSome_one: '{{count}} brano aggiunto; {{skipped}} saltati perché già in coda o oltre il limite.',
  toastAddedSome_many: '{{count}} brani aggiunti; {{skipped}} saltati perché già in coda o oltre il limite.',
  toastAddedSome_other: '{{count}} brani aggiunti; {{skipped}} saltati perché già in coda o oltre il limite.',
  toastNewDiscStarted: 'Nuovo disco avviato. La scaletta dell’ultima masterizzazione è stata svuotata.',
  toastAlreadyQueued: 'Già presente nel CD.',
  toastDiscFull: 'Il disco contiene già il massimo di {{max}} brani.',
  // A running job took its track list when it started, so anything added
  // after that would show a running order the drive is not writing.
  toastBurnInProgress: 'Masterizzazione in corso. Fermala prima di modificare la coda.',
  toastCancelled: 'Masterizzazione interrotta.',
  toastBurnDone_one: 'Disco scritto — {{count}} brano.',
  toastBurnDone_many: 'Disco scritto — {{count}} brani.',
  toastBurnDone_other: 'Disco scritto — {{count}} brani.',
  toastCdTextSkipped:
    'Il disco è stato masterizzato senza CD-TEXT: questa unità non è riuscita a scriverlo, quindi i lettori non mostreranno i nomi dei brani.',
  toastTestWriteDone: 'Scrittura di prova terminata. Non è stato scritto nulla sul disco.',
  toastCdTextVerified_one: 'CD-TEXT verificato sul disco ({{count}} pacchetto).',
  toastCdTextVerified_many: 'CD-TEXT verificato sul disco ({{count}} pacchetti).',
  toastCdTextVerified_other: 'CD-TEXT verificato sul disco ({{count}} pacchetti).',
  toastCdTextUnconfirmed:
    'Il disco è stato masterizzato e l’audio è a posto, ma rileggendolo non è stato trovato alcun CD-TEXT. Spesso le unità memorizzano il contenuto del disco al momento dell’inserimento, quindi potrebbe trattarsi solo di una lettura non aggiornata: prova il disco in un lettore che mostra i nomi dei brani.',
  toastCdTextUnreadable:
    'Il disco è stato masterizzato e l’audio è a posto. Questa unità non ha restituito il CD-TEXT del disco, quindi qui non è possibile confermare se sia stato scritto: prova il disco in un lettore che mostra i nomi dei brani.',

  // Track listing
  trackListing: 'Elenco dei brani',
  listingUntitled: 'CD mix',
  listingSummary_one: '{{count}} brano · {{duration}}',
  listingSummary_many: '{{count}} brani · {{duration}}',
  listingSummary_other: '{{count}} brani · {{duration}}',
  listingCopy: 'Copia',
  listingCopied: 'Elenco dei brani copiato.',
  listingCopyFailed: 'Impossibile copiare l’elenco dei brani.',
  listingSave: 'Salva .txt',
  listingSaveTitle: 'Salva l’elenco dei brani',
  listingSaved: 'Elenco dei brani salvato.',
  listingPrint: 'Stampa',

  // Context menu
  addToCd: 'Aggiungi al CD',
};
