export const visualizer = {
  title: 'Visualizzatore',
  modeBars: 'Spettro',
  modeScope: 'Oscilloscopio',
  modeRadial: 'Oscilloscopio radiale',
  modeStereo: 'Campo stereo',
  switchMode: 'Cambia modalità del visualizzatore',
  expand: 'Riempi la finestra',
  collapse: 'Esci dalla finestra intera',
  radioUnavailableTitle: 'Visualizzatore radio non disponibile',
  radioUnavailableHint:
    'La visualizzazione della radio diventa disponibile quando questa stazione si collega al grafo audio dell’equalizzatore. Alcuni stream non supportano questo percorso.',
  settings: {
    section: 'Visualizzatore',
    description:
      'Anima le frequenze del brano durante la riproduzione. L’analisi avviene nel motore audio e solo mentre un visualizzatore è sullo schermo.',
    enableNowPlaying: 'Mostra in “In riproduzione”',
    enableNowPlayingHint: 'Aggiunge il visualizzatore come scheda nella pagina In riproduzione.',
    enableFullscreen: 'Mostra nel player a schermo intero',
    enableFullscreenHint: 'Aggiunge il visualizzatore a ogni stile del player a schermo intero.',
    pauseWhenUnfocused: 'Metti in pausa quando Psysonic non è in primo piano',
    pauseWhenUnfocusedHint:
      'Interrompe il rendering del visualizzatore mentre è attiva un’altra finestra, per ridurre l’uso di CPU e GPU.',
    mode: 'Modalità predefinita',
    sensitivity: 'Sensibilità',
    sensitivityHint: 'Alza i passaggi deboli senza saturare quelli forti.',
    responsiveness: 'Reattività',
    responsivenessHint:
      'Quanto velocemente scendono le barre. Più alta è più scattante e segue i transienti; più bassa lascia code più morbide.',
    peaks: 'Indicatori di picco',
    peaksHint: 'Indicatori in stile Winamp che restano sul massimo recente di ogni banda.',
    colorSource: 'Colori',
    colorSourceHint:
      'Copertina usa la tavolozza della copertina stessa: la tinta dominante, una seconda tinta e il punto più luminoso. Tema usa la scala del colore d’accento del tema attivo. In entrambi i casi i colori vengono adattati allo sfondo del tema.',
    colorSourceAlbum: 'Copertina',
    colorSourceTheme: 'Tema',
    frameRate: 'Frequenza dei fotogrammi',
    frameRateHint: 'Le frequenze più basse consumano meno CPU. L’animazione resta comunque fluida.',
    radioNote:
      'La radio Internet può essere visualizzata dopo che la stazione si è collegata al grafo audio dell’equalizzatore. Alcuni stream non supportano questo percorso.',
    preview: 'Anteprima',
    previewDemo: 'Viene mostrato un segnale dimostrativo mentre non c’è nulla in riproduzione.',
    previewLive: 'Viene mostrata la riproduzione attuale.',
  },
};
