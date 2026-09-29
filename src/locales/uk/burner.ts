export const burner = {
  title: 'Запис CD',
  discTitleLabel: 'Назва диска',
  discTitlePlaceholder: 'Назвіть цей диск…',

  recorder: 'Привід',
  noRecorders: 'Записувальний привід CD не знайдено',
  refreshDrives: 'Оновити приводи',
  eraseDisc: 'Стерти диск',
  reloadDisc: 'Перечитати диск',
  reloading: 'Виймання диска…',
  reloadDone: 'Диск вийнято. Вставте його назад і натисніть «Оновити».',
  reloadHint:
    'Привід, можливо, досі описує цей диск таким, яким він був наприкінці останньої репетиції. Виймання та повторне завантаження змусять його подивитися ще раз.',
  erasing: 'Стирання диска…',
  eraseDone: 'Диск стерто.',
  mediaLabel: 'Носій',
  mediaBlankSuffix: ', чистий',
  noDisc: 'Немає диска',
  capacityLabel: 'Місткість',
  capacityValue: '{{minutes}} · {{sectors}} секторів',
  platformUnsupported: 'Запис CD недоступний на цій платформі.',

  ringLabel: 'Місткість диска: {{count}} треків, зайнято {{used}} із {{capacity}}',
  hubRemaining: 'ЗАЛИШИЛОСЯ',
  hubOverCapacity: 'ПЕРЕВИЩЕННЯ НА',
  hubTrackOf: 'Трек {{number}} із {{total}}',
  hubTrackCount_one: '{{count}} трек',
  hubTrackCount_few: '{{count}} треки',
  hubTrackCount_many: '{{count}} треків',
  hubTrackCount_other: '{{count}} трека',
  hubPhaseNote: {
    fetching: 'Завантаження з сервера',
    analyzing: 'Вимірювання гучності',
    rendering: 'Перетворення на аудіо CD',
    preparing: 'Підготовка диска',
    writing: 'Запис на диск',
    closing: 'Фіналізація диска',
  },

  runningOrder: 'Порядок запису',

  colNumber: '#',
  colTrack: 'Трек',
  colArtist: 'Виконавець',
  colTime: 'Час',
  colStart: 'Початок',

  metricHeadroom: 'Запас',
  metricOverBy: 'Перевищення на',
  metricToFetch: 'До завантаження',
  metricWritten: 'Записано',
  metricTook: 'Тривало',

  modeLabel: 'Режим запису',
  modeBurn: 'Записати',
  modeRehearse: 'Репетиція',

  prepareStopFree: 'Поки нічого не записано — зупинка зараз нічого не коштує.',
  abort: 'Перервати запис',
  abortConfirm: 'Зіпсувати диск',
  burnAnother: 'Записати ще',

  outcomeWritten: 'Диск записано — {{count}} треків · {{duration}} · тривало {{elapsed}}',
  outcomeRehearsed: 'Репетицію завершено. На диск нічого не записано.',
  outcomeFailed: 'Запис не вдався.',
  outcomeCancelled: 'Запис зупинено.',
  discSpoiled: 'Цей CD-R записано частково, і його не можна використати повторно.',
  discBlank: 'Нічого не записано; диск і далі чистий.',
  failHintBuffer:
    'Приводу забракло аудіо для запису. Зазвичай допомагає закрити важкі дискові задачі й писати повільніше.',
  failHintMedia: 'Перевірте диск: для аудіо-CD потрібен чистий CD-R або CD-RW.',
  failHintPermission: 'Привід зайнятий чимось іншим. Закрийте це й спробуйте ще раз.',

  speedTraceLabel: 'Запис на {{now}}×, мінімум {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} трек',
  trackCount_few: '{{count}} треки',
  trackCount_many: '{{count}} треків',
  trackCount_other: '{{count}} трека',
  emptyTitle: 'У черзі поки немає треків.',
  emptyHint:
    'Клацніть правою кнопкою на треку, альбомі чи плейлисті та виберіть «Додати на CD».',
  fetchNote:
    'Треки, яких немає в локальному кеші, завантажуються автоматично на початку запису.',
  removeTrack: 'Прибрати {{title}}',
  rowWritten: 'Записано на диск',
  trackWillDownloadHint:
    'Ще немає в локальному кеші. Перед записом трек буде завантажено з вашого сервера.',
  willDownload_one:
    'Спершу буде завантажено {{count}} трек (близько {{size}}). До офлайн-бібліотеки нічого не додається.',
  willDownload_few:
    'Спершу буде завантажено {{count}} треки (близько {{size}}). До офлайн-бібліотеки нічого не додається.',
  willDownload_many:
    'Спершу буде завантажено {{count}} треків (близько {{size}}). До офлайн-бібліотеки нічого не додається.',
  willDownload_other:
    'Спершу буде завантажено {{count}} трека (близько {{size}}). До офлайн-бібліотеки нічого не додається.',

  metricElapsed: 'Минуло часу',
  metricRemaining: 'Залишилося часу',
  metricTotal: 'Загальний час',
  metricRuntime: 'Тривалість диска',
  metricSpeed: 'Запис на {{speed}}×',

  options: 'Параметри запису',
  writeSpeed: 'Швидкість запису',
  speedAuto: 'Автоматично',
  gapless: 'Без пауз',
  gaplessHint: 'Без двосекундної паузи між треками. Disc-At-Once, як на штампованому CD.',
  normalize: 'Вирівняти гучність',
  normalizeHint: 'Вимірює гучність і вирівнює кожен трек, щоб збірка звучала рівно.',
  ejectWhenDone: 'Вийняти після завершення',
  cdText: 'Записати CD-TEXT',
  cdTextHint:
    'Зберігає назви треків і виконавців на диску — для програвачів, які вміють їх показувати. Ваш привід повідомляє, що вміє це.',
  cdTextUnavailable: 'Цей привід не вміє записувати CD-TEXT.',
  cdTextNoAnswer:
    'Цей привід не повідомив про свої можливості запису, тому CD-TEXT не можна запропонувати безпечно.',
  cdTextNoSao: 'CD-TEXT потребує запису Session-At-Once, якого цей привід не підтримує.',
  cdTextNoSubchannel:
    'Цей привід не вміє записувати підканал R-W, у якому живе CD-TEXT. Диск усе одно буде записано, але без назв треків.',

  startBurn: 'Записати диск',
  startTestWrite: 'Пробний запис',
  cancel: 'Зупинити',
  cancelling: 'Зупинення…',
  clear: 'Очистити',

  alertReady_one: 'Готово · {{count}} трек · {{runtime}} · {{free}} вільно',
  alertReady_few: 'Готово · {{count}} треки · {{runtime}} · {{free}} вільно',
  alertReady_many: 'Готово · {{count}} треків · {{runtime}} · {{free}} вільно',
  alertReady_other: 'Готово · {{count}} трека · {{runtime}} · {{free}} вільно',
  alertNoDisc: 'Вставте чистий CD-R у привід, щоб записати цей порядок.',
  alertMore_one: 'Показати ще 1 повідомлення',
  alertMore_few: 'Показати ще {{count}} повідомлення',
  alertMore_many: 'Показати ще {{count}} повідомлень',
  alertMore_other: 'Показати ще {{count}} повідомлення',

  pillRehearsal: 'Репетиція',
  pillWriting: 'Запис',

  seamLabel: 'Ширина порядку запису',
  seamValue: '{{px}} пікселів',

  movedTo: '{{title}} переміщено на позицію {{position}} з {{total}}',
  removedAnnounce: '{{title}} вилучено',

  cancelSpoilsDisc:
    'CD-R записується просто зараз. Зупинка зробить диск непридатним — CD-R не можна перезаписати.',

  mediaBlockerNoDisc: 'У приводі немає диска.',
  mediaBlockerNotCd: 'Це {{mediaType}}. Для аудіо-CD потрібен чистий CD-R або CD-RW.',
  mediaBlockerAlreadyWritten: 'Цей диск уже записаний і закритий, тому записати на нього не можна.',
  mediaBlockerNotBlankRewritable: 'На цьому CD-RW уже є дані. Зітріть його перед записом.',
  mediaBlockerNotBlankRecordable: 'Цей CD-R не чистий. Аудіо-CD потрібно записувати за один раз.',
  mediaBlockerDriveRefused: 'Привід не приймає цей диск.',
  mediaBlockerDriveSilent: 'Привід не надав відомостей про цей диск.',
  mediaBlockerUnknown: 'На цей диск неможливо записати.',

  blockerEmpty: 'Додайте щонайменше один трек, щоб записати диск.',
  blockerOverCapacity:
    'Місткість перевищено на {{over}}. Приберіть трек або візьміть 80-хвилинний диск.',
  blockerTooManyTracks: 'На CD вміщується не більше {{max}} треків; у цій черзі їх {{count}}.',

  past74:
    'Понад 74:00. На цей диск вміщується, але деякі старіші CD-програвачі за цією межею справляються погано.',

  readoutPhase: 'Фаза',
  readoutMode: 'Режим запису',
  readoutPosition: 'Позиція (MSF)',
  readoutSectors: 'Сектори',
  readoutBuffer: 'Буфер',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Очікування',
  phaseRehearsing: 'Триває репетиція',
  phase: {
    fetching: 'Завантаження',
    analyzing: 'Аналіз',
    rendering: 'Перетворення',
    preparing: 'Підготовка',
    writing: 'Запис',
    closing: 'Закриття',
  },

  toastAdded_one: 'На CD додано {{count}} трек.',
  toastAdded_few: 'На CD додано {{count}} треки.',
  toastAdded_many: 'На CD додано {{count}} треків.',
  toastAdded_other: 'На CD додано {{count}} трека.',
  toastAddedSome_one:
    'Додано {{count}} трек; пропущено {{skipped}} — уже в черзі або понад ліміт.',
  toastAddedSome_few:
    'Додано {{count}} треки; пропущено {{skipped}} — уже в черзі або понад ліміт.',
  toastAddedSome_many:
    'Додано {{count}} треків; пропущено {{skipped}} — уже в черзі або понад ліміт.',
  toastAddedSome_other:
    'Додано {{count}} трека; пропущено {{skipped}} — уже в черзі або понад ліміт.',
  toastNewDiscStarted: 'Розпочато новий диск. Порядок треків із попереднього запису очищено.',
  toastAlreadyQueued: 'Уже на CD.',
  toastDiscFull: 'На диску вже максимум — {{max}} треків.',
  toastBurnInProgress: 'Триває запис. Зупиніть його, перш ніж змінювати чергу.',
  toastCancelled: 'Запис зупинено.',
  toastBurnDone_one: 'Диск записано — {{count}} трек.',
  toastBurnDone_few: 'Диск записано — {{count}} треки.',
  toastBurnDone_many: 'Диск записано — {{count}} треків.',
  toastBurnDone_other: 'Диск записано — {{count}} трека.',
  toastCdTextSkipped:
    'Диск записано без CD-TEXT — цей привід не зміг записати його тут, тому програвачі не покажуть назв треків.',
  toastTestWriteDone: 'Пробний запис завершено. На диск нічого не записано.',
  toastCdTextVerified_one: 'CD-TEXT перевірено на диску ({{count}} пакет).',
  toastCdTextVerified_few: 'CD-TEXT перевірено на диску ({{count}} пакети).',
  toastCdTextVerified_many: 'CD-TEXT перевірено на диску ({{count}} пакетів).',
  toastCdTextVerified_other: 'CD-TEXT перевірено на диску ({{count}} пакета).',
  toastCdTextUnconfirmed:
    'Диск записано, і звук у порядку, але під час зворотного читання CD-TEXT не знайдено. Приводи часто запам’ятовують вміст диска з моменту, коли його вставили, тож читання може бути застарілим — спробуйте диск у програвачі, який показує назви треків.',
  toastCdTextUnreadable:
    'Диск записано, і звук у порядку. Цей привід відмовився повідомити CD-TEXT диска, тому тут не можна підтвердити, чи його було записано — спробуйте диск у програвачі, який показує назви треків.',

  trackListing: 'Список треків',
  listingUntitled: 'Збірка CD',
  listingSummary_one: '{{count}} трек · {{duration}}',
  listingSummary_few: '{{count}} треки · {{duration}}',
  listingSummary_many: '{{count}} треків · {{duration}}',
  listingSummary_other: '{{count}} трека · {{duration}}',
  listingCopy: 'Копіювати',
  listingCopied: 'Список треків скопійовано.',
  listingCopyFailed: 'Не вдалося скопіювати список треків.',
  listingSave: 'Зберегти .txt',
  listingSaveTitle: 'Зберегти список треків',
  listingSaved: 'Список треків збережено.',
  listingPrint: 'Друк',

  addToCd: 'Додати на CD',
};
