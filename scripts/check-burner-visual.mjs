#!/usr/bin/env node
/**
 * Look at the burner page, and measure it.
 *
 * Every automated gate this repo has — tsc, eslint, vitest, dep:check, the
 * release build — passed clean over a burner page whose disc was painting
 * across the running order and whose track titles had collapsed to a single
 * letter. None of them can see a page. This can.
 *
 * The real page needs a Navidrome connection, a queue and an optical drive, so
 * it cannot be opened in a plain browser. Every fault this is for is a layout
 * fault, and layout needs neither: it needs the real stylesheet and the real
 * DOM shape, which `lib/burner-visual-harness.html` carries verbatim with invented content.
 *
 * It drives the Chromium that Playwright installs, without taking Playwright
 * as a dependency of this project. If that browser is not present the script
 * says so and exits 0, so it can sit in a pipeline without becoming a new way
 * for unrelated work to fail.
 *
 *   npm run check:burner-visual                   measure, assert, exit 1 on failure
 *   node scripts/check-burner-visual.mjs --shot   also write PNGs to .burner-visual/
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SHOT = process.argv.includes('--shot');
/** Where `--shot` writes. Ignored by git; diagnostic output, not source. */
const SHOT_DIR = resolve(HERE, '..', '.burner-visual');

/**
 * The stylesheets the page loads, in the order the app loads them.
 *
 * Two themes, not one. Mocha is the only one of the six that defines
 * `--bg-elevated`, and an unresolvable background computes to transparent
 * rather than failing loudly — so a rule that leans on it looks perfect here
 * and vanishes on the light theme. Latte is the cheapest way to catch that
 * whole class, and it is the shipped light theme besides.
 */
const THEMES = [
  // [label, stylesheet, the `data-theme` value the sheet actually selects on].
  // The third field is not optional bookkeeping: every theme but Mocha scopes
  // its tokens behind that attribute, and guessing it wrong makes NOTHING
  // resolve, which reads as a page-wide failure rather than a harness one.
  ['mocha', 'src/styles/themes/catppuccin-mocha-variables.css', null],
  ['latte', 'src/styles/themes/catppuccin-latte-variables-light-theme.css', 'latte'],
  ['kanagawa', 'src/styles/themes/kanagawa-wave-rebelot-kanagawa-nvim-default-dark.css', 'kanagawa-wave'],
  ['stark', 'src/styles/themes/stark-hud-iron-man-arc-reactor.css', 'stark-hud'],
  ['vision', 'src/styles/themes/vision-dark-purple-gold-colorblind-safe-deuteranopia-protanopia-tritanopia.css', 'vision-dark'],
];
const THEME_ATTR = new Map(THEMES.map(([label, , attr]) => [label, attr]));
const STYLES = [
  ['base.css', 'src/styles/themes/global-base-settings.css'],
  ['burner.css', 'src/styles/components/burner.css'],
];

