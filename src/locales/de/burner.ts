export const burner = {
  title: 'CD-Brenner',
  discTitleLabel: 'Disc-Titel',
  discTitlePlaceholder: 'Disc benennen…',

  recorder: 'Brenner',
  noRecorders: 'Kein CD-Brenner gefunden',
  refreshDrives: 'Laufwerke aktualisieren',
  eraseDisc: 'Disc löschen',
  reloadDisc: 'Disc neu einlesen',
  reloading: 'Disc wird ausgeworfen…',
  reloadDone: 'Disc ausgeworfen. Schieb sie wieder hinein und drücke dann auf Aktualisieren.',
  reloadHint:
    'Das Laufwerk beschreibt diese Disc möglicherweise noch so, wie sie beim Ende der letzten Probe war. Auswerfen und neu einlesen lässt es erneut nachsehen.',
  erasing: 'Disc wird gelöscht…',
  eraseDone: 'Disc gelöscht.',
  mediaLabel: 'Medium',
  mediaBlankSuffix: ', leer',
  noDisc: 'Keine Disc',
  capacityLabel: 'Kapazität',
  capacityValue: '{{minutes}} · {{sectors}} Sektoren',
  platformUnsupported: 'CD-Brennen ist auf dieser Plattform nicht verfügbar.',

  ringLabel: 'Disc-Kapazität: {{count}} Titel, {{used}} von {{capacity}} belegt',
  hubRemaining: 'VERBLEIBEND',
  hubOverCapacity: 'ÜBER UM',
  hubTrackOf: 'Titel {{number}} von {{total}}',
  hubTrackCount_one: '{{count}} Titel',
  hubTrackCount_other: '{{count}} Titel',
  hubPhaseNote: {
    fetching: 'Wird vom Server geladen',
    analyzing: 'Lautheit wird gemessen',
    rendering: 'Wird in CD-Audio umgewandelt',
    preparing: 'Disc wird vorbereitet',
    writing: 'Wird auf die Disc geschrieben',
    closing: 'Disc wird abgeschlossen',
  },

  runningOrder: 'Reihenfolge',

  colNumber: '#',
  colTrack: 'Titel',
  colArtist: 'Interpret',
  colTime: 'Dauer',
  colStart: 'Start',

  metricHeadroom: 'Reserve',
  metricOverBy: 'Über um',
  metricToFetch: 'Zu laden',
  metricWritten: 'Geschrieben',
  metricTook: 'Dauer',

  modeLabel: 'Schreibart',
  modeBurn: 'Brennen',
  modeRehearse: 'Probe',

  prepareStopFree: 'Es wurde noch nichts geschrieben — ein Abbruch kostet jetzt nichts.',
  abort: 'Brand abbrechen',
  abortConfirm: 'Disc verderben',
  burnAnother: 'Weitere brennen',

  outcomeWritten: 'Disc gebrannt — {{count}} Titel · {{duration}} · Dauer {{elapsed}}',
  outcomeRehearsed: 'Probe abgeschlossen. Es wurde nichts auf die Disc geschrieben.',
  outcomeFailed: 'Der Brand ist fehlgeschlagen.',
  outcomeCancelled: 'Der Brand wurde gestoppt.',
  discSpoiled: 'Diese CD-R wurde teilweise beschrieben und lässt sich nicht wiederverwenden.',
  discBlank: 'Es wurde nichts geschrieben; die Disc ist weiterhin leer.',
  failHintBuffer:
    'Dem Laufwerk ging das Audiomaterial aus. Rechenintensive Programme schließen und langsamer brennen hilft meistens.',
  failHintMedia: 'Prüf die Disc: Eine Audio-CD braucht eine leere CD-R oder CD-RW.',
  failHintPermission: 'Etwas anderes belegt das Laufwerk. Schließ es und versuch es erneut.',

  speedTraceLabel: 'Schreibt mit {{now}}×, langsamster Wert {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} Titel',
  trackCount_other: '{{count}} Titel',
  emptyTitle: 'Noch keine Titel in der Warteschlange.',
  emptyHint:
    'Klick mit der rechten Maustaste auf einen Titel, ein Album oder eine Playlist und wähle „Zur CD hinzufügen“.',
  fetchNote:
    'Titel, die nicht lokal zwischengespeichert sind, werden beim Start des Brands automatisch heruntergeladen.',
  removeTrack: '{{title}} entfernen',
  rowWritten: 'Auf die Disc geschrieben',
  trackWillDownloadHint:
    'Noch nicht lokal zwischengespeichert. Der Brand lädt den Titel vor dem Schreiben vom Server.',
  willDownload_one:
    '{{count}} Titel wird zuerst heruntergeladen (etwa {{size}}). Deiner Offline-Bibliothek wird nichts hinzugefügt.',
  willDownload_other:
    '{{count}} Titel werden zuerst heruntergeladen (etwa {{size}}). Deiner Offline-Bibliothek wird nichts hinzugefügt.',

  metricElapsed: 'Vergangene Zeit',
  metricRemaining: 'Verbleibende Zeit',
  metricTotal: 'Gesamtzeit',
  metricRuntime: 'Disc-Laufzeit',
  metricSpeed: 'Schreibt mit {{speed}}×',

  options: 'Brennoptionen',
  writeSpeed: 'Schreibtempo',
  speedAuto: 'Automatisch',
  gapless: 'Lückenlos',
  gaplessHint: 'Keine 2-Sekunden-Pause zwischen den Titeln. Disc-At-Once, wie bei einer gepressten CD.',
  normalize: 'Lautstärken angleichen',
  normalizeHint:
    'Misst die Lautheit und pegelt jeden Titel, damit eine Zusammenstellung gleichmäßig klingt.',
  ejectWhenDone: 'Nach Abschluss auswerfen',
  cdText: 'CD-TEXT schreiben',
  cdTextHint:
    'Speichert Titel- und Interpretennamen auf der Disc, für Player, die sie anzeigen können. Dein Laufwerk meldet, dass es das kann.',
  cdTextUnavailable: 'Dieses Laufwerk kann kein CD-TEXT schreiben.',
  cdTextNoAnswer:
    'Dieses Laufwerk hat seine Schreibfähigkeiten nicht gemeldet, deshalb kann CD-TEXT nicht gefahrlos angeboten werden.',
  cdTextNoSao:
    'CD-TEXT benötigt Session-At-Once-Aufzeichnung, die dieses Laufwerk nicht unterstützt.',
  cdTextNoSubchannel:
    'Dieses Laufwerk kann den R-W-Subkanal nicht schreiben, in dem CD-TEXT liegt. Die Disc wird trotzdem gebrannt, nur ohne Titelnamen.',

  startBurn: 'Disc brennen',
  startTestWrite: 'Testlauf',
  cancel: 'Stopp',
  cancelling: 'Wird gestoppt…',
  clear: 'Leeren',

  alertReady_one: 'Bereit · {{count}} Titel · {{runtime}} · {{free}} frei',
  alertReady_other: 'Bereit · {{count}} Titel · {{runtime}} · {{free}} frei',
  alertNoDisc: 'Leg eine leere CD-R ein, um diese Reihenfolge zu brennen.',
  alertMore_one: '1 weitere Meldung anzeigen',
  alertMore_other: '{{count}} weitere Meldungen anzeigen',

  pillRehearsal: 'Probe',
  pillWriting: 'Schreibt',

  seamLabel: 'Breite der Reihenfolge',
  seamValue: '{{px}} Pixel',

  movedTo: '{{title}} an Position {{position}} von {{total}} verschoben',
  removedAnnounce: '{{title}} entfernt',

  cancelSpoilsDisc:
    'Die CD-R wird gerade gebrannt. Ein Stopp macht die Disc unbrauchbar — eine CD-R lässt sich nicht neu beschreiben.',

  mediaBlockerNoDisc: 'Keine Disc im Laufwerk.',
  mediaBlockerNotCd: 'Das ist {{mediaType}}. Eine Audio-CD braucht eine leere CD-R oder CD-RW.',
  mediaBlockerAlreadyWritten:
    'Diese Disc wurde bereits beschrieben und abgeschlossen und kann nicht mehr beschrieben werden.',
  mediaBlockerNotBlankRewritable: 'Diese CD-RW enthält bereits Daten. Lösche sie vor dem Brennen.',
  mediaBlockerNotBlankRecordable:
    'Diese CD-R ist nicht leer. Audio-CDs müssen in einem Durchgang geschrieben werden.',
  mediaBlockerDriveRefused: 'Das Laufwerk nimmt diese Disc nicht an.',
  mediaBlockerDriveSilent: 'Das Laufwerk machte keine Angaben zu dieser Disc.',
  mediaBlockerUnknown: 'Diese Disc kann nicht beschrieben werden.',

  blockerEmpty: 'Füge mindestens einen Titel hinzu, um eine Disc zu brennen.',
  blockerOverCapacity:
    'Kapazität um {{over}} überschritten. Entferne einen Titel oder nimm eine 80-Minuten-Disc.',
  blockerTooManyTracks: 'Eine CD fasst höchstens {{max}} Titel; diese Warteschlange hat {{count}}.',

  past74:
    'Über 74:00. Es passt auf diese Disc, aber manche älteren CD-Player kommen darüber hinaus nicht mit.',

  readoutPhase: 'Phase',
  readoutMode: 'Schreibart',
  readoutPosition: 'Position (MSF)',
  readoutSectors: 'Sektoren',
  readoutBuffer: 'Puffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Bereit',
  phaseRehearsing: 'Probe läuft',
  phase: {
    fetching: 'Lädt',
    analyzing: 'Analysiert',
    rendering: 'Wandelt um',
    preparing: 'Bereitet vor',
    writing: 'Schreibt',
    closing: 'Schließt ab',
  },

  toastAdded_one: '{{count}} Titel zur CD hinzugefügt.',
  toastAdded_other: '{{count}} Titel zur CD hinzugefügt.',
  toastAddedSome_one:
    '{{count}} Titel hinzugefügt; {{skipped}} übersprungen, weil bereits vorhanden oder über dem Limit.',
  toastAddedSome_other:
    '{{count}} Titel hinzugefügt; {{skipped}} übersprungen, weil bereits vorhanden oder über dem Limit.',
  toastNewDiscStarted:
    'Neue Disc begonnen. Die Reihenfolge des letzten Brennvorgangs wurde geleert.',
  toastAlreadyQueued: 'Bereits auf der CD.',
  toastDiscFull: 'Die Disc enthält bereits die maximalen {{max}} Titel.',
  toastBurnInProgress:
    'Es läuft gerade ein Brand. Stopp ihn, bevor du die Warteschlange änderst.',
  toastCancelled: 'Brand gestoppt.',
  toastBurnDone_one: 'Disc gebrannt — {{count}} Titel.',
  toastBurnDone_other: 'Disc gebrannt — {{count}} Titel.',
  toastCdTextSkipped:
    'Die Disc wurde ohne CD-TEXT gebrannt — dieses Laufwerk konnte ihn hier nicht schreiben, deshalb zeigen Player keine Titelnamen an.',
  toastTestWriteDone: 'Testlauf abgeschlossen. Es wurde nichts auf die Disc geschrieben.',
  toastCdTextVerified_one: 'CD-TEXT auf der Disc bestätigt ({{count}} Paket).',
  toastCdTextVerified_other: 'CD-TEXT auf der Disc bestätigt ({{count}} Pakete).',
  toastCdTextUnconfirmed:
    'Die Disc wurde gebrannt und das Audio ist in Ordnung, beim Zurücklesen wurde aber kein CD-TEXT gefunden. Laufwerke halten den Inhalt einer Disc oft von dem Moment fest, in dem sie eingelegt wurde — das kann also eine veraltete Auskunft sein. Probier die Disc in einem Player, der Titelnamen anzeigt.',
  toastCdTextUnreadable:
    'Die Disc wurde gebrannt und das Audio ist in Ordnung. Dieses Laufwerk wollte den CD-TEXT der Disc nicht melden, deshalb lässt sich hier nicht bestätigen, ob er geschrieben wurde. Probier die Disc in einem Player, der Titelnamen anzeigt.',

  trackListing: 'Titelliste',
  listingUntitled: 'Misch-CD',
  listingSummary_one: '{{count}} Titel · {{duration}}',
  listingSummary_other: '{{count}} Titel · {{duration}}',
  listingCopy: 'Kopieren',
  listingCopied: 'Titelliste kopiert.',
  listingCopyFailed: 'Die Titelliste konnte nicht kopiert werden.',
  listingSave: '.txt speichern',
  listingSaveTitle: 'Titelliste speichern',
  listingSaved: 'Titelliste gespeichert.',
  listingPrint: 'Drucken',

  addToCd: 'Zur CD hinzufügen',
};
