export const burner = {
  title: 'Graveur de CD',
  discTitleLabel: 'Titre du disque',
  discTitlePlaceholder: 'Nommez ce disque…',

  recorder: 'Graveur',
  noRecorders: 'Aucun graveur de CD trouvé',
  refreshDrives: 'Actualiser les lecteurs',
  eraseDisc: 'Effacer le disque',
  reloadDisc: 'Recharger le disque',
  reloading: 'Éjection du disque…',
  reloadDone: 'Disque éjecté. Réinsérez-le, puis appuyez sur Actualiser.',
  reloadHint:
    'Le lecteur décrit peut-être encore ce disque tel qu’il était à la fin du dernier essai. L’éjecter et le recharger le force à regarder de nouveau.',
  erasing: 'Effacement du disque…',
  eraseDone: 'Disque effacé.',
  mediaLabel: 'Support',
  mediaBlankSuffix: ', vierge',
  noDisc: 'Aucun disque',
  capacityLabel: 'Capacité',
  capacityValue: '{{minutes}} · {{sectors}} secteurs',
  platformUnsupported: 'La gravure de CD n’est pas disponible sur cette plateforme.',

  ringLabel: 'Capacité du disque : {{count}} titres, {{used}} utilisés sur {{capacity}}',
  hubRemaining: 'RESTANT',
  hubOverCapacity: 'DÉPASSEMENT DE',
  hubTrackOf: 'Titre {{number}} sur {{total}}',
  hubTrackCount_one: '{{count}} titre',
  hubTrackCount_other: '{{count}} titres',
  hubPhaseNote: {
    fetching: 'Téléchargement depuis votre serveur',
    analyzing: 'Mesure du volume sonore',
    rendering: 'Conversion en audio CD',
    preparing: 'Préparation du disque',
    writing: 'Écriture sur le disque',
    closing: 'Finalisation du disque',
  },

  runningOrder: 'Ordre de lecture',

  colNumber: '#',
  colTrack: 'Titre',
  colArtist: 'Artiste',
  colTime: 'Durée',
  colStart: 'Début',

  metricHeadroom: 'Marge',
  metricOverBy: 'Dépassement de',
  metricToFetch: 'À télécharger',
  metricWritten: 'Écrits',
  metricTook: 'Durée',

  modeLabel: 'Mode d’écriture',
  modeBurn: 'Graver',
  modeRehearse: 'Essai',

  prepareStopFree: 'Rien n’a encore été écrit — arrêter maintenant ne coûte rien.',
  abort: 'Annuler la gravure',
  abortConfirm: 'Gâcher le disque',
  burnAnother: 'Graver un autre',

  outcomeWritten: 'Disque gravé — {{count}} titres · {{duration}} · durée {{elapsed}}',
  outcomeRehearsed: 'Essai terminé. Rien n’a été écrit sur le disque.',
  outcomeFailed: 'La gravure a échoué.',
  outcomeCancelled: 'La gravure a été arrêtée.',
  discSpoiled: 'Ce CD-R a été partiellement écrit et ne peut plus être réutilisé.',
  discBlank: 'Rien n’a été écrit ; le disque est toujours vierge.',
  failHintBuffer:
    'Le lecteur n’a plus eu d’audio à écrire. Fermer les traitements disque lourds et graver plus lentement règle généralement le problème.',
  failHintMedia: 'Vérifiez le disque : un CD audio nécessite un CD-R ou un CD-RW vierge.',
  failHintPermission: 'Quelque chose d’autre occupe le lecteur. Fermez-le et réessayez.',

  speedTraceLabel: 'Écriture à {{now}}×, minimum {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} titre',
  trackCount_other: '{{count}} titres',
  emptyTitle: 'Aucun titre en file d’attente pour l’instant.',
  emptyHint:
    'Faites un clic droit sur un titre, un album ou une playlist et choisissez « Ajouter au CD ».',
  fetchNote:
    'Les titres qui ne sont pas en cache local sont téléchargés automatiquement au démarrage de la gravure.',
  removeTrack: 'Retirer {{title}}',
  rowWritten: 'Écrit sur le disque',
  trackWillDownloadHint:
    'Pas encore en cache local. La gravure le télécharge depuis votre serveur avant d’écrire.',
  willDownload_one:
    '{{count}} titre sera téléchargé d’abord (environ {{size}}). Rien n’est ajouté à votre bibliothèque hors ligne.',
  willDownload_other:
    '{{count}} titres seront téléchargés d’abord (environ {{size}}). Rien n’est ajouté à votre bibliothèque hors ligne.',

  metricElapsed: 'Temps écoulé',
  metricRemaining: 'Temps restant',
  metricTotal: 'Temps total',
  metricRuntime: 'Durée du disque',
  metricSpeed: 'Écriture à {{speed}}×',

  options: 'Options de gravure',
  writeSpeed: 'Vitesse d’écriture',
  speedAuto: 'Automatique',
  gapless: 'Sans blanc',
  gaplessHint: 'Aucun blanc de 2 secondes entre les titres. Disc-At-Once, comme un CD pressé.',
  normalize: 'Égaliser les niveaux',
  normalizeHint:
    'Analyse le volume sonore et nivelle chaque titre, pour qu’une compilation s’écoute uniformément.',
  ejectWhenDone: 'Éjecter une fois terminé',
  cdText: 'Écrire le CD-TEXT',
  cdTextHint:
    'Enregistre les noms de titre et d’artiste sur le disque, pour les lecteurs capables de les afficher. Votre graveur indique qu’il en est capable.',
  cdTextUnavailable: 'Ce graveur ne peut pas écrire le CD-TEXT.',
  cdTextNoAnswer:
    'Ce graveur n’a pas indiqué ses capacités d’écriture, le CD-TEXT ne peut donc pas être proposé sans risque.',
  cdTextNoSao:
    'Le CD-TEXT nécessite la gravure Session-At-Once, que ce graveur ne prend pas en charge.',
  cdTextNoSubchannel:
    'Ce graveur ne peut pas écrire le sous-canal R-W où réside le CD-TEXT. Le disque sera gravé quand même, sans les noms de titres.',

  startBurn: 'Graver le disque',
  startTestWrite: 'Écriture de test',
  cancel: 'Arrêter',
  cancelling: 'Arrêt…',
  clear: 'Vider',

  alertReady_one: 'Prêt · {{count}} titre · {{runtime}} · {{free}} libres',
  alertReady_other: 'Prêt · {{count}} titres · {{runtime}} · {{free}} libres',
  alertNoDisc: 'Insérez un CD-R vierge dans le lecteur pour graver cet ordre de lecture.',
  alertMore_one: 'Afficher 1 message de plus',
  alertMore_other: 'Afficher {{count}} messages de plus',

  pillRehearsal: 'Essai',
  pillWriting: 'Écriture',

  seamLabel: 'Largeur de l’ordre de lecture',
  seamValue: '{{px}} pixels',

  movedTo: '{{title}} déplacé en position {{position}} sur {{total}}',
  removedAnnounce: '{{title}} retiré',

  cancelSpoilsDisc:
    'Le CD-R est en cours de gravure. L’arrêter rend le disque inutilisable — un CD-R ne peut pas être réécrit.',

  mediaBlockerNoDisc: 'Aucun disque dans le lecteur.',
  mediaBlockerNotCd: 'Ceci est {{mediaType}}. Un CD audio nécessite un CD-R ou un CD-RW vierge.',
  mediaBlockerAlreadyWritten:
    'Ce disque a déjà été gravé et finalisé : il ne peut plus être gravé.',
  mediaBlockerNotBlankRewritable: 'Ce CD-RW contient déjà des données. Effacez-le avant de graver.',
  mediaBlockerNotBlankRecordable:
    'Ce CD-R n’est pas vierge. Un CD audio doit être gravé en une seule fois.',
  mediaBlockerDriveRefused: 'Le lecteur refuse ce disque.',
  mediaBlockerDriveSilent: 'Le lecteur n’a pas décrit ce disque.',
  mediaBlockerUnknown: 'Ce disque ne peut pas être gravé.',

  blockerEmpty: 'Ajoutez au moins un titre pour graver un disque.',
  blockerOverCapacity:
    'Capacité dépassée de {{over}}. Retirez un titre ou utilisez un disque de 80 minutes.',
  blockerTooManyTracks: 'Un CD contient au plus {{max}} titres ; cette file en compte {{count}}.',

  past74:
    'Au-delà de 74:00. Cela tient sur ce disque, mais certains lecteurs CD anciens ont du mal au-delà.',

  readoutPhase: 'Phase',
  readoutMode: 'Mode d’écriture',
  readoutPosition: 'Position (MSF)',
  readoutSectors: 'Secteurs',
  readoutBuffer: 'Tampon',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: 'Inactif',
  phaseRehearsing: 'Essai en cours',
  phase: {
    fetching: 'Téléchargement',
    analyzing: 'Analyse',
    rendering: 'Conversion',
    preparing: 'Préparation',
    writing: 'Écriture',
    closing: 'Fermeture',
  },

  toastAdded_one: '{{count}} titre ajouté au CD.',
  toastAdded_other: '{{count}} titres ajoutés au CD.',
  toastAddedSome_one:
    '{{count}} titre ajouté ; {{skipped}} ignorés car déjà en file ou au-delà de la limite.',
  toastAddedSome_other:
    '{{count}} titres ajoutés ; {{skipped}} ignorés car déjà en file ou au-delà de la limite.',
  toastNewDiscStarted:
    'Nouveau disque commencé. L’ordre des titres de la gravure précédente a été effacé.',
  toastAlreadyQueued: 'Déjà sur le CD.',
  toastDiscFull: 'Le disque contient déjà le maximum de {{max}} titres.',
  toastBurnInProgress: 'Une gravure est en cours. Arrêtez-la avant de modifier la file.',
  toastCancelled: 'Gravure arrêtée.',
  toastBurnDone_one: 'Disque gravé — {{count}} titre.',
  toastBurnDone_other: 'Disque gravé — {{count}} titres.',
  toastCdTextSkipped:
    'Le disque a été gravé sans CD-TEXT — ce graveur n’a pas pu l’écrire ici, les lecteurs n’afficheront donc pas les noms de titres.',
  toastTestWriteDone: 'Écriture de test terminée. Rien n’a été écrit sur le disque.',
  toastCdTextVerified_one: 'CD-TEXT vérifié sur le disque ({{count}} paquet).',
  toastCdTextVerified_other: 'CD-TEXT vérifié sur le disque ({{count}} paquets).',
  toastCdTextUnconfirmed:
    'Le disque a été gravé et l’audio est correct, mais aucun CD-TEXT n’a été trouvé à la relecture. Les lecteurs gardent souvent en mémoire le contenu du disque tel qu’il était à l’insertion : la lecture peut donc être périmée. Essayez le disque dans un lecteur qui affiche les noms de titres.',
  toastCdTextUnreadable:
    'Le disque a été gravé et l’audio est correct. Ce graveur n’a pas voulu indiquer le CD-TEXT du disque, impossible donc de confirmer ici s’il a été écrit. Essayez le disque dans un lecteur qui affiche les noms de titres.',

  trackListing: 'Liste des titres',
  listingUntitled: 'CD compilation',
  listingSummary_one: '{{count}} titre · {{duration}}',
  listingSummary_other: '{{count}} titres · {{duration}}',
  listingCopy: 'Copier',
  listingCopied: 'Liste des titres copiée.',
  listingCopyFailed: 'Impossible de copier la liste des titres.',
  listingSave: 'Enregistrer .txt',
  listingSaveTitle: 'Enregistrer la liste des titres',
  listingSaved: 'Liste des titres enregistrée.',
  listingPrint: 'Imprimer',

  addToCd: 'Ajouter au CD',
};
