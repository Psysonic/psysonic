export const burner = {
  title: 'Cd-brander',
  discTitleLabel: 'Disctitel',
  discTitlePlaceholder: 'Geef deze disc een naam…',

  recorder: 'Brander',
  noRecorders: 'Geen cd-brander gevonden',
  refreshDrives: 'Stations vernieuwen',
  eraseDisc: 'Disc wissen',
  reloadDisc: 'Disc opnieuw inlezen',
  reloading: 'Disc wordt uitgeworpen…',
  reloadDone: 'Disc uitgeworpen. Duw hem er weer in en druk daarna op Vernieuwen.',
  reloadHint:
    'Het station beschrijft deze disc mogelijk nog zoals die was aan het eind van de vorige repetitie. Uitwerpen en opnieuw inlezen laat het opnieuw kijken.',
  erasing: 'Disc wordt gewist…',
  eraseDone: 'Disc gewist.',
  mediaLabel: 'Medium',
  mediaBlankSuffix: ', leeg',
  noDisc: 'Geen disc',
  capacityLabel: 'Capaciteit',
  capacityValue: '{{minutes}} · {{sectors}} sectoren',
  platformUnsupported: 'Cd branden is niet beschikbaar op dit platform.',

  ringLabel: 'Disccapaciteit: {{count}} nummers, {{used}} van {{capacity}} gebruikt',
  hubRemaining: 'RESTEREND',
  hubOverCapacity: 'OVER MET',
  hubTrackOf: 'Nummer {{number}} van {{total}}',
  hubTrackCount_one: '{{count}} nummer',
  hubTrackCount_other: '{{count}} nummers',
  hubPhaseNote: {
    fetching: 'Downloaden van je server',
    analyzing: 'Luidheid meten',
    rendering: 'Omzetten naar cd-audio',
    preparing: 'Disc voorbereiden',
    writing: 'Naar de disc schrijven',
    closing: 'Disc afsluiten',
  },

  runningOrder: 'Afspeelvolgorde',

  colNumber: '#',
  colTrack: 'Nummer',
  colArtist: 'Artiest',
  colTime: 'Duur',
  colStart: 'Start',

  metricHeadroom: 'Marge',
  metricOverBy: 'Over met',
  metricToFetch: 'Te downloaden',
  metricWritten: 'Geschreven',
  metricTook: 'Duurde',

  modeLabel: 'Schrijfmodus',
  modeBurn: 'Branden',
  modeRehearse: 'Repetitie',

  prepareStopFree: 'Er is nog niets geschreven — nu stoppen kost niets.',
  abort: 'Branden afbreken',
  abortConfirm: 'Disc verpesten',
  burnAnother: 'Nog een branden',

  outcomeWritten: 'Disc gebrand — {{count}} nummers · {{duration}} · duurde {{elapsed}}',
  outcomeRehearsed: 'Repetitie voltooid. Er is niets naar de disc geschreven.',
  outcomeFailed: 'Het branden is mislukt.',
  outcomeCancelled: 'Het branden is gestopt.',
  discSpoiled: 'Deze cd-r is gedeeltelijk beschreven en kan niet opnieuw worden gebruikt.',
  discBlank: 'Er is niets geschreven; de disc is nog leeg.',
  failHintBuffer:
    'Het station kwam zonder audio te schrijven te zitten. Zware schijftaken sluiten en langzamer branden helpt meestal.',
  failHintMedia: 'Controleer de disc: een audio-cd heeft een lege cd-r of cd-rw nodig.',
  failHintPermission: 'Iets anders houdt het station bezet. Sluit dat en probeer het opnieuw.',

  speedTraceLabel: 'Schrijft op {{now}}×, laagste {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} nummer',
  trackCount_other: '{{count}} nummers',
  emptyTitle: 'Nog geen nummers in de wachtrij.',
  emptyHint: 'Klik met rechts op een nummer, album of afspeellijst en kies „Aan cd toevoegen”.',
  fetchNote:
    'Nummers die niet lokaal in de cache staan, worden bij de start van het branden automatisch gedownload.',
  removeTrack: '{{title}} verwijderen',
  rowWritten: 'Naar de disc geschreven',
  trackWillDownloadHint:
    'Nog niet lokaal in de cache. Het branden downloadt het nummer van je server voordat er wordt geschreven.',
  willDownload_one:
    '{{count}} nummer wordt eerst gedownload (ongeveer {{size}}). Er wordt niets aan je offlinebibliotheek toegevoegd.',
  willDownload_other:
    '{{count}} nummers worden eerst gedownload (ongeveer {{size}}). Er wordt niets aan je offlinebibliotheek toegevoegd.',

  metricElapsed: 'Verstreken tijd',
  metricRemaining: 'Resterende tijd',
  metricTotal: 'Totale tijd',
  metricRuntime: 'Discduur',
  metricSpeed: 'Schrijft op {{speed}}×',

  options: 'Brandopties',
  writeSpeed: 'Schrijfsnelheid',
  speedAuto: 'Automatisch',
  gapless: 'Zonder pauzes',
  gaplessHint: 'Geen pauze van 2 seconden tussen nummers. Disc-At-Once, zoals een geperste cd.',
  normalize: 'Niveaus gelijktrekken',
  normalizeHint:
    'Meet de luidheid en egaliseert elk nummer, zodat een verzamelalbum gelijkmatig klinkt.',
  ejectWhenDone: 'Uitwerpen als klaar',
  cdText: 'CD-TEXT schrijven',
  cdTextHint:
    'Slaat nummer- en artiestnamen op de disc op, voor spelers die ze kunnen tonen. Je station meldt dat het dit kan.',
  cdTextUnavailable: 'Dit station kan geen CD-TEXT schrijven.',
  cdTextNoAnswer:
    'Dit station heeft zijn schrijfmogelijkheden niet gemeld, dus CD-TEXT kan niet veilig worden aangeboden.',
  cdTextNoSao: 'CD-TEXT vereist Session-At-Once-opname, wat dit station niet ondersteunt.',
  cdTextNoSubchannel:
    'Dit station kan het R-W-subkanaal waarin CD-TEXT staat niet schrijven. De disc wordt toch gebrand, zonder nummernamen.',

  startBurn: 'Disc branden',
  startTestWrite: 'Testschrijven',
  cancel: 'Stoppen',
  cancelling: 'Stoppen…',
  clear: 'Leegmaken',

  alertReady_one: 'Klaar · {{count}} nummer · {{runtime}} · {{free}} vrij',
  alertReady_other: 'Klaar · {{count}} nummers · {{runtime}} · {{free}} vrij',
  alertNoDisc: 'Leg een lege cd-r in het station om deze volgorde te branden.',
  alertMore_one: '1 bericht meer tonen',
  alertMore_other: '{{count}} berichten meer tonen',

  pillRehearsal: 'Repetitie',
  pillWriting: 'Schrijven',

  seamLabel: 'Breedte van de afspeelvolgorde',
  seamValue: '{{px}} pixels',

  movedTo: '{{title}} verplaatst naar positie {{position}} van {{total}}',
  removedAnnounce: '{{title}} verwijderd',

  cancelSpoilsDisc:
    'De cd-r wordt nu gebrand. Stoppen maakt de disc onbruikbaar — een cd-r kan niet opnieuw worden beschreven.',

  mediaBlockerNoDisc: 'Geen disc in het station.',
  mediaBlockerNotCd: 'Dit is {{mediaType}}. Een audio-cd heeft een lege cd-r of cd-rw nodig.',
  mediaBlockerAlreadyWritten:
    'Deze disc is al beschreven en afgesloten en kan niet worden beschreven.',
  mediaBlockerNotBlankRewritable: 'Deze cd-rw bevat al gegevens. Wis hem voor het branden.',
  mediaBlockerNotBlankRecordable:
    'Deze cd-r is niet leeg. Audio-cd’s moeten in één keer worden geschreven.',
  mediaBlockerDriveRefused: 'Het station accepteert deze disc niet.',
  mediaBlockerDriveSilent: 'Het station gaf geen beschrijving van deze disc.',
  mediaBlockerUnknown: 'Deze disc kan niet worden beschreven.',

  blockerEmpty: 'Voeg minstens één nummer toe om een disc te branden.',
  blockerOverCapacity:
    'Capaciteit met {{over}} overschreden. Verwijder een nummer of gebruik een disc van 80 minuten.',
  blockerTooManyTracks: 'Een cd bevat hoogstens {{max}} nummers; deze wachtrij heeft er {{count}}.',

  past74:
    'Voorbij 74:00. Het past op deze disc, maar sommige oudere cd-spelers hebben daar moeite mee.',

  readoutPhase: 'Fase',
  readoutMode: 'Schrijfmodus',
  readoutPosition: 'Positie (MSF)',
  readoutSectors: 'Sectoren',
  readoutBuffer: 'Buffer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inactief',
  phaseRehearsing: 'Repeteren',
  phase: {
    fetching: 'Downloaden',
    analyzing: 'Analyseren',
    rendering: 'Omzetten',
    preparing: 'Voorbereiden',
    writing: 'Schrijven',
    closing: 'Afsluiten',
  },

  toastAdded_one: '{{count}} nummer aan de cd toegevoegd.',
  toastAdded_other: '{{count}} nummers aan de cd toegevoegd.',
  toastAddedSome_one:
    '{{count}} nummer toegevoegd; {{skipped}} overgeslagen omdat ze al in de wachtrij stonden of boven de limiet vielen.',
  toastAddedSome_other:
    '{{count}} nummers toegevoegd; {{skipped}} overgeslagen omdat ze al in de wachtrij stonden of boven de limiet vielen.',
  toastNewDiscStarted: 'Nieuwe disc gestart. De volgorde van de vorige brandsessie is gewist.',
  toastAlreadyQueued: 'Staat al op de cd.',
  toastDiscFull: 'De disc bevat al het maximum van {{max}} nummers.',
  toastBurnInProgress: 'Er wordt al gebrand. Stop dat voordat je de wachtrij wijzigt.',
  toastCancelled: 'Branden gestopt.',
  toastBurnDone_one: 'Disc gebrand — {{count}} nummer.',
  toastBurnDone_other: 'Disc gebrand — {{count}} nummers.',
  toastCdTextSkipped:
    'De disc is zonder CD-TEXT gebrand — dit station kon het hier niet schrijven, dus spelers tonen geen nummernamen.',
  toastTestWriteDone: 'Testschrijven voltooid. Er is niets naar de disc geschreven.',
  toastCdTextVerified_one: 'CD-TEXT op de disc geverifieerd ({{count}} pakket).',
  toastCdTextVerified_other: 'CD-TEXT op de disc geverifieerd ({{count}} pakketten).',
  toastCdTextUnconfirmed:
    'De disc is gebrand en de audio is in orde, maar bij het teruglezen is geen CD-TEXT gevonden. Stations onthouden de inhoud van een disc vaak vanaf het moment dat die werd ingelegd, dus dit kan een verouderde uitlezing zijn — probeer de disc in een speler die nummernamen toont.',
  toastCdTextUnreadable:
    'De disc is gebrand en de audio is in orde. Dit station wilde de CD-TEXT van de disc niet melden, dus hier valt niet te bevestigen of die geschreven is — probeer de disc in een speler die nummernamen toont.',

  trackListing: 'Nummeroverzicht',
  listingUntitled: 'Verzamel-cd',
  listingSummary_one: '{{count}} nummer · {{duration}}',
  listingSummary_other: '{{count}} nummers · {{duration}}',
  listingCopy: 'Kopiëren',
  listingCopied: 'Nummeroverzicht gekopieerd.',
  listingCopyFailed: 'Kon het nummeroverzicht niet kopiëren.',
  listingSave: '.txt opslaan',
  listingSaveTitle: 'Het nummeroverzicht opslaan',
  listingSaved: 'Nummeroverzicht opgeslagen.',
  listingPrint: 'Afdrukken',

  addToCd: 'Aan cd toevoegen',
};
