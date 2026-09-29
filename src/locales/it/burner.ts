export const burner = {
  title: 'Masterizzatore CD',
  discTitleLabel: 'Titolo del disco',
  discTitlePlaceholder: 'Dai un nome a questo disco…',

  recorder: 'Masterizzatore',
  noRecorders: 'Nessun masterizzatore CD trovato',
  refreshDrives: 'Aggiorna unità',
  eraseDisc: 'Cancella disco',
  reloadDisc: 'Ricarica disco',
  reloading: 'Espulsione del disco…',
  reloadDone: 'Disco espulso. Reinseriscilo, poi premi Aggiorna.',
  reloadHint:
    'L’unità potrebbe descrivere ancora questo disco come era alla fine dell’ultima prova. Espellerlo e ricaricarlo la costringe a guardarlo di nuovo.',
  erasing: 'Cancellazione del disco…',
  eraseDone: 'Disco cancellato.',
  mediaLabel: 'Supporto',
  mediaBlankSuffix: ', vuoto',
  noDisc: 'Nessun disco',
  capacityLabel: 'Capacità',
  capacityValue: '{{minutes}} · {{sectors}} settori',
  platformUnsupported: 'La masterizzazione di CD non è disponibile su questa piattaforma.',

  ringLabel: 'Capacità del disco: {{count}} brani, {{used}} usati su {{capacity}}',
  hubRemaining: 'RIMANENTE',
  hubOverCapacity: 'OLTRE DI',
  hubTrackOf: 'Brano {{number}} di {{total}}',
  hubTrackCount_one: '{{count}} brano',
  hubTrackCount_other: '{{count}} brani',
  hubPhaseNote: {
    fetching: 'Download dal tuo server',
    analyzing: 'Misurazione del volume',
    rendering: 'Conversione in audio CD',
    preparing: 'Preparazione del disco',
    writing: 'Scrittura sul disco',
    closing: 'Finalizzazione del disco',
  },

  runningOrder: 'Scaletta',

  colNumber: '#',
  colTrack: 'Brano',
  colArtist: 'Artista',
  colTime: 'Durata',
  colStart: 'Inizio',

  metricHeadroom: 'Margine',
  metricOverBy: 'Oltre di',
  metricToFetch: 'Da scaricare',
  metricWritten: 'Scritti',
  metricTook: 'Durata',

  modeLabel: 'Modalità di scrittura',
  modeBurn: 'Masterizza',
  modeRehearse: 'Prova',

  prepareStopFree: 'Non è stato ancora scritto nulla: fermarsi ora non costa niente.',
  abort: 'Annulla la masterizzazione',
  abortConfirm: 'Rovina il disco',
  burnAnother: 'Masterizza un altro',

  outcomeWritten: 'Disco masterizzato — {{count}} brani · {{duration}} · durata {{elapsed}}',
  outcomeRehearsed: 'Prova completata. Non è stato scritto nulla sul disco.',
  outcomeFailed: 'La masterizzazione non è riuscita.',
  outcomeCancelled: 'La masterizzazione è stata interrotta.',
  discSpoiled: 'Questo CD-R è stato scritto in parte e non può essere riutilizzato.',
  discBlank: 'Non è stato scritto nulla; il disco è ancora vuoto.',
  failHintBuffer:
    'All’unità è finito l’audio da scrivere. Chiudere le operazioni su disco più pesanti e masterizzare più lentamente di solito risolve.',
  failHintMedia: 'Controlla il disco: un CD audio richiede un CD-R o CD-RW vuoto.',
  failHintPermission: 'Qualcos’altro sta occupando l’unità. Chiudilo e riprova.',

  speedTraceLabel: 'Scrittura a {{now}}×, minimo {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} brano',
  trackCount_other: '{{count}} brani',
  emptyTitle: 'Nessun brano in coda per ora.',
  emptyHint: 'Fai clic destro su un brano, un album o una playlist e scegli « Aggiungi al CD ».',
  fetchNote:
    'I brani non presenti nella cache locale vengono scaricati automaticamente all’avvio della masterizzazione.',
  removeTrack: 'Rimuovi {{title}}',
  rowWritten: 'Scritto sul disco',
  trackWillDownloadHint:
    'Non ancora nella cache locale. La masterizzazione lo scarica dal tuo server prima di scrivere.',
  willDownload_one:
    '{{count}} brano verrà scaricato prima (circa {{size}}). Nulla viene aggiunto alla tua libreria offline.',
  willDownload_other:
    '{{count}} brani verranno scaricati prima (circa {{size}}). Nulla viene aggiunto alla tua libreria offline.',

  metricElapsed: 'Tempo trascorso',
  metricRemaining: 'Tempo rimanente',
  metricTotal: 'Tempo totale',
  metricRuntime: 'Durata del disco',
  metricSpeed: 'Scrittura a {{speed}}×',

  options: 'Opzioni di masterizzazione',
  writeSpeed: 'Velocità di scrittura',
  speedAuto: 'Automatica',
  gapless: 'Senza pause',
  gaplessHint: 'Nessuna pausa di 2 secondi tra i brani. Disc-At-Once, come un CD stampato.',
  normalize: 'Uniforma i livelli',
  normalizeHint: 'Analizza il volume e livella ogni brano, così una raccolta suona uniforme.',
  ejectWhenDone: 'Espelli al termine',
  cdText: 'Scrivi CD-TEXT',
  cdTextHint:
    'Salva i nomi di brano e artista sul disco, per i lettori che sanno mostrarli. La tua unità dichiara di poterlo fare.',
  cdTextUnavailable: 'Questa unità non può scrivere il CD-TEXT.',
  cdTextNoAnswer:
    'Questa unità non ha dichiarato le sue capacità di scrittura, quindi il CD-TEXT non può essere offerto in sicurezza.',
  cdTextNoSao:
    'Il CD-TEXT richiede la registrazione Session-At-Once, che questa unità non supporta.',
  cdTextNoSubchannel:
    'Questa unità non può scrivere il sottocanale R-W in cui risiede il CD-TEXT. Il disco verrà masterizzato lo stesso, senza i nomi dei brani.',

  startBurn: 'Masterizza disco',
  startTestWrite: 'Scrittura di prova',
  cancel: 'Ferma',
  cancelling: 'Interruzione…',
  clear: 'Svuota',

  alertReady_one: 'Pronto · {{count}} brano · {{runtime}} · {{free}} liberi',
  alertReady_other: 'Pronto · {{count}} brani · {{runtime}} · {{free}} liberi',
  alertNoDisc: 'Inserisci un CD-R vuoto nell’unità per masterizzare questa scaletta.',
  alertMore_one: 'Mostra 1 altro messaggio',
  alertMore_other: 'Mostra altri {{count}} messaggi',

  pillRehearsal: 'Prova',
  pillWriting: 'Scrittura',

  seamLabel: 'Larghezza della scaletta',
  seamValue: '{{px}} pixel',

  movedTo: '{{title}} spostato in posizione {{position}} di {{total}}',
  removedAnnounce: '{{title}} rimosso',

  cancelSpoilsDisc:
    'Il CD-R è in fase di masterizzazione. Fermarlo rende il disco inutilizzabile — un CD-R non può essere riscritto.',

  mediaBlockerNoDisc: 'Nessun disco nell’unità.',
  mediaBlockerNotCd: 'Questo è {{mediaType}}. Un CD audio richiede un CD-R o CD-RW vuoto.',
  mediaBlockerAlreadyWritten:
    'Questo disco è già stato scritto e chiuso, quindi non può essere scritto.',
  mediaBlockerNotBlankRewritable:
    'Questo CD-RW contiene già dati. Cancellalo prima di masterizzare.',
  mediaBlockerNotBlankRecordable:
    'Questo CD-R non è vuoto. I CD audio devono essere scritti in una sola volta.',
  mediaBlockerDriveRefused: 'L’unità non accetta questo disco.',
  mediaBlockerDriveSilent: 'L’unità non ha descritto questo disco.',
  mediaBlockerUnknown: 'Questo disco non può essere scritto.',

  blockerEmpty: 'Aggiungi almeno un brano per masterizzare un disco.',
  blockerOverCapacity:
    'Capacità superata di {{over}}. Rimuovi un brano o usa un disco da 80 minuti.',
  blockerTooManyTracks: 'Un CD contiene al massimo {{max}} brani; questa coda ne ha {{count}}.',

  past74:
    'Oltre 74:00. Sta su questo disco, ma alcuni lettori CD più vecchi faticano oltre quel punto.',

  readoutPhase: 'Fase',
  readoutMode: 'Modalità di scrittura',
  readoutPosition: 'Posizione (MSF)',
  readoutSectors: 'Settori',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inattivo',
  phaseRehearsing: 'Prova in corso',
  phase: {
    fetching: 'Download',
    analyzing: 'Analisi',
    rendering: 'Conversione',
    preparing: 'Preparazione',
    writing: 'Scrittura',
    closing: 'Chiusura',
  },

  toastAdded_one: 'Aggiunto {{count}} brano al CD.',
  toastAdded_other: 'Aggiunti {{count}} brani al CD.',
  toastAddedSome_one:
    'Aggiunto {{count}} brano; {{skipped}} saltati perché già in coda o oltre il limite.',
  toastAddedSome_other:
    'Aggiunti {{count}} brani; {{skipped}} saltati perché già in coda o oltre il limite.',
  toastNewDiscStarted:
    'Nuovo disco iniziato. La scaletta della masterizzazione precedente è stata svuotata.',
  toastAlreadyQueued: 'Già sul CD.',
  toastDiscFull: 'Il disco contiene già il massimo di {{max}} brani.',
  toastBurnInProgress: 'È in corso una masterizzazione. Fermala prima di modificare la coda.',
  toastCancelled: 'Masterizzazione interrotta.',
  toastBurnDone_one: 'Disco masterizzato — {{count}} brano.',
  toastBurnDone_other: 'Disco masterizzato — {{count}} brani.',
  toastCdTextSkipped:
    'Il disco è stato masterizzato senza CD-TEXT — questa unità non è riuscita a scriverlo qui, quindi i lettori non mostreranno i nomi dei brani.',
  toastTestWriteDone: 'Scrittura di prova completata. Non è stato scritto nulla sul disco.',
  toastCdTextVerified_one: 'CD-TEXT verificato sul disco ({{count}} pacchetto).',
  toastCdTextVerified_other: 'CD-TEXT verificato sul disco ({{count}} pacchetti).',
  toastCdTextUnconfirmed:
    'Il disco è stato masterizzato e l’audio è a posto, ma rileggendolo non è stato trovato alcun CD-TEXT. Le unità spesso conservano il contenuto del disco dal momento in cui è stato inserito, quindi può essere una lettura non aggiornata: prova il disco in un lettore che mostra i nomi dei brani.',
  toastCdTextUnreadable:
    'Il disco è stato masterizzato e l’audio è a posto. Questa unità non ha voluto riportare il CD-TEXT del disco, quindi qui non si può confermare se sia stato scritto: prova il disco in un lettore che mostra i nomi dei brani.',

  trackListing: 'Elenco brani',
  listingUntitled: 'CD compilation',
  listingSummary_one: '{{count}} brano · {{duration}}',
  listingSummary_other: '{{count}} brani · {{duration}}',
  listingCopy: 'Copia',
  listingCopied: 'Elenco brani copiato.',
  listingCopyFailed: 'Impossibile copiare l’elenco brani.',
  listingSave: 'Salva .txt',
  listingSaveTitle: 'Salva l’elenco brani',
  listingSaved: 'Elenco brani salvato.',
  listingPrint: 'Stampa',

  addToCd: 'Aggiungi al CD',
};
