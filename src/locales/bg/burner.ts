export const burner = {
  title: 'Записване на CD',
  discTitleLabel: 'Заглавие на диска',
  discTitlePlaceholder: 'Дайте име на този диск…',

  recorder: 'Записващо устройство',
  noRecorders: 'Не е намерено записващо CD устройство',
  refreshDrives: 'Обнови устройствата',
  eraseDisc: 'Изтрий диска',
  reloadDisc: 'Презареди диска',
  reloading: 'Изваждане на диска…',
  reloadDone: 'Дискът е изваден. Поставете го обратно и натиснете „Обнови“.',
  reloadHint:
    'Устройството може още да описва този диск така, както е бил в края на последната репетиция. Изваждането и презареждането го карат да погледне отново.',
  erasing: 'Изтриване на диска…',
  eraseDone: 'Дискът е изтрит.',
  mediaLabel: 'Носител',
  mediaBlankSuffix: ', празен',
  noDisc: 'Няма диск',
  capacityLabel: 'Капацитет',
  capacityValue: '{{minutes}} · {{sectors}} сектора',
  platformUnsupported: 'Записването на CD не е достъпно на тази платформа.',

  ringLabel: 'Капацитет на диска: {{count}} песни, заети {{used}} от {{capacity}}',
  hubRemaining: 'ОСТАВАТ',
  hubOverCapacity: 'НАД С',
  hubTrackOf: 'Песен {{number}} от {{total}}',
  hubTrackCount_one: '{{count}} песен',
  hubTrackCount_other: '{{count}} песни',
  hubPhaseNote: {
    fetching: 'Изтегляне от вашия сървър',
    analyzing: 'Измерване на силата на звука',
    rendering: 'Преобразуване в CD аудио',
    preparing: 'Подготовка на диска',
    writing: 'Записване върху диска',
    closing: 'Финализиране на диска',
  },

  runningOrder: 'Ред на записване',

  colNumber: '#',
  colTrack: 'Песен',
  colArtist: 'Изпълнител',
  colTime: 'Време',
  colStart: 'Начало',

  metricHeadroom: 'Запас',
  metricOverBy: 'Над с',
  metricToFetch: 'За изтегляне',
  metricWritten: 'Записани',
  metricTook: 'Отне',

  modeLabel: 'Режим на записване',
  modeBurn: 'Запиши',
  modeRehearse: 'Репетиция',

  prepareStopFree: 'Още нищо не е записано — спирането сега не струва нищо.',
  abort: 'Прекрати записа',
  abortConfirm: 'Развали диска',
  burnAnother: 'Запиши още един',

  outcomeWritten: 'Дискът е записан — {{count}} песни · {{duration}} · отне {{elapsed}}',
  outcomeRehearsed: 'Репетицията приключи. Върху диска не е записано нищо.',
  outcomeFailed: 'Записването се провали.',
  outcomeCancelled: 'Записването беше спряно.',
  discSpoiled: 'Този CD-R е записан частично и не може да се използва отново.',
  discBlank: 'Нищо не е записано; дискът е все още празен.',
  failHintBuffer:
    'На устройството му свърши аудиото за записване. Обикновено помага да затворите тежките дискови задачи и да записвате по-бавно.',
  failHintMedia: 'Проверете диска: за аудио CD е нужен празен CD-R или CD-RW.',
  failHintPermission: 'Нещо друго държи устройството. Затворете го и опитайте отново.',

  speedTraceLabel: 'Записване на {{now}}×, най-ниско {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} песен',
  trackCount_other: '{{count}} песни',
  emptyTitle: 'Все още няма песни в опашката.',
  emptyHint:
    'Щракнете с десния бутон върху песен, албум или списък и изберете „Добави към CD“.',
  fetchNote:
    'Песните, които не са в локалния кеш, се изтеглят автоматично при започване на записа.',
  removeTrack: 'Премахни {{title}}',
  rowWritten: 'Записана върху диска',
  trackWillDownloadHint:
    'Още не е в локалния кеш. Записът я изтегля от вашия сървър преди записването.',
  willDownload_one:
    'Първо ще бъде изтеглена {{count}} песен (около {{size}}). Нищо не се добавя към офлайн библиотеката ви.',
  willDownload_other:
    'Първо ще бъдат изтеглени {{count}} песни (около {{size}}). Нищо не се добавя към офлайн библиотеката ви.',

  metricElapsed: 'Изминало време',
  metricRemaining: 'Оставащо време',
  metricTotal: 'Общо време',
  metricRuntime: 'Времетраене на диска',
  metricSpeed: 'Записване на {{speed}}×',

  options: 'Настройки за записване',
  writeSpeed: 'Скорост на записване',
  speedAuto: 'Автоматична',
  gapless: 'Без паузи',
  gaplessHint: 'Без 2-секундна пауза между песните. Disc-At-Once, както при пресован CD.',
  normalize: 'Изравни нивата',
  normalizeHint:
    'Анализира силата на звука и изравнява всяка песен, за да звучи компилацията равномерно.',
  ejectWhenDone: 'Извади след приключване',
  cdText: 'Запиши CD-TEXT',
  cdTextHint:
    'Запазва имената на песните и изпълнителите върху диска, за плеъри, които могат да ги показват. Вашето устройство съобщава, че може.',
  cdTextUnavailable: 'Това устройство не може да записва CD-TEXT.',
  cdTextNoAnswer:
    'Това устройство не съобщи възможностите си за записване, затова CD-TEXT не може да бъде предложен безопасно.',
  cdTextNoSao: 'CD-TEXT изисква записване Session-At-Once, което това устройство не поддържа.',
  cdTextNoSubchannel:
    'Това устройство не може да записва подканала R-W, в който живее CD-TEXT. Дискът пак ще бъде записан, но без имена на песните.',

  startBurn: 'Запиши диска',
  startTestWrite: 'Пробен запис',
  cancel: 'Спри',
  cancelling: 'Спиране…',
  clear: 'Изчисти',

  alertReady_one: 'Готово · {{count}} песен · {{runtime}} · {{free}} свободни',
  alertReady_other: 'Готово · {{count}} песни · {{runtime}} · {{free}} свободни',
  alertNoDisc: 'Поставете празен CD-R в устройството, за да запишете този ред.',
  alertMore_one: 'Покажи още 1 съобщение',
  alertMore_other: 'Покажи още {{count}} съобщения',

  pillRehearsal: 'Репетиция',
  pillWriting: 'Записване',

  seamLabel: 'Ширина на реда на записване',
  seamValue: '{{px}} пиксела',

  movedTo: '{{title}} преместена на позиция {{position}} от {{total}}',
  removedAnnounce: '{{title}} премахната',

  cancelSpoilsDisc:
    'CD-R се записва в момента. Спирането прави диска негоден — CD-R не може да се презаписва.',

  mediaBlockerNoDisc: 'Няма диск в устройството.',
  mediaBlockerNotCd: 'Това е {{mediaType}}. За аудио CD е нужен празен CD-R или CD-RW.',
  mediaBlockerAlreadyWritten:
    'Този диск вече е записан и затворен, затова не може да бъде записван.',
  mediaBlockerNotBlankRewritable: 'Този CD-RW вече съдържа данни. Изтрийте го преди запис.',
  mediaBlockerNotBlankRecordable: 'Този CD-R не е празен. Аудио CD трябва да се запише наведнъж.',
  mediaBlockerDriveRefused: 'Устройството не приема този диск.',
  mediaBlockerDriveSilent: 'Устройството не описа този диск.',
  mediaBlockerUnknown: 'На този диск не може да се записва.',

  blockerEmpty: 'Добавете поне една песен, за да запишете диск.',
  blockerOverCapacity:
    'Капацитетът е надвишен с {{over}}. Премахнете песен или използвайте 80-минутен диск.',
  blockerTooManyTracks: 'Един CD побира най-много {{max}} песни; тази опашка има {{count}}.',

  past74:
    'Над 74:00. Побира се на този диск, но някои по-стари CD плеъри се затрудняват след това.',

  readoutPhase: 'Фаза',
  readoutMode: 'Режим на записване',
  readoutPosition: 'Позиция (MSF)',
  readoutSectors: 'Сектори',
  readoutBuffer: 'Буфер',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Бездействие',
  phaseRehearsing: 'Тече репетиция',
  phase: {
    fetching: 'Изтегляне',
    analyzing: 'Анализ',
    rendering: 'Преобразуване',
    preparing: 'Подготовка',
    writing: 'Записване',
    closing: 'Затваряне',
  },

  toastAdded_one: 'Добавена е {{count}} песен към CD.',
  toastAdded_other: 'Добавени са {{count}} песни към CD.',
  toastAddedSome_one:
    'Добавена е {{count}} песен; пропуснати са {{skipped}}, вече в опашката или над лимита.',
  toastAddedSome_other:
    'Добавени са {{count}} песни; пропуснати са {{skipped}}, вече в опашката или над лимита.',
  toastNewDiscStarted: 'Започнахте нов диск. Списъкът от предишния запис беше изчистен.',
  toastAlreadyQueued: 'Вече е на CD.',
  toastDiscFull: 'Дискът вече съдържа максимума от {{max}} песни.',
  toastBurnInProgress: 'Тече записване. Спрете го, преди да променяте опашката.',
  toastCancelled: 'Записването е спряно.',
  toastBurnDone_one: 'Дискът е записан — {{count}} песен.',
  toastBurnDone_other: 'Дискът е записан — {{count}} песни.',
  toastCdTextSkipped:
    'Дискът беше записан без CD-TEXT — това устройство не успя да го запише тук, затова плеърите няма да показват имената на песните.',
  toastTestWriteDone: 'Пробният запис приключи. Върху диска не е записано нищо.',
  toastCdTextVerified_one: 'CD-TEXT е потвърден върху диска ({{count}} пакет).',
  toastCdTextVerified_other: 'CD-TEXT е потвърден върху диска ({{count}} пакета).',
  toastCdTextUnconfirmed:
    'Дискът беше записан и звукът е наред, но при обратното четене не беше открит CD-TEXT. Устройствата често запомнят съдържанието на диска от момента на поставянето му, така че това може да е остаряло четене — пробвайте диска в плеър, който показва имената на песните.',
  toastCdTextUnreadable:
    'Дискът беше записан и звукът е наред. Това устройство отказа да съобщи CD-TEXT на диска, затова тук не може да се потвърди дали е бил записан — пробвайте диска в плеър, който показва имената на песните.',

  trackListing: 'Списък с песни',
  listingUntitled: 'Компилация CD',
  listingSummary_one: '{{count}} песен · {{duration}}',
  listingSummary_other: '{{count}} песни · {{duration}}',
  listingCopy: 'Копирай',
  listingCopied: 'Списъкът с песни е копиран.',
  listingCopyFailed: 'Списъкът с песни не можа да бъде копиран.',
  listingSave: 'Запази .txt',
  listingSaveTitle: 'Запази списъка с песни',
  listingSaved: 'Списъкът с песни е запазен.',
  listingPrint: 'Отпечатай',

  addToCd: 'Добави към CD',
};
