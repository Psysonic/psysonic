export const burner = {
  title: 'CD 書き込み',
  discTitleLabel: 'ディスクのタイトル',
  discTitlePlaceholder: 'このディスクに名前を付ける…',

  recorder: 'ドライブ',
  noRecorders: 'CD ライターが見つかりません',
  refreshDrives: 'ドライブを更新',
  eraseDisc: 'ディスクを消去',
  reloadDisc: 'ディスクを読み込み直す',
  reloading: 'ディスクを取り出しています…',
  reloadDone: 'ディスクを取り出しました。入れ直してから「更新」を押してください。',
  reloadHint:
    'ドライブは前回のリハーサル終了時の状態のままディスクを認識している可能性があります。取り出して入れ直すと、もう一度読み取ります。',
  erasing: 'ディスクを消去しています…',
  eraseDone: 'ディスクを消去しました。',
  mediaLabel: 'メディア',
  mediaBlankSuffix: '、空',
  noDisc: 'ディスクなし',
  capacityLabel: '容量',
  capacityValue: '{{minutes}} · {{sectors}} セクター',
  platformUnsupported: 'このプラットフォームでは CD への書き込みを利用できません。',

  ringLabel: 'ディスク容量: {{count}} 曲、{{capacity}} 中 {{used}} 使用',
  hubRemaining: '残り',
  hubOverCapacity: '超過',
  hubTrackOf: '{{total}} 曲中 {{number}} 曲目',
  hubTrackCount_one: '{{count}} 曲',
  hubTrackCount_other: '{{count}} 曲',
  hubPhaseNote: {
    fetching: 'サーバーからダウンロード中',
    analyzing: 'ラウドネスを測定中',
    rendering: 'CD オーディオに変換中',
    preparing: 'ディスクを準備中',
    writing: 'ディスクに書き込み中',
    closing: 'ディスクを完了処理中',
  },

  runningOrder: '曲順',

  colNumber: '#',
  colTrack: '曲',
  colArtist: 'アーティスト',
  colTime: '時間',
  colStart: '開始',

  metricHeadroom: '余裕',
  metricOverBy: '超過',
  metricToFetch: 'ダウンロード予定',
  metricWritten: '書き込み済み',
  metricTook: '所要時間',

  modeLabel: '書き込みモード',
  modeBurn: '書き込み',
  modeRehearse: 'リハーサル',

  prepareStopFree: 'まだ何も書き込まれていません — 今停止しても失うものはありません。',
  abort: '書き込みを中止',
  abortConfirm: 'ディスクを無駄にする',
  burnAnother: 'もう一枚書き込む',

  outcomeWritten: 'ディスクを書き込みました — {{count}} 曲 · {{duration}} · 所要時間 {{elapsed}}',
  outcomeRehearsed: 'リハーサルが完了しました。ディスクには何も書き込まれていません。',
  outcomeFailed: '書き込みに失敗しました。',
  outcomeCancelled: '書き込みを停止しました。',
  discSpoiled: 'この CD-R は途中まで書き込まれており、再利用できません。',
  discBlank: '何も書き込まれていません。ディスクは空のままです。',
  failHintBuffer:
    'ドライブに送る音声が足りなくなりました。重いディスク処理を終了し、低速で書き込むとたいてい解決します。',
  failHintMedia: 'ディスクを確認してください。オーディオ CD には空の CD-R または CD-RW が必要です。',
  failHintPermission: '他の何かがドライブを使用しています。終了してからもう一度お試しください。',

  speedTraceLabel: '{{now}}× で書き込み中、最低 {{low}}×',
  totalRuntime: '{{duration}}',
  trackCount_one: '{{count}} 曲',
  trackCount_other: '{{count}} 曲',
  emptyTitle: 'まだキューに曲がありません。',
  emptyHint: '曲・アルバム・プレイリストを右クリックして「CD に追加」を選びます。',
  fetchNote:
    'ローカルにキャッシュされていない曲は、書き込み開始時に自動でダウンロードされます。',
  removeTrack: '{{title}} を削除',
  rowWritten: 'ディスクに書き込み済み',
  trackWillDownloadHint:
    'まだローカルにキャッシュされていません。書き込み前にサーバーからダウンロードします。',
  willDownload_one:
    '先に {{count}} 曲をダウンロードします（約 {{size}}）。オフラインライブラリには何も追加されません。',
  willDownload_other:
    '先に {{count}} 曲をダウンロードします（約 {{size}}）。オフラインライブラリには何も追加されません。',

  metricElapsed: '経過時間',
  metricRemaining: '残り時間',
  metricTotal: '合計時間',
  metricRuntime: 'ディスクの長さ',
  metricSpeed: '{{speed}}× で書き込み中',

  options: '書き込みオプション',
  writeSpeed: '書き込み速度',
  speedAuto: '自動',
  gapless: 'ギャップレス',
  gaplessHint: '曲間の 2 秒のギャップなし。プレス CD と同じ Disc-At-Once です。',
  normalize: '音量をそろえる',
  normalizeHint:
    'ラウドネスを解析して各曲の音量をそろえ、コンピレーションが均一に鳴るようにします。',
  ejectWhenDone: '完了したら取り出す',
  cdText: 'CD-TEXT を書き込む',
  cdTextHint:
    '曲名とアーティスト名をディスクに保存します。表示できるプレーヤー向けです。お使いのドライブは対応していると報告しています。',
  cdTextUnavailable: 'このドライブは CD-TEXT を書き込めません。',
  cdTextNoAnswer:
    'このドライブは書き込み能力を報告しなかったため、CD-TEXT を安全に提供できません。',
  cdTextNoSao: 'CD-TEXT には Session-At-Once 記録が必要ですが、このドライブは対応していません。',
  cdTextNoSubchannel:
    'このドライブは CD-TEXT が格納される R-W サブチャンネルを書き込めません。ディスクは曲名なしで書き込まれます。',

  startBurn: 'ディスクを書き込む',
  startTestWrite: 'テスト書き込み',
  cancel: '停止',
  cancelling: '停止しています…',
  clear: 'クリア',

  alertReady_one: '準備完了 · {{count}} 曲 · {{runtime}} · 空き {{free}}',
  alertReady_other: '準備完了 · {{count}} 曲 · {{runtime}} · 空き {{free}}',
  alertNoDisc: 'この曲順を書き込むには、空の CD-R をドライブに入れてください。',
  alertMore_one: 'メッセージをあと 1 件表示',
  alertMore_other: 'メッセージをあと {{count}} 件表示',

  pillRehearsal: 'リハーサル',
  pillWriting: '書き込み中',

  seamLabel: '曲順リストの幅',
  seamValue: '{{px}} ピクセル',

  movedTo: '{{title}} を {{total}} 件中 {{position}} 番目に移動しました',
  removedAnnounce: '{{title}} を削除しました',

  cancelSpoilsDisc:
    'CD-R を書き込み中です。停止するとディスクは使えなくなります — CD-R は書き直せません。',

  mediaBlockerNoDisc: 'ドライブにディスクがありません。',
  mediaBlockerNotCd: 'これは {{mediaType}} です。オーディオ CD には空の CD-R または CD-RW が必要です。',
  mediaBlockerAlreadyWritten: 'このディスクは書き込み済みでクローズされているため、書き込めません。',
  mediaBlockerNotBlankRewritable: 'この CD-RW にはすでにデータがあります。書き込む前に消去してください。',
  mediaBlockerNotBlankRecordable: 'この CD-R は空ではありません。オーディオ CD は一度に書き込む必要があります。',
  mediaBlockerDriveRefused: 'ドライブがこのディスクを受け付けません。',
  mediaBlockerDriveSilent: 'ドライブがこのディスクの情報を返しませんでした。',
  mediaBlockerUnknown: 'このディスクには書き込めません。',

  blockerEmpty: 'ディスクを書き込むには、少なくとも 1 曲追加してください。',
  blockerOverCapacity: '容量を {{over}} 超えています。曲を減らすか、80 分ディスクを使ってください。',
  blockerTooManyTracks: 'CD には最大 {{max}} 曲までです。このキューには {{count}} 曲あります。',

  past74:
    '74:00 を超えています。このディスクには収まりますが、一部の古い CD プレーヤーはそれ以降で不安定になります。',

  readoutPhase: 'フェーズ',
  readoutMode: '書き込みモード',
  readoutPosition: '位置 (MSF)',
  readoutSectors: 'セクター',
  readoutBuffer: 'バッファ',
  modeDao: 'DAO / 2352',
  modeTest: 'DAO / TEST',
  phaseIdle: '待機中',
  phaseRehearsing: 'リハーサル中',
  phase: {
    fetching: 'ダウンロード',
    analyzing: '解析',
    rendering: '変換',
    preparing: '準備',
    writing: '書き込み',
    closing: '終了処理',
  },

  toastAdded_one: '{{count}} 曲を CD に追加しました。',
  toastAdded_other: '{{count}} 曲を CD に追加しました。',
  toastAddedSome_one:
    '{{count}} 曲を追加しました。{{skipped}} 曲は既にキューにあるか上限を超えたためスキップしました。',
  toastAddedSome_other:
    '{{count}} 曲を追加しました。{{skipped}} 曲は既にキューにあるか上限を超えたためスキップしました。',
  toastNewDiscStarted: '新しいディスクを開始しました。前回の書き込みの曲順は消去されました。',
  toastAlreadyQueued: 'すでに CD にあります。',
  toastDiscFull: 'ディスクはすでに上限の {{max}} 曲に達しています。',
  toastBurnInProgress: '書き込み中です。キューを変更する前に停止してください。',
  toastCancelled: '書き込みを停止しました。',
  toastBurnDone_one: 'ディスクを書き込みました — {{count}} 曲。',
  toastBurnDone_other: 'ディスクを書き込みました — {{count}} 曲。',
  toastCdTextSkipped:
    'ディスクは CD-TEXT なしで書き込まれました — このドライブではここで書き込めなかったため、プレーヤーに曲名は表示されません。',
  toastTestWriteDone: 'テスト書き込みが完了しました。ディスクには何も書き込まれていません。',
  toastCdTextVerified_one: 'ディスク上の CD-TEXT を確認しました（{{count}} パック）。',
  toastCdTextVerified_other: 'ディスク上の CD-TEXT を確認しました（{{count}} パック）。',
  toastCdTextUnconfirmed:
    'ディスクは書き込まれ、音声も問題ありません。ただし読み返した際に CD-TEXT は見つかりませんでした。ドライブは挿入時点のディスク内容を保持していることが多いため、古い読み取り結果の可能性があります — 曲名を表示できるプレーヤーで試してください。',
  toastCdTextUnreadable:
    'ディスクは書き込まれ、音声も問題ありません。このドライブはディスクの CD-TEXT を報告しなかったため、書き込まれたかどうかをここで確認できません — 曲名を表示できるプレーヤーで試してください。',

  trackListing: '曲目リスト',
  listingUntitled: 'ミックス CD',
  listingSummary_one: '{{count}} 曲 · {{duration}}',
  listingSummary_other: '{{count}} 曲 · {{duration}}',
  listingCopy: 'コピー',
  listingCopied: '曲目リストをコピーしました。',
  listingCopyFailed: '曲目リストをコピーできませんでした。',
  listingSave: '.txt を保存',
  listingSaveTitle: '曲目リストを保存',
  listingSaved: '曲目リストを保存しました。',
  listingPrint: '印刷',

  addToCd: 'CD に追加',
};
