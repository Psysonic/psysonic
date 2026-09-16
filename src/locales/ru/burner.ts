export const burner = {
  title: 'Запись CD',
  discTitleLabel: 'Название диска',
  discTitlePlaceholder: 'Назовите этот диск…',

  recorder: 'Привод',
  noRecorders: 'Пишущий привод CD не найден',
  refreshDrives: 'Обновить приводы',
  eraseDisc: 'Стереть диск',
  reloadDisc: 'Перечитать диск',
  reloading: 'Извлечение диска…',
  reloadDone: 'Диск извлечён. Вставьте его обратно и нажмите «Обновить».',
  reloadHint:
    'Привод, возможно, до сих пор описывает диск таким, каким он был в конце последней репетиции. Извлечение и повторная загрузка заставят его посмотреть заново.',
  erasing: 'Стирание диска…',
  eraseDone: 'Диск стёрт.',
  mediaLabel: 'Носитель',
  mediaBlankSuffix: ', чистый',
  noDisc: 'Нет диска',
  capacityLabel: 'Ёмкость',
  capacityValue: '{{minutes}} · {{sectors}} секторов',
  platformUnsupported: 'Запись CD недоступна на этой платформе.',

  ringLabel: 'Ёмкость диска: {{count}} треков, занято {{used}} из {{capacity}}',
  hubRemaining: 'ОСТАЛОСЬ',
  hubOverCapacity: 'ПРЕВЫШЕНИЕ НА',
  hubTrackOf: 'Трек {{number}} из {{total}}',
  hubTrackCount_one: '{{count}} трек',
  hubTrackCount_few: '{{count}} трека',
  hubTrackCount_many: '{{count}} треков',
  hubTrackCount_other: '{{count}} трека',
  hubPhaseNote: {
    fetching: 'Загрузка с сервера',
    analyzing: 'Измерение громкости',
    rendering: 'Преобразование в аудио CD',
    preparing: 'Подготовка диска',
    writing: 'Запись на диск',
    closing: 'Финализация диска',
  },

  runningOrder: 'Порядок записи',

  colNumber: '#',
  colTrack: 'Трек',
  colArtist: 'Исполнитель',
  colTime: 'Время',
  colStart: 'Начало',

  metricHeadroom: 'Запас',
  metricOverBy: 'Превышение на',
  metricToFetch: 'К загрузке',
  metricWritten: 'Записано',
  metricTook: 'Заняло',

  modeLabel: 'Режим записи',
  modeBurn: 'Записать',
  modeRehearse: 'Репетиция',

  prepareStopFree: 'Пока ничего не записано — остановка сейчас ничего не стоит.',
  abort: 'Прервать запись',
  abortConfirm: 'Испортить диск',
  burnAnother: 'Записать ещё',

  outcomeWritten: 'Диск записан — {{count}} треков · {{duration}} · заняло {{elapsed}}',
  outcomeRehearsed: 'Репетиция завершена. На диск ничего не записано.',
  outcomeFailed: 'Запись не удалась.',
  outcomeCancelled: 'Запись остановлена.',
  discSpoiled: 'Этот CD-R записан частично и не может быть использован повторно.',
  discBlank: 'Ничего не записано; диск по-прежнему чистый.',
  failHintBuffer:
    'Приводу перестало хватать аудио для записи. Обычно помогает закрыть тяжёлые дисковые задачи и писать медленнее.',
  failHintMedia: 'Проверьте диск: для аудио-CD нужен чистый CD-R или CD-RW.',
  failHintPermission: 'Привод занят чем-то другим. Закройте это и попробуйте снова.',

  speedTraceLabel: 'Запись на {{now}}×, минимум {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} трек',
  trackCount_few: '{{count}} трека',
  trackCount_many: '{{count}} треков',
  trackCount_other: '{{count}} трека',
  emptyTitle: 'В очереди пока нет треков.',
  emptyHint:
    'Щёлкните правой кнопкой по треку, альбому или плейлисту и выберите «Добавить на CD».',
  fetchNote:
    'Треки, которых нет в локальном кэше, загружаются автоматически при старте записи.',
  removeTrack: 'Убрать {{title}}',
  rowWritten: 'Записан на диск',
  trackWillDownloadHint:
    'Ещё нет в локальном кэше. Перед записью трек будет загружен с вашего сервера.',
  willDownload_one:
    'Сначала будет загружен {{count}} трек (около {{size}}). В офлайн-библиотеку ничего не добавляется.',
  willDownload_few:
    'Сначала будут загружены {{count}} трека (около {{size}}). В офлайн-библиотеку ничего не добавляется.',
  willDownload_many:
    'Сначала будет загружено {{count}} треков (около {{size}}). В офлайн-библиотеку ничего не добавляется.',
  willDownload_other:
    'Сначала будет загружено {{count}} трека (около {{size}}). В офлайн-библиотеку ничего не добавляется.',

  metricElapsed: 'Прошло времени',
  metricRemaining: 'Осталось времени',
  metricTotal: 'Общее время',
  metricRuntime: 'Длительность диска',
  metricSpeed: 'Запись на {{speed}}×',

  options: 'Параметры записи',
  writeSpeed: 'Скорость записи',
  speedAuto: 'Автоматически',
  gapless: 'Без пауз',
  gaplessHint: 'Без двухсекундной паузы между треками. Disc-At-Once, как на штампованном CD.',
  normalize: 'Выровнять громкость',
  normalizeHint: 'Измеряет громкость и выравнивает каждый трек, чтобы сборник звучал ровно.',
  ejectWhenDone: 'Извлечь по завершении',
  cdText: 'Записать CD-TEXT',
  cdTextHint:
    'Сохраняет названия треков и исполнителей на диске — для проигрывателей, которые умеют их показывать. Ваш привод сообщает, что умеет это.',
  cdTextUnavailable: 'Этот привод не умеет записывать CD-TEXT.',
  cdTextNoAnswer:
    'Этот привод не сообщил о своих возможностях записи, поэтому CD-TEXT нельзя предложить безопасно.',
  cdTextNoSao: 'CD-TEXT требует записи Session-At-Once, которую этот привод не поддерживает.',
  cdTextNoSubchannel:
    'Этот привод не умеет записывать подканал R-W, в котором живёт CD-TEXT. Диск всё равно будет записан, но без названий треков.',

  startBurn: 'Записать диск',
  startTestWrite: 'Пробная запись',
  cancel: 'Остановить',
  cancelling: 'Остановка…',
  clear: 'Очистить',

  alertReady_one: 'Готово · {{count}} трек · {{runtime}} · {{free}} свободно',
  alertReady_few: 'Готово · {{count}} трека · {{runtime}} · {{free}} свободно',
  alertReady_many: 'Готово · {{count}} треков · {{runtime}} · {{free}} свободно',
  alertReady_other: 'Готово · {{count}} трека · {{runtime}} · {{free}} свободно',
  alertNoDisc: 'Вставьте чистый CD-R в привод, чтобы записать этот порядок.',
  alertMore_one: 'Показать ещё 1 сообщение',
  alertMore_few: 'Показать ещё {{count}} сообщения',
  alertMore_many: 'Показать ещё {{count}} сообщений',
  alertMore_other: 'Показать ещё {{count}} сообщения',

  pillRehearsal: 'Репетиция',
  pillWriting: 'Запись',

  seamLabel: 'Ширина порядка записи',
  seamValue: '{{px}} пикселей',

  movedTo: '{{title}} перемещён на позицию {{position}} из {{total}}',
  removedAnnounce: '{{title}} удалён',

  cancelSpoilsDisc:
    'CD-R записывается прямо сейчас. Остановка сделает диск непригодным — CD-R нельзя перезаписать.',

  mediaBlockerNoDisc: 'В приводе нет диска.',
  mediaBlockerNotCd: 'Это {{mediaType}}. Для аудио-CD нужен чистый CD-R или CD-RW.',
  mediaBlockerAlreadyWritten: 'Этот диск уже записан и закрыт, поэтому записать на него нельзя.',
  mediaBlockerNotBlankRewritable: 'На этом CD-RW уже есть данные. Сотрите его перед записью.',
  mediaBlockerNotBlankRecordable: 'Этот CD-R не чистый. Аудио-CD нужно записывать за один раз.',
  mediaBlockerDriveRefused: 'Привод не принимает этот диск.',
  mediaBlockerDriveSilent: 'Привод не сообщил сведения об этом диске.',
  mediaBlockerUnknown: 'На этот диск нельзя записать.',

  blockerEmpty: 'Добавьте хотя бы один трек, чтобы записать диск.',
  blockerOverCapacity:
    'Ёмкость превышена на {{over}}. Уберите трек или возьмите 80-минутный диск.',
  blockerTooManyTracks: 'На CD помещается не более {{max}} треков; в этой очереди их {{count}}.',

  past74:
    'Больше 74:00. На этот диск помещается, но некоторые старые CD-проигрыватели за этой границей справляются плохо.',

  readoutPhase: 'Фаза',
  readoutMode: 'Режим записи',
  readoutPosition: 'Позиция (MSF)',
  readoutSectors: 'Секторы',
  readoutBuffer: 'Буфер',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Простой',
  phaseRehearsing: 'Идёт репетиция',
  phase: {
    fetching: 'Загрузка',
    analyzing: 'Анализ',
    rendering: 'Преобразование',
    preparing: 'Подготовка',
    writing: 'Запись',
    closing: 'Закрытие',
  },

  toastAdded_one: 'На CD добавлен {{count}} трек.',
  toastAdded_few: 'На CD добавлено {{count}} трека.',
  toastAdded_many: 'На CD добавлено {{count}} треков.',
  toastAdded_other: 'На CD добавлено {{count}} трека.',
  toastAddedSome_one:
    'Добавлен {{count}} трек; пропущено {{skipped}} — уже в очереди или сверх лимита.',
  toastAddedSome_few:
    'Добавлено {{count}} трека; пропущено {{skipped}} — уже в очереди или сверх лимита.',
  toastAddedSome_many:
    'Добавлено {{count}} треков; пропущено {{skipped}} — уже в очереди или сверх лимита.',
  toastAddedSome_other:
    'Добавлено {{count}} трека; пропущено {{skipped}} — уже в очереди или сверх лимита.',
  toastNewDiscStarted: 'Начат новый диск. Порядок треков с прошлой записи очищен.',
  toastAlreadyQueued: 'Уже на CD.',
  toastDiscFull: 'На диске уже максимум — {{max}} треков.',
  toastBurnInProgress: 'Идёт запись. Остановите её, прежде чем менять очередь.',
  toastCancelled: 'Запись остановлена.',
  toastBurnDone_one: 'Диск записан — {{count}} трек.',
  toastBurnDone_few: 'Диск записан — {{count}} трека.',
  toastBurnDone_many: 'Диск записан — {{count}} треков.',
  toastBurnDone_other: 'Диск записан — {{count}} трека.',
  toastCdTextSkipped:
    'Диск записан без CD-TEXT — этот привод не смог записать его здесь, поэтому проигрыватели не покажут названия треков.',
  toastTestWriteDone: 'Пробная запись завершена. На диск ничего не записано.',
  toastCdTextVerified_one: 'CD-TEXT проверен на диске ({{count}} пакет).',
  toastCdTextVerified_few: 'CD-TEXT проверен на диске ({{count}} пакета).',
  toastCdTextVerified_many: 'CD-TEXT проверен на диске ({{count}} пакетов).',
  toastCdTextVerified_other: 'CD-TEXT проверен на диске ({{count}} пакета).',
  toastCdTextUnconfirmed:
    'Диск записан, и звук в порядке, но при обратном чтении CD-TEXT не найден. Приводы часто запоминают содержимое диска с момента, когда его вставили, так что чтение может быть устаревшим — попробуйте диск в проигрывателе, который показывает названия треков.',
  toastCdTextUnreadable:
    'Диск записан, и звук в порядке. Этот привод отказался сообщить CD-TEXT диска, поэтому здесь нельзя подтвердить, был ли он записан — попробуйте диск в проигрывателе, который показывает названия треков.',

  trackListing: 'Список треков',
  listingUntitled: 'Сборник CD',
  listingSummary_one: '{{count}} трек · {{duration}}',
  listingSummary_few: '{{count}} трека · {{duration}}',
  listingSummary_many: '{{count}} треков · {{duration}}',
  listingSummary_other: '{{count}} трека · {{duration}}',
  listingCopy: 'Копировать',
  listingCopied: 'Список треков скопирован.',
  listingCopyFailed: 'Не удалось скопировать список треков.',
  listingSave: 'Сохранить .txt',
  listingSaveTitle: 'Сохранить список треков',
  listingSaved: 'Список треков сохранён.',
  listingPrint: 'Печать',

  addToCd: 'Добавить на CD',
};