function findChromium() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(base)) return null;
  const builds = readdirSync(base)
    .filter(name => name.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const build of builds) {
    for (const rel of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = join(base, build, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const chrome = findChromium();
if (!chrome) {
  console.log('burner-visual: no Playwright Chromium found — skipping.');
  console.log('  install one with:  npx playwright install chromium');
  process.exit(0);
}

if (SHOT) mkdirSync(SHOT_DIR, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'burner-visual-'));
for (const [name, source] of STYLES) copyFileSync(join(ROOT, source), join(work, name));
for (const [name, source] of THEMES) copyFileSync(join(ROOT, source), join(work, `theme-${name}.css`));

/**
 * Every shape the page takes.
 *
 * Not decoration: the row markup differs between editable and locked, and the
 * metrics box shows a different number of cells in all four, which is exactly
 * the sort of thing that quietly resizes a column.
 */
const STATES = [
  { key: 'building', stage: 'building', expanded: '0' },
  { key: 'preparing', stage: 'preparing', expanded: '1' },
  { key: 'committing', stage: 'committing', expanded: '1' },
  { key: 'settled', stage: 'settled', expanded: '1' },
];

const harness = (await import('node:fs')).readFileSync(join(HERE, 'lib', 'burner-visual-harness.html'), 'utf8');

let failures = 0;
/** The stage note per state: it must reserve the same height in all four. */
const noteHeights = new Map();
/** The metrics box per state, checked against its floor and its column. */
const metricHeights = new Map();
// 1600 and 1280 exercise the three- and two-column regimes. 1000x600 is the
// one that matters most: it trips BOTH short-window escape hatches and the
// one-column stack at once — the regimes where the size container is
// deliberately dropped, and where a rule left on `100cqmin` resolves against
// the viewport instead. A recess bug lived there precisely because nothing
// rendered it.
// 1600x600 is wide enough for three columns but short enough to trip the
// max-height escape hatch, which is the only way to exercise that regime on
// its own — at 1000x600 the one-column overrides also apply and mask it.
const RUNS = [
  { theme: 'mocha', motion: 'no-preference', sizes: [[1600, 1000], [1280, 800], [1000, 600], [1600, 600]] },
  // One size each is enough for these: they answer "does this rule resolve at
  // all", not "where does this box land".
  { theme: 'latte', motion: 'no-preference', sizes: [[1600, 1000]] },
  { theme: 'kanagawa', motion: 'no-preference', sizes: [[1600, 1000]] },
  { theme: 'stark', motion: 'no-preference', sizes: [[1600, 1000]] },
  { theme: 'vision', motion: 'no-preference', sizes: [[1600, 1000]] },
  { theme: 'mocha', motion: 'reduce', sizes: [[1600, 1000]] },
];

for (const run of RUNS) {
for (const size of run.sizes) {
  for (const state of STATES) {
    const file = join(work, `${run.theme}-${run.motion}-${state.key}-${size[0]}.html`);
    writeFileSync(file, harness
      .replace('data-stage="committing" data-expanded="1"',
        `data-stage="${state.stage}" data-expanded="${state.expanded}"`)
      .replace('./theme.css', `./theme-${run.theme}.css`)
      // Every theme but Mocha scopes its tokens to a `[data-theme]` selector,
      // so loading the file is not enough — without the attribute NOT ONE
      // token resolves and everything falls back, which reads as a hundred
      // failures that are the harness's fault rather than the page's.
      .replace('<!-- THEME-ATTR -->',
        THEME_ATTR.get(run.theme)
          ? `<script>document.documentElement.dataset.theme = '${THEME_ATTR.get(run.theme)}';</script>`
          : ''));

    const args = [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      // Everything a browser normally does on the way up and that this has no
      // use for. Without them a run can spend longer setting itself up than
      // rendering, and can go looking for the network.
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      `--window-size=${size[0]},${size[1]}`, '--virtual-time-budget=2500',
    ];
    // Present or absent, never `=no-preference`.
    //
    // Chromium reads this one with HasSwitch, so the VALUE is never looked at:
    // `--force-prefers-reduced-motion=no-preference` forces reduced motion
    // exactly as hard as `--force-prefers-reduced-motion` does. Written that
    // way, all thirty-six configurations ran reduced — which made the
    // reduced-motion run identical to the other five, its two assertions
    // trivially true, and the ordinary motion regime the page actually ships
    // untested. The waveform is `display: none` under reduce, so this is also
    // why the disc's own canvas measured as absent everywhere.
    if (run.motion === 'reduce') args.push('--force-prefers-reduced-motion');
    // Theme and motion belong in the filename: without them every theme run
    // overwrote the last, and only whichever ran final survived to be looked at.
    let shotName = null;
    if (SHOT) {
      const suffix = [run.theme, run.motion === 'reduce' ? 'reduced' : null].filter(Boolean).join('-');
      shotName = `${state.key}-${size[0]}x${size[1]}-${suffix}`;
      args.push(`--screenshot=${join(SHOT_DIR, `${shotName}.png`)}`);
    }

    // A hard ceiling, because a browser that wedges must fail this check rather
    // than hang it. Giving each run its own --user-data-dir was tried first and
    // was worse: a cold profile made Chromium sit doing first-run work and
    // never exit, leaving processes behind.
    const read = () => execFileSync(
      chrome, [...args, '--dump-dom', `file:///${file.replace(/\\/g, '/')}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
        killSignal: 'SIGKILL',
      },
    );

    let dom = read();
    let found = /MEASURED (\{[\s\S]*\})<\/title>/.exec(dom);
    // One retry, and only for a browser that produced nothing to read. A real
    // layout failure reports a measurement and fails an assertion below; it
    // never lands here, so this cannot paper over one.
    if (!found) {
      dom = read();
      found = /MEASURED (\{[\s\S]*\})<\/title>/.exec(dom);
    }
    if (!found) {
      console.error(`FAIL ${state.key} @${size[0]}x${size[1]}: the harness never reported a measurement`);
      console.error(`     title was: ${(/<title>([\s\S]*?)<\/title>/.exec(dom) ?? [, '(none)'])[1].slice(0, 120)}`);
      failures++;
      continue;
    }
    const m = JSON.parse(found[1]);
    const label = `${state.key} @${size[0]}x${size[1]}`
      + (run.theme === 'mocha' ? '' : ` [${run.theme}]`)
      + (run.motion === 'reduce' ? ' [reduced-motion]' : '');

    // What each configuration is OWED, before anything is asserted about it.
    //
    // Nine of the assertions below used to read `if (m.thing !== null)`, which
    // turned a missing element into a pass: renaming `.burner-mode-slider` in
    // the harness left all 36 configs printing `ok` and this script exiting 0
    // while two whole checks had quietly stopped existing. A check that reports
    // success once its subject has disappeared is worse than no check, because
    // it is trusted. So a required measurement that comes back null is now a
    // failure in its own right, named.
    //
    // Stage-aware, because the page really does render different controls at
    // different points in a burn. Demanding the mode slider mid-burn would fail
    // a correct page, and a check that cries wolf costs the same trust as one
    // that sleeps through a fire.
    const driveRowLive = state.key === 'building' || state.key === 'settled';
    const rowsAreLocked = state.key === 'committing' || state.key === 'settled';
    const required = [
      // Owed in every stage, at every size, on every theme.
      ['stage', 'the stage column', true],
      ['disc', 'the disc', true],
      ['discCss', 'the disc width before scaling', true],
      ['recess', 'the disc recess', true],
      ['discSurface', 'the disc surface', true],
      ['transport', 'the transport row', true],
      // The particle layer and the hub's pulse. Both are pure decoration, and
      // both are exactly the sort of thing a refactor drops without anything
      // noticing — which is why they are owed here by name rather than checked
      // only if they happen to be present. The waveform is the one exception:
      // it animates in place, so reduced motion takes it away entirely, and
      // there it is owed nothing.
      ['waveCanvas', 'the waveform canvas', run.motion !== 'reduce'],
      ['sparkCanvas', 'the spark and note canvas', true],
      ['hub', 'the disc hub', true],
      ['hubContent', 'the hub text', true],
      ['hubPulse', 'the hub pulse layer pair', true],
      // The ring is the disc's whole reason for existing, and until it was
      // added to the harness it was an empty <svg> here — so every opacity
      // that decides whether a burn LOOKS like it is progressing went
      // unrendered and unchecked in all five themes.
      ['ring', 'the ring wedges', true],
      ['metrics', 'the metrics box', true],
      ['rail', 'the rail that holds the metrics box', true],
      ['note', 'the stage note', true],
      // The gutter trio. Owed everywhere: the readout is the last row of the
      // flex column in every stage, the page box is the padding box the gutter
      // is measured against, and the side column is the other edge the readout
      // is lined up with. `side` was measured but never demanded until the
      // gutter checks started reading through it — an unguarded null there
      // crashes the run instead of naming what went missing.
      ['readout', 'the MMC readout', true],
      ['pageBox', 'the page box the gutters are measured from', true],
      ['side', 'the running-order column', true],
      ['dangerBtn', 'the portaled abort button', true],
      ['portaledPrimary', 'the portaled primary button', true],
      // The element is there at one column too, sized to nothing — so this is
      // owed everywhere even where the seam's own box is not.
      ['seamPointerEvents', 'the seam pointer-events reading', true],
      // The switch exists only while the running order is still editable. Once
      // a job owns the drive a static word takes its place, and there is no
      // slider to measure — at `preparing` and after, its absence is correct.
      ['slider', 'the mode slider', state.key === 'building'],
      // The mirror of that: the grip and the remove control give way to locked
      // cells exactly when a job holds the drive, and not before.
      ['lockedCursors', 'the locked row cells', rowsAreLocked],
      // Both live inside the drive row, which is hidden for precisely as long
      // as a job holds the drive — see the drive-row assertion below.
      ['labelledBox', 'the reload button', driveRowLive],
      ['labelledBtn', 'the reload button label', driveRowLive],
    ];
    let absent = 0;
    for (const [key, what, owed] of required) {
      if (owed && m[key] === null) {
        console.error(`FAIL ${label}: ${what} is missing — ${key} measured null, `
          + 'so the checks that rest on it cannot run');
        failures++; absent++;
      }
    }
    // The row cells arrive as lists, where "gone" reads as an empty array, or a
    // hole in one, rather than as null.
    for (const [key, what] of [['titles', 'the running-order titles'], ['states', 'the row state cells']]) {
      if (m[key].length === 0 || m[key].some(cell => cell === null)) {
        console.error(`FAIL ${label}: ${what} are missing — ${key} came back `
          + `${m[key].length === 0 ? 'empty' : 'with a hole in it'}`);
        failures++; absent++;
      }
    }
    // Nothing below can say anything true about a page that did not report
    // itself, and reading through a null would crash rather than explain.
    if (absent > 0) continue;

    // What must hold everywhere, in every regime.
    const checks = [
      ['disc stays inside the stage',
        m.disc.x >= m.stage.x - 1 && m.disc.x + m.disc.w <= m.stage.x + m.stage.w + 1],
      // The recess is a separate element sized the same way as the disc, so it
      // needs the same overrides wherever the size container is dropped.
      // Compared unscaled on both sides: the disc's rect is post-transform.
      ['the recess tracks the disc rather than the viewport',
        Math.abs(m.recess.w - m.discCss.w) <= 2],
      // The row is a grid, and dropping a cell shifts every later one. Both
      // page states have to put these in the same column or the running order
      // rearranges itself the moment a burn starts.
      ['every title shares one column', new Set(m.titles.map(t => t.x)).size === 1],
      ['titles are wide enough to read', Math.min(...m.titles.map(t => t.w)) > 80],
      ['state cells share one column', new Set(m.states.map(s => s.x)).size === 1],
      // The readout and the running order are both stretch-sized children of
      // the page's padding box, so they cannot be tuned apart — one right edge
      // is the page's right inset, and if they ever disagree something has
      // grown a margin of its own rather than one of them needing a nudge.
      ['the readout and the running order end on the same line',
        Math.abs((m.readout.x + m.readout.w) - (m.side.x + m.side.w)) <= 1],
      // And that shared edge must not be the page edge. `.content-body
      // .mainstage-inpage-split` sets `padding-right: 0` at (0,2,0) and used
      // to beat `.burner-page`'s padding shorthand at (0,1,0), so the readout
      // and the running order both ran dead into the queue panel's border with
      // 20px of air on the left and none on the right. `.burner-page` takes it
      // back at (0,3,0); this is what notices if that rule is ever dropped,
      // renamed, or out-specified again.
      ['the readout clears the right edge of the page',
        (m.pageBox.x + m.pageBox.w) - (m.readout.x + m.readout.w) >= 16],
      // The gutter is one number — `--burner-gutter` — used on both sides, so
      // asymmetry means the token is not what is deciding one of them.
      ['the page gutters are symmetric',
        Math.abs((m.readout.x - m.pageBox.x)
          - ((m.pageBox.x + m.pageBox.w) - (m.readout.x + m.readout.w))) <= 1],
    ];

    /** How far apart two 0-255 colours are. */
    const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    // Written and unwritten have to read apart, on every theme.
    //
    // These numbers were tuned against a darker palette than the one that
    // shipped. Catppuccin's `--ctp-*` are pastels — `#cba6f7` is nearly white
    // — so an unwritten wedge at 0.42 fill came out almost as bright as a
    // written one at 0.95 and the ring stopped carrying any information: a
    // disc at 14% looked like a disc at 90%. Sampled at mid-band radius the
    // reference holds unwritten at RGB 23-45 and written at 50-115, which over
    // this page's ground is about 0.08 and about 0.32.
    //
    // Written is drawn OVER its own unwritten wedge, so what the eye gets is
    // the composite; that is what the ratio below is stated against.
    const composed = 1 - (1 - m.ring.rest.fill) * (1 - m.ring.written.fill);
    checks.push(
      ['an unwritten wedge is genuinely dark', m.ring.rest.fill <= 0.2],
      ['an unwritten wedge is not outlined like stained glass', m.ring.rest.stroke <= 0.4],
      ['a written wedge is not flat pastel', m.ring.written.fill <= 0.5],
      ['the written arc reads clearly brighter than the rest of the ring',
        composed >= m.ring.rest.fill * 2.5],
      // Hover is stacked on the same base and inverts its own meaning if that
      // base moves without it: at 0.2 over an 0.08 base, "dim the others"
      // would have LIT them.
      ['hovering the running order still dims the other wedges',
        m.ring.dim.fill < m.ring.rest.fill && m.ring.dim.stroke < m.ring.rest.stroke],
      ['the hovered wedge is still unmistakable', m.ring.hot.fill >= m.ring.rest.fill * 2],
      // The laser: a white core inside a coloured halo. `--burner-molten` was
      // 88% white, so the glow was a second white stroke and the only
      // track-coloured layer sat under it at 0.22, invisible.
      //
      // Stated as a distance and not as inequality. Written `headGlow !==
      // headCore` this passed on a glow of pure white, because a computed
      // `color-mix` serialises as `color(srgb 1 1 1)` and a plain colour as
      // `rgb(255, 255, 255)` — two spellings of the same colour, and the check
      // was reading the spelling. What has to be true is that the glow sits
      // nearer the track's own colour, which `headHaze` carries resolved, than
      // it does to the white core.
      ['the write head keeps a white core',
        m.ring.headCore.every(c => c >= 254)],
      ['the write head glow carries the track colour rather than more white',
        gap(m.ring.headGlow, m.ring.headHaze) < gap(m.ring.headGlow, m.ring.headCore)],
    );

    // The particles have to be free to leave the disc, and to have the same
    // room to do it in at every angle. Inscribed in the well like the disc,
    // one leaving at twelve o'clock hit the canvas edge at once while one
    // leaving at four had the corner to travel through.
    const mid = box => box.x + box.w / 2;
    const middle = box => box.y + box.h / 2;
    checks.push(
      ['the spark canvas reaches past the disc', m.sparkCanvas.w > m.disc.w + 4],
      // A pure expansion, not a re-layout: it has to grow by the same amount
      // on every side, or the effect is off-centre from the head that threw it.
      ['the spark canvas grows evenly around the disc',
        Math.abs(mid(m.sparkCanvas) - mid(m.disc)) <= 1
        && Math.abs(middle(m.sparkCanvas) - middle(m.disc)) <= 1
        && Math.abs((m.sparkCanvas.w - m.disc.w) - (m.sparkCanvas.h - m.disc.h)) <= 2],
    );
    // And the waveform is NOT inflated. It is drawn on the ring and has
    // nowhere to escape to, so it must still land exactly on the disc — except
    // under reduced motion, where it is hidden outright because it animates in
    // place. That rule lives in the same block the mode slider was once lost
    // from, so it is asserted rather than assumed.
    checks.push(run.motion === 'reduce'
      ? ['the waveform is hidden under reduced motion', m.waveCanvas === null]
      : ['the waveform canvas still matches the disc',
        Math.abs(m.waveCanvas.w - m.disc.w) <= 1 && Math.abs(m.waveCanvas.h - m.disc.h) <= 1]);

    // The hub's pulse. Decorative, centred, behind the text, and incapable of
    // taking a pointer — this circle sits over the middle of an object whose
    // page carries an abort button during an irreversible burn.
    checks.push(
      ['the hub pulse keyframes are valid', m.hubPulse.error === null],
      ['the hub pulse layers are round and out of flow',
        m.hubPulse.radius.every(r => r.startsWith('50%'))
        && m.hubPulse.position.every(p => p === 'absolute')],
      ['the hub pulse layers never take the pointer',
        m.hubPulse.pointerEvents.every(v => v === 'none')],
      ['the hub pulse layers stay centred on the hub',
        Math.abs(mid(m.hubPulse.ring) - mid(m.hub)) <= 1
        && Math.abs(mid(m.hubPulse.shock) - mid(m.hub)) <= 1
        && Math.abs(middle(m.hubPulse.ring) - middle(m.hub)) <= 1
        && Math.abs(middle(m.hubPulse.shock) - middle(m.hub)) <= 1],
      // The decoration must not have pushed the text out of the badge.
      ['the hub text stays inside the hub',
        m.hubContent.x >= m.hub.x - 1
        && m.hubContent.x + m.hubContent.w <= m.hub.x + m.hub.w + 1],
    );

    // Three layers pulse, and reduced motion is owed the static glow with none
    // of the movement. Mirrors the mode-slider pair below it: assert the thing
    // runs at all first, or "it stopped" passes on a page where it never
    // started.
    checks.push(run.motion === 'reduce'
      ? ['the hub pulse is inert under reduced motion', m.hubPulse.running === 0]
      : ['the hub pulse runs while the laser is on', m.hubPulse.running === 3]);

    // The drive row is hidden only while a job holds the drive. At `settled`
    // the job has stopped and its controls are live again, so hiding it there
    // left someone whose burn had just failed with no route to Refresh, Erase
    // or the reload-disc escape hatch.
    checks.push(['drive row is present exactly when its controls are usable',
      (m.driveRow !== null) === driveRowLive]);

    // The reload button grows a text label in one case — a disc that is present,
    // refused and not erasable — and its base rule is a hard 30px square. The
    // label then centres itself and spills out of BOTH sides of its own button,
    // over the controls either side of it. Measured against the button rather
    // than against anything further away: the overflow is local, and checking
    // the media facts four hundred pixels away caught nothing.
    if (driveRowLive) {
      checks.push(['the reload label stays inside its own button',
        m.labelledBtn.x >= m.labelledBox.x - 1
        && m.labelledBtn.x + m.labelledBtn.w <= m.labelledBox.x + m.labelledBox.w + 1]);
    }

    // The cells that replace the grip and the remove control must not keep
    // their cursors, or every row mid-burn offers affordances that do nothing.
    if (rowsAreLocked) {
      checks.push(['locked row cells drop the control cursors',
        m.lockedCursors.grip === 'default' && m.lockedCursors.remove === 'default']);
    }

    // The mode slider must have a fill on every theme, not only the one that
    // happens to define the token it reaches for.
    if (state.key === 'building') {
      checks.push(['the mode slider has a fill on this theme',
        m.slider.background !== 'rgba(0, 0, 0, 0)' && m.slider.background !== 'transparent']);
      // And it is the one genuinely translating object on the page, so it is
      // the one that most needs to stop when asked to.
      if (run.motion === 'reduce') {
        checks.push(['the mode slider stops animating under reduced motion',
          m.slider.transition === 'none' || m.slider.transition === '']);
      }
    }

    // The primary button must keep its fill outside the page too. A color-mix
    // naming an undefined custom property is invalid at computed-value time and
    // takes the whole declaration with it, so the gradient vanished in the
    // portaled modal and left dark on-accent text on nothing.
    checks.push(['a primary button keeps its fill outside the page',
      m.portaledPrimary.background !== 'none' && m.portaledPrimary.background !== '']);

    // The disc must have a surface on every theme. `--burner-void` is derived
    // from `--bg-deep`, which only Mocha defines, and a derived token built on
    // an undefined one is invalid — which drops the whole gradient and leaves
    // the showpiece as a hole.
    checks.push(['the disc surface is painted on this theme',
      m.discSurface.background !== 'none' && m.discSurface.background !== '']);

    // And the destructive control must read as destructive. `--text-on-accent`
    // is Mocha-only too, so its colour silently fell back to body text.
    checks.push(['the abort button has a fill and readable text on this theme',
      m.dangerBtn.background !== 'rgba(0, 0, 0, 0)'
      && m.dangerBtn.color !== m.dangerBtn.bodyColor]);

    // A row drag passing over the gutter must not be able to start a resize.
    checks.push(['the seam ignores the pointer during a row drag',
      m.seamPointerEvents.idle !== 'none' && m.seamPointerEvents.dragging === 'none']);

    // "Fits on screen" only means anything while the page cannot scroll. It
    // stacks and scrolls at one column, and the short-window escape hatch turns
    // scrolling on at any column count — so the column count alone is the wrong
    // question to ask, and asking it failed a correct short-window layout.
    if (!m.scrolls) {
      checks.push(
        ['disc ends above the transport', m.disc.y + m.disc.h <= m.transport.y + 1],
        ['disc never reaches the seam', m.seam === null || m.disc.x + m.disc.w <= m.seam.x + 1],
        ['transport is on screen', m.transport.y + m.transport.h <= size[1]],
      );
    }

    // The header is a grid of its own. It lines up with the rows only because
    // it is handed the same `--burn-row-cols` and the same inline padding, and
    // nothing but this enforces that — so a column added to one and not the
    // other silently mislabels every figure underneath it.
    for (const cell of ['number', 'track', 'artist', 'time', 'start']) {
      const head = m.head?.[cell];
      const row = m.firstRow?.[cell];
      // A cell hidden by a container query is absent from both, which is
      // correct rather than a failure; one absent from only one is not.
      if (head === null && row === null) continue;
      checks.push([`header "${cell}" sits over its column`,
        head !== null && row !== null && Math.abs(head.x - row.x) <= 1]);
    }

    for (const [name, pass] of checks) {
      if (!pass) { console.error(`FAIL ${label}: ${name}`); failures++; }
    }
    // Only meaningful at three columns: at two the rail is a full-width
    // strip and at one it is a stacked block, and neither bounds it.
    // Only where the page cannot scroll: the short-window escape hatch
    // deliberately lets the note grow, because there the page scrolls and a
    // taller note costs the disc nothing.
    if (!m.scrolls) noteHeights.set(label, m.note.h);
    metricHeights.set(label, { h: m.metrics.h, railH: m.cols === 3 ? m.rail.h : null });

    // Alongside each screenshot, where it came from. A PNG of the whole window
    // is no use for sampling the ring unless you know where in it the disc
    // landed, and guessing that from the image is how you end up measuring the
    // page background and calling it a wedge.
    if (shotName) writeFileSync(join(SHOT_DIR, `${shotName}.json`), JSON.stringify(m, null, 2));

    if (checks.every(([, pass]) => pass)) console.log(`ok   ${label}`);
  }
}
}

// The metrics box legitimately shows a different set per stage, so its height
// changes and that is fine — it sits in its own scrollable column and nothing
// downstream is sized from it. What must hold is that it never collapses below
// the floor its min-height promises, and never grows past the rail that holds
// it, which would push the burn options out of reach during a burn.
let metricFaults = 0;
// An empty map is not a pass. This runs over whatever the loop collected, so a
// metrics box that vanished from every configuration used to leave it with
// nothing to compare and nothing to print — and the run still ended green. The
// same goes for the rail: `railH` is null at one and two columns, which is the
// honest reason, but if it were null everywhere the floor below would never be
// applied to anything.
if (metricHeights.size === 0) {
  console.error('FAIL: no configuration got as far as reporting a metrics box — its floor was never checked');
  failures++;
} else if (![...metricHeights.values()].some(box => box.railH !== null)) {
  console.error('FAIL: no three-column configuration reported a rail — the metrics floor was never checked');
  failures++;
}
for (const [label, box] of metricHeights) {
  // The floor is a three-column claim. At two columns the metrics box is a
  // horizontal strip and at one it is a stacked block; a floor written for a
  // tall column fails both of those correctly-laid-out cases.
  if (box.railH !== null && box.h < 178) {
    console.error(`FAIL ${label}: metrics box is ${box.h}px, below its 178px floor`);
    failures++; metricFaults++;
  } else if (box.railH !== null && box.h > box.railH) {
    console.error(`FAIL ${label}: metrics box (${box.h}px) is taller than the rail (${box.railH}px)`);
    failures++; metricFaults++;
  }
}
if (metricHeights.size > 0 && metricFaults === 0) {
  console.log('ok   metrics box stays within its column in every stage');
}

// The note holds a one-line blocker in three stages and a whole outcome block
// in the fourth, and the disc sits in the flexible row directly above it. So a
// note that grew with its content shrank the showpiece the instant a burn
// ended — which is why the slot reserves its height instead.
let noteDrift = 0;
// And again: with no heights collected there is nothing to disagree, which is
// not the same as the stages agreeing.
if (noteHeights.size === 0) {
  console.error('FAIL: no non-scrolling configuration got as far as reporting a stage note — '
    + 'the height it reserves was never compared between stages');
  failures++;
}
for (const width of new Set([...noteHeights.keys()].map(l => l.split('@')[1]))) {
  const seen = [...noteHeights].filter(([label]) => label.endsWith(width));
  const heights = new Set(seen.map(([, h]) => h));
  if (heights.size > 1) {
    console.error(`FAIL @${width}: the stage note changes height between stages — ` +
      seen.map(([label, h]) => `${label.split(' ')[0]}=${h}`).join(' '));
    failures++;
    noteDrift++;
  }
}
if (noteHeights.size > 0 && noteDrift === 0) {
  console.log('ok   stage note reserves the same height in every stage');
}

if (failures > 0) {
  console.error(`\nburner-visual: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nburner-visual: the page holds together at every size and state checked.');
