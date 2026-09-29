export const burner = {
  title: 'Nagrywarka CD',
  discTitleLabel: 'Tytuł płyty',
  discTitlePlaceholder: 'Nazwij tę płytę…',

  recorder: 'Nagrywarka',
  noRecorders: 'Nie znaleziono nagrywarki CD',
  refreshDrives: 'Odśwież napędy',
  eraseDisc: 'Wymaż płytę',
  reloadDisc: 'Wczytaj płytę ponownie',
  reloading: 'Wysuwanie płyty…',
  reloadDone: 'Płyta wysunięta. Włóż ją z powrotem, a potem naciśnij Odśwież.',
  reloadHint:
    'Napęd może wciąż opisywać tę płytę tak, jak wyglądała po zakończeniu ostatniej próby. Wysunięcie i ponowne wczytanie każe mu spojrzeć jeszcze raz.',
  erasing: 'Wymazywanie płyty…',
  eraseDone: 'Płyta wymazana.',
  mediaLabel: 'Nośnik',
  mediaBlankSuffix: ', pusty',
  noDisc: 'Brak płyty',
  capacityLabel: 'Pojemność',
  capacityValue: '{{minutes}} · {{sectors}} sektorów',
  platformUnsupported: 'Nagrywanie CD nie jest dostępne na tej platformie.',

  ringLabel: 'Pojemność płyty: {{count}} utworów, wykorzystano {{used}} z {{capacity}}',
  hubRemaining: 'POZOSTAŁO',
  hubOverCapacity: 'PRZEKROCZENIE O',
  hubTrackOf: 'Utwór {{number}} z {{total}}',
  hubTrackCount_one: '{{count}} utwór',
  hubTrackCount_few: '{{count}} utwory',
  hubTrackCount_many: '{{count}} utworów',
  hubTrackCount_other: '{{count}} utworu',
  hubPhaseNote: {
    fetching: 'Pobieranie z serwera',
    analyzing: 'Pomiar głośności',
    rendering: 'Konwersja na audio CD',
    preparing: 'Przygotowywanie płyty',
    writing: 'Zapis na płytę',
    closing: 'Finalizowanie płyty',
  },

  runningOrder: 'Kolejność odtwarzania',

  colNumber: '#',
  colTrack: 'Utwór',
  colArtist: 'Wykonawca',
  colTime: 'Czas',
  colStart: 'Początek',

  metricHeadroom: 'Zapas',
  metricOverBy: 'Przekroczenie o',
  metricToFetch: 'Do pobrania',
  metricWritten: 'Zapisano',
  metricTook: 'Czas',

  modeLabel: 'Tryb zapisu',
  modeBurn: 'Nagraj',
  modeRehearse: 'Próba',

  prepareStopFree: 'Nic jeszcze nie zostało zapisane — zatrzymanie teraz nic nie kosztuje.',
  abort: 'Przerwij nagrywanie',
  abortConfirm: 'Zniszcz płytę',
  burnAnother: 'Nagraj kolejną',

  outcomeWritten: 'Płyta nagrana — {{count}} utworów · {{duration}} · czas {{elapsed}}',
  outcomeRehearsed: 'Próba zakończona. Nic nie zostało zapisane na płycie.',
  outcomeFailed: 'Nagrywanie nie powiodło się.',
  outcomeCancelled: 'Nagrywanie zostało zatrzymane.',
  discSpoiled: 'Ta płyta CD-R została częściowo zapisana i nie nadaje się do ponownego użycia.',
  discBlank: 'Nic nie zostało zapisane; płyta jest nadal pusta.',
  failHintBuffer:
    'Napędowi zabrakło dźwięku do zapisania. Zamknięcie ciężkich operacji dyskowych i nagrywanie wolniej zwykle rozwiązuje problem.',
  failHintMedia: 'Sprawdź płytę: płyta audio wymaga pustego CD-R lub CD-RW.',
  failHintPermission: 'Napęd jest zajęty przez coś innego. Zamknij to i spróbuj ponownie.',

  speedTraceLabel: 'Zapis z prędkością {{now}}×, najniższa {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} utwór',
  trackCount_few: '{{count}} utwory',
  trackCount_many: '{{count}} utworów',
  trackCount_other: '{{count}} utworu',
  emptyTitle: 'Brak utworów w kolejce.',
  emptyHint: 'Kliknij prawym przyciskiem utwór, album lub playlistę i wybierz „Dodaj do CD”.',
  fetchNote:
    'Utwory, których nie ma w lokalnej pamięci podręcznej, są pobierane automatycznie po rozpoczęciu nagrywania.',
  removeTrack: 'Usuń {{title}}',
  rowWritten: 'Zapisano na płycie',
  trackWillDownloadHint:
    'Jeszcze nie w lokalnej pamięci podręcznej. Nagrywanie pobierze utwór z serwera przed zapisem.',
  willDownload_one:
    'Najpierw zostanie pobrany {{count}} utwór (około {{size}}). Nic nie zostanie dodane do biblioteki offline.',
  willDownload_few:
    'Najpierw zostaną pobrane {{count}} utwory (około {{size}}). Nic nie zostanie dodane do biblioteki offline.',
  willDownload_many:
    'Najpierw zostanie pobranych {{count}} utworów (około {{size}}). Nic nie zostanie dodane do biblioteki offline.',
  willDownload_other:
    'Najpierw zostanie pobranych {{count}} utworu (około {{size}}). Nic nie zostanie dodane do biblioteki offline.',

  metricElapsed: 'Czas, który minął',
  metricRemaining: 'Pozostały czas',
  metricTotal: 'Czas całkowity',
  metricRuntime: 'Długość płyty',
  metricSpeed: 'Zapis z prędkością {{speed}}×',

  options: 'Opcje nagrywania',
  writeSpeed: 'Prędkość zapisu',
  speedAuto: 'Automatyczna',
  gapless: 'Bez przerw',
  gaplessHint: 'Brak 2-sekundowej przerwy między utworami. Disc-At-Once, jak na tłoczonej płycie.',
  normalize: 'Wyrównaj poziomy',
  normalizeHint: 'Analizuje głośność i wyrównuje każdy utwór, żeby składanka grała równo.',
  ejectWhenDone: 'Wysuń po zakończeniu',
  cdText: 'Zapisz CD-TEXT',
  cdTextHint:
    'Zapisuje nazwy utworów i wykonawców na płycie, dla odtwarzaczy, które potrafią je pokazać. Twój napęd zgłasza, że to potrafi.',
  cdTextUnavailable: 'Ten napęd nie potrafi zapisać CD-TEXT.',
  cdTextNoAnswer:
    'Ten napęd nie zgłosił swoich możliwości zapisu, więc nie można bezpiecznie zaoferować CD-TEXT.',
  cdTextNoSao: 'CD-TEXT wymaga nagrywania Session-At-Once, którego ten napęd nie obsługuje.',
  cdTextNoSubchannel:
    'Ten napęd nie potrafi zapisać podkanału R-W, w którym mieszka CD-TEXT. Płyta i tak zostanie nagrana, bez nazw utworów.',

  startBurn: 'Nagraj płytę',
  startTestWrite: 'Zapis próbny',
  cancel: 'Zatrzymaj',
  cancelling: 'Zatrzymywanie…',
  clear: 'Wyczyść',

  alertReady_one: 'Gotowe · {{count}} utwór · {{runtime}} · {{free}} wolnego',
  alertReady_few: 'Gotowe · {{count}} utwory · {{runtime}} · {{free}} wolnego',
  alertReady_many: 'Gotowe · {{count}} utworów · {{runtime}} · {{free}} wolnego',
  alertReady_other: 'Gotowe · {{count}} utworu · {{runtime}} · {{free}} wolnego',
  alertNoDisc: 'Włóż pustą płytę CD-R do napędu, aby nagrać tę kolejność.',
  alertMore_one: 'Pokaż jeszcze 1 komunikat',
  alertMore_few: 'Pokaż jeszcze {{count}} komunikaty',
  alertMore_many: 'Pokaż jeszcze {{count}} komunikatów',
  alertMore_other: 'Pokaż jeszcze {{count}} komunikatu',

  pillRehearsal: 'Próba',
  pillWriting: 'Zapis',

  seamLabel: 'Szerokość kolejności odtwarzania',
  seamValue: '{{px}} pikseli',

  movedTo: '{{title}} przeniesiono na pozycję {{position}} z {{total}}',
  removedAnnounce: '{{title}} usunięto',

  cancelSpoilsDisc:
    'Płyta CD-R jest właśnie nagrywana. Zatrzymanie sprawi, że będzie bezużyteczna — płyty CD-R nie da się nagrać ponownie.',

  mediaBlockerNoDisc: 'Brak płyty w napędzie.',
  mediaBlockerNotCd: 'To jest {{mediaType}}. Płyta audio wymaga pustego CD-R lub CD-RW.',
  mediaBlockerAlreadyWritten:
    'Ta płyta jest już nagrana i zamknięta, więc nie można na niej nagrywać.',
  mediaBlockerNotBlankRewritable: 'Ten CD-RW zawiera już dane. Wymaż go przed nagrywaniem.',
  mediaBlockerNotBlankRecordable:
    'Ten CD-R nie jest pusty. Płytę audio trzeba nagrać za jednym razem.',
  mediaBlockerDriveRefused: 'Napęd nie akceptuje tej płyty.',
  mediaBlockerDriveSilent: 'Napęd nie opisał tej płyty.',
  mediaBlockerUnknown: 'Na tej płycie nie można nagrywać.',

  blockerEmpty: 'Dodaj co najmniej jeden utwór, aby nagrać płytę.',
  blockerOverCapacity:
    'Pojemność przekroczona o {{over}}. Usuń utwór lub użyj płyty 80-minutowej.',
  blockerTooManyTracks: 'Płyta CD mieści najwyżej {{max}} utworów; ta kolejka ma ich {{count}}.',

  past74:
    'Powyżej 74:00. Zmieści się na tej płycie, ale niektóre starsze odtwarzacze CD mają z tym problem.',

  readoutPhase: 'Faza',
  readoutMode: 'Tryb zapisu',
  readoutPosition: 'Pozycja (MSF)',
  readoutSectors: 'Sektory',
  readoutBuffer: 'Bufor',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Bezczynny',
  phaseRehearsing: 'Próba w toku',
  phase: {
    fetching: 'Pobieranie',
    analyzing: 'Analiza',
    rendering: 'Konwersja',
    preparing: 'Przygotowanie',
    writing: 'Zapis',
    closing: 'Zamykanie',
  },

  toastAdded_one: 'Dodano {{count}} utwór do CD.',
  toastAdded_few: 'Dodano {{count}} utwory do CD.',
  toastAdded_many: 'Dodano {{count}} utworów do CD.',
  toastAdded_other: 'Dodano {{count}} utworu do CD.',
  toastAddedSome_one:
    'Dodano {{count}} utwór; pominięto {{skipped}} już w kolejce lub ponad limit.',
  toastAddedSome_few:
    'Dodano {{count}} utwory; pominięto {{skipped}} już w kolejce lub ponad limit.',
  toastAddedSome_many:
    'Dodano {{count}} utworów; pominięto {{skipped}} już w kolejce lub ponad limit.',
  toastAddedSome_other:
    'Dodano {{count}} utworu; pominięto {{skipped}} już w kolejce lub ponad limit.',
  toastNewDiscStarted:
    'Rozpoczęto nową płytę. Kolejność utworów z poprzedniego nagrania została wyczyszczona.',
  toastAlreadyQueued: 'Już na płycie CD.',
  toastDiscFull: 'Płyta zawiera już maksymalnie {{max}} utworów.',
  toastBurnInProgress: 'Trwa nagrywanie. Zatrzymaj je przed zmianą kolejki.',
  toastCancelled: 'Nagrywanie zatrzymane.',
  toastBurnDone_one: 'Płyta nagrana — {{count}} utwór.',
  toastBurnDone_few: 'Płyta nagrana — {{count}} utwory.',
  toastBurnDone_many: 'Płyta nagrana — {{count}} utworów.',
  toastBurnDone_other: 'Płyta nagrana — {{count}} utworu.',
  toastCdTextSkipped:
    'Płyta została nagrana bez CD-TEXT — ten napęd nie zdołał go tutaj zapisać, więc odtwarzacze nie pokażą nazw utworów.',
  toastTestWriteDone: 'Zapis próbny zakończony. Nic nie zostało zapisane na płycie.',
  toastCdTextVerified_one: 'CD-TEXT zweryfikowany na płycie ({{count}} pakiet).',
  toastCdTextVerified_few: 'CD-TEXT zweryfikowany na płycie ({{count}} pakiety).',
  toastCdTextVerified_many: 'CD-TEXT zweryfikowany na płycie ({{count}} pakietów).',
  toastCdTextVerified_other: 'CD-TEXT zweryfikowany na płycie ({{count}} pakietu).',
  toastCdTextUnconfirmed:
    'Płyta została nagrana i dźwięk jest w porządku, ale przy ponownym odczycie nie znaleziono CD-TEXT. Napędy często pamiętają zawartość płyty z chwili jej włożenia, więc to może być nieaktualny odczyt — sprawdź płytę w odtwarzaczu, który pokazuje nazwy utworów.',
  toastCdTextUnreadable:
    'Płyta została nagrana i dźwięk jest w porządku. Ten napęd nie chciał zgłosić CD-TEXT płyty, więc nie da się tu potwierdzić, czy został zapisany — sprawdź płytę w odtwarzaczu, który pokazuje nazwy utworów.',

  trackListing: 'Lista utworów',
  listingUntitled: 'Składanka CD',
  listingSummary_one: '{{count}} utwór · {{duration}}',
  listingSummary_few: '{{count}} utwory · {{duration}}',
  listingSummary_many: '{{count}} utworów · {{duration}}',
  listingSummary_other: '{{count}} utworu · {{duration}}',
  listingCopy: 'Kopiuj',
  listingCopied: 'Lista utworów skopiowana.',
  listingCopyFailed: 'Nie udało się skopiować listy utworów.',
  listingSave: 'Zapisz .txt',
  listingSaveTitle: 'Zapisz listę utworów',
  listingSaved: 'Lista utworów zapisana.',
  listingPrint: 'Drukuj',

  addToCd: 'Dodaj do CD',
};
