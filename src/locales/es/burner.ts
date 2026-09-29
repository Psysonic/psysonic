export const burner = {
  title: 'Grabador de CD',
  discTitleLabel: 'Título del disco',
  discTitlePlaceholder: 'Nombra este disco…',

  recorder: 'Grabadora',
  noRecorders: 'No se encontró ninguna grabadora de CD',
  refreshDrives: 'Actualizar unidades',
  eraseDisc: 'Borrar disco',
  reloadDisc: 'Recargar disco',
  reloading: 'Expulsando el disco…',
  reloadDone: 'Disco expulsado. Vuelve a introducirlo y pulsa Actualizar.',
  reloadHint:
    'Puede que la unidad siga describiendo este disco tal como estaba al terminar el último ensayo. Expulsarlo y volver a cargarlo hace que lo mire otra vez.',
  erasing: 'Borrando el disco…',
  eraseDone: 'Disco borrado.',
  mediaLabel: 'Soporte',
  mediaBlankSuffix: ', virgen',
  noDisc: 'Sin disco',
  capacityLabel: 'Capacidad',
  capacityValue: '{{minutes}} · {{sectors}} sectores',
  platformUnsupported: 'La grabación de CD no está disponible en esta plataforma.',

  ringLabel: 'Capacidad del disco: {{count}} pistas, {{used}} de {{capacity}} usados',
  hubRemaining: 'RESTANTE',
  hubOverCapacity: 'EXCEDIDO EN',
  hubTrackOf: 'Pista {{number}} de {{total}}',
  hubTrackCount_one: '{{count}} pista',
  hubTrackCount_other: '{{count}} pistas',
  hubPhaseNote: {
    fetching: 'Descargando de tu servidor',
    analyzing: 'Midiendo la sonoridad',
    rendering: 'Convirtiendo a audio CD',
    preparing: 'Preparando el disco',
    writing: 'Escribiendo en el disco',
    closing: 'Finalizando el disco',
  },

  runningOrder: 'Orden de reproducción',

  colNumber: '#',
  colTrack: 'Pista',
  colArtist: 'Artista',
  colTime: 'Duración',
  colStart: 'Inicio',

  metricHeadroom: 'Margen',
  metricOverBy: 'Excedido en',
  metricToFetch: 'Por descargar',
  metricWritten: 'Escrito',
  metricTook: 'Duró',

  modeLabel: 'Modo de escritura',
  modeBurn: 'Grabar',
  modeRehearse: 'Ensayo',

  prepareStopFree: 'Aún no se ha escrito nada: detenerlo ahora no cuesta nada.',
  abort: 'Cancelar la grabación',
  abortConfirm: 'Estropear el disco',
  burnAnother: 'Grabar otro',

  outcomeWritten: 'Disco grabado — {{count}} pistas · {{duration}} · duró {{elapsed}}',
  outcomeRehearsed: 'Ensayo terminado. No se escribió nada en el disco.',
  outcomeFailed: 'La grabación falló.',
  outcomeCancelled: 'La grabación se detuvo.',
  discSpoiled: 'Este CD-R se ha escrito parcialmente y no se puede reutilizar.',
  discBlank: 'No se escribió nada; el disco sigue virgen.',
  failHintBuffer:
    'La unidad se quedó sin audio que escribir. Cerrar trabajos pesados de disco y grabar más despacio suele resolverlo.',
  failHintMedia: 'Comprueba el disco: un CD de audio necesita un CD-R o CD-RW virgen.',
  failHintPermission: 'Otra cosa está ocupando la unidad. Ciérrala e inténtalo de nuevo.',

  speedTraceLabel: 'Escribiendo a {{now}}×, mínimo {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} pista',
  trackCount_other: '{{count}} pistas',
  emptyTitle: 'Todavía no hay pistas en cola.',
  emptyHint: 'Haz clic derecho en una pista, un álbum o una lista y elige «Añadir al CD».',
  fetchNote:
    'Las pistas que no están en la caché local se descargan automáticamente al empezar la grabación.',
  removeTrack: 'Quitar {{title}}',
  rowWritten: 'Escrita en el disco',
  trackWillDownloadHint:
    'Todavía no está en la caché local. La grabación la descarga de tu servidor antes de escribir.',
  willDownload_one:
    'Se descargará {{count}} pista primero (unos {{size}}). No se añade nada a tu biblioteca sin conexión.',
  willDownload_other:
    'Se descargarán {{count}} pistas primero (unos {{size}}). No se añade nada a tu biblioteca sin conexión.',

  metricElapsed: 'Tiempo transcurrido',
  metricRemaining: 'Tiempo restante',
  metricTotal: 'Tiempo total',
  metricRuntime: 'Duración del disco',
  metricSpeed: 'Escribiendo a {{speed}}×',

  options: 'Opciones de grabación',
  writeSpeed: 'Velocidad de escritura',
  speedAuto: 'Automática',
  gapless: 'Sin pausas',
  gaplessHint: 'Sin pausa de 2 segundos entre pistas. Disc-At-Once, como un CD prensado.',
  normalize: 'Igualar niveles',
  normalizeHint:
    'Analiza la sonoridad y nivela cada pista, para que una recopilación suene pareja.',
  ejectWhenDone: 'Expulsar al terminar',
  cdText: 'Escribir CD-TEXT',
  cdTextHint:
    'Guarda los nombres de pista y artista en el disco, para reproductores que puedan mostrarlos. Tu unidad indica que puede hacerlo.',
  cdTextUnavailable: 'Esta unidad no puede escribir CD-TEXT.',
  cdTextNoAnswer:
    'Esta unidad no informó de sus capacidades de escritura, así que no se puede ofrecer CD-TEXT con seguridad.',
  cdTextNoSao: 'CD-TEXT necesita grabación Session-At-Once, que esta unidad no admite.',
  cdTextNoSubchannel:
    'Esta unidad no puede escribir el subcanal R-W donde vive el CD-TEXT. El disco se grabará igualmente, sin nombres de pista.',

  startBurn: 'Grabar disco',
  startTestWrite: 'Escritura de prueba',
  cancel: 'Detener',
  cancelling: 'Deteniendo…',
  clear: 'Vaciar',

  alertReady_one: 'Listo · {{count}} pista · {{runtime}} · {{free}} libres',
  alertReady_other: 'Listo · {{count}} pistas · {{runtime}} · {{free}} libres',
  alertNoDisc: 'Pon un CD-R virgen en la unidad para grabar este orden.',
  alertMore_one: 'Mostrar 1 mensaje más',
  alertMore_other: 'Mostrar {{count}} mensajes más',

  pillRehearsal: 'Ensayo',
  pillWriting: 'Escribiendo',

  seamLabel: 'Ancho del orden de reproducción',
  seamValue: '{{px}} píxeles',

  movedTo: '{{title}} movida a la posición {{position}} de {{total}}',
  removedAnnounce: '{{title}} eliminada',

  cancelSpoilsDisc:
    'El CD-R se está grabando ahora. Detenerlo deja el disco inservible: un CD-R no se puede reescribir.',

  mediaBlockerNoDisc: 'No hay disco en la unidad.',
  mediaBlockerNotCd: 'Esto es {{mediaType}}. Un CD de audio necesita un CD-R o CD-RW virgen.',
  mediaBlockerAlreadyWritten: 'Este disco ya está grabado y cerrado, así que no se puede grabar.',
  mediaBlockerNotBlankRewritable: 'Este CD-RW ya contiene datos. Bórralo antes de grabar.',
  mediaBlockerNotBlankRecordable:
    'Este CD-R no está virgen. Los CD de audio deben grabarse de una sola vez.',
  mediaBlockerDriveRefused: 'La unidad no acepta este disco.',
  mediaBlockerDriveSilent: 'La unidad no describió este disco.',
  mediaBlockerUnknown: 'En este disco no se puede grabar.',

  blockerEmpty: 'Añade al menos una pista para grabar un disco.',
  blockerOverCapacity:
    'Se excede la capacidad en {{over}}. Quita una pista o usa un disco de 80 minutos.',
  blockerTooManyTracks: 'Un CD admite como máximo {{max}} pistas; esta cola tiene {{count}}.',

  past74:
    'Pasa de 74:00. Cabe en este disco, pero algunos reproductores antiguos tienen problemas más allá de ahí.',

  readoutPhase: 'Fase',
  readoutMode: 'Modo de escritura',
  readoutPosition: 'Posición (MSF)',
  readoutSectors: 'Sectores',
  readoutBuffer: 'Búfer',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inactivo',
  phaseRehearsing: 'Ensayando',
  phase: {
    fetching: 'Descargando',
    analyzing: 'Analizando',
    rendering: 'Convirtiendo',
    preparing: 'Preparando',
    writing: 'Escribiendo',
    closing: 'Cerrando',
  },

  toastAdded_one: 'Se añadió {{count}} pista al CD.',
  toastAdded_other: 'Se añadieron {{count}} pistas al CD.',
  toastAddedSome_one:
    'Se añadió {{count}} pista; se omitieron {{skipped}} ya en cola o por encima del límite.',
  toastAddedSome_other:
    'Se añadieron {{count}} pistas; se omitieron {{skipped}} ya en cola o por encima del límite.',
  toastNewDiscStarted:
    'Nuevo disco iniciado. Se borró el orden de pistas de la grabación anterior.',
  toastAlreadyQueued: 'Ya está en el CD.',
  toastDiscFull: 'El disco ya contiene el máximo de {{max}} pistas.',
  toastBurnInProgress: 'Hay una grabación en curso. Detenla antes de cambiar la cola.',
  toastCancelled: 'Grabación detenida.',
  toastBurnDone_one: 'Disco grabado — {{count}} pista.',
  toastBurnDone_other: 'Disco grabado — {{count}} pistas.',
  toastCdTextSkipped:
    'El disco se grabó sin CD-TEXT: esta unidad no pudo escribirlo aquí, así que los reproductores no mostrarán los nombres de pista.',
  toastTestWriteDone: 'Escritura de prueba terminada. No se escribió nada en el disco.',
  toastCdTextVerified_one: 'CD-TEXT verificado en el disco ({{count}} paquete).',
  toastCdTextVerified_other: 'CD-TEXT verificado en el disco ({{count}} paquetes).',
  toastCdTextUnconfirmed:
    'El disco se grabó y el audio está bien, pero no se encontró CD-TEXT al releerlo. Las unidades suelen guardar el contenido del disco desde que se introdujo, así que puede ser una lectura desactualizada: prueba el disco en un reproductor que muestre los nombres de pista.',
  toastCdTextUnreadable:
    'El disco se grabó y el audio está bien. Esta unidad no quiso informar del CD-TEXT del disco, así que aquí no se puede confirmar si se escribió: prueba el disco en un reproductor que muestre los nombres de pista.',

  trackListing: 'Lista de pistas',
  listingUntitled: 'CD recopilatorio',
  listingSummary_one: '{{count}} pista · {{duration}}',
  listingSummary_other: '{{count}} pistas · {{duration}}',
  listingCopy: 'Copiar',
  listingCopied: 'Lista de pistas copiada.',
  listingCopyFailed: 'No se pudo copiar la lista de pistas.',
  listingSave: 'Guardar .txt',
  listingSaveTitle: 'Guardar la lista de pistas',
  listingSaved: 'Lista de pistas guardada.',
  listingPrint: 'Imprimir',

  addToCd: 'Añadir al CD',
};
