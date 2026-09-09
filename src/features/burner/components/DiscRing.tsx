import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatDuration,
  formatMsf,
  sectorsToSeconds,
  type DiscLayout,
} from '@/features/burner/utils/capacity';
import type { BurnPhase } from '@/features/burner/store/burnJobStore';
import { arcColor } from '@/features/burner/utils/arcColor';

/** Disc geometry, in the SVG's own 440×440 user space. */
const CX = 220;
const CY = 220;
const R_OUTER_EDGE = 206;
const R_TRACK_OUT = 200;
const R_TRACK_IN = 94;
const R_LEADIN = 84;
const R_HUB = 76;

/** Visual gap between neighbouring arcs, in degrees. */
const ARC_GAP = 0.34;

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
}

/**
 * Annular sector path — the wedge between two radii and two angles.
 *
 * Degenerate spans are widened to a hairline so a just-started track still
 * paints something instead of vanishing.
 */
function annularSector(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const end = endAngle - startAngle < 0.02 ? startAngle + 0.02 : endAngle;
  const largeArc = end - startAngle > 180 ? 1 : 0;
  const [x0o, y0o] = polar(outerRadius, startAngle);
  const [x1o, y1o] = polar(outerRadius, end);
  const [x1i, y1i] = polar(innerRadius, end);
  const [x0i, y0i] = polar(innerRadius, startAngle);
  return [
    `M ${x0o.toFixed(2)} ${y0o.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
    `L ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x0i.toFixed(2)} ${y0i.toFixed(2)}`,
    'Z',
  ].join(' ');
}

interface HubContent {
  kicker: string;
  big: string;
  note: string;
  mono: string;
  warn?: boolean;
}

export interface DiscRingProps {
  layout: DiscLayout;
  /** Index of the arc the pointer (or the track list) is highlighting. */
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
  /** Burn phase, or null when idle. */
  phase: BurnPhase | null;
  /** Sectors committed so far, during a burn. */
  sectorsDone: number;
  /** 0-based track being fetched/analysed/rendered, while that is the phase. */
  trackIndex: number | null;
  /** How many tracks that preparation pass has to get through. */
  trackTotal: number;
  /** Whether a burn is in flight — disables hover so the ring reads as progress. */
  busy: boolean;
}

/**
 * The disc: a capacity gauge that becomes the progress indicator.
 *
 * The full circle is the loaded disc's capacity, so arcs, the 74:00 mark and
 * the burn fill all share one scale.
 */
export default function DiscRing({
  layout,
  hoveredIndex,
  onHoverChange,
  phase,
  sectorsDone,
  trackIndex,
  trackTotal,
  busy,
}: DiscRingProps) {
  const { t } = useTranslation();
  const { arcs, capacitySectors, totalSectors, remainingSectors, fits, redBook74Angle } = layout;

  const writtenPaths = useMemo(() => {
    // `sectorsDone` carries a track counter during the preparation phases, so
    // the fill must not read it until the laser is on. (It happens to be below
    // the pregap and would light nothing today — but that is a coincidence of
    // the numbers, not a guarantee.)
    const onDisc = phase === 'writing' || phase === 'closing';
    if (!busy || !onDisc || sectorsDone <= 0) return [];
    return arcs
      .filter(arc => sectorsDone > arc.startSector)
      .map(arc => {
        const end = Math.min(sectorsDone, arc.startSector + arc.sectors);
        return {
          key: arc.key,
          index: arc.number - 1,
          d: annularSector(
            R_TRACK_IN,
            R_TRACK_OUT,
            arc.startAngle,
            Math.max(arc.startAngle, (end / capacitySectors) * 360 - ARC_GAP),
          ),
        };
      });
  }, [arcs, busy, phase, sectorsDone, capacitySectors]);

  const hub: HubContent = useMemo(() => {
    if (busy && phase) {
      // Only the laser phases talk about writing. Saying "Writing to disc"
      // while the burner is still downloading or decoding is not just noise —
      // it tells the user the disc is already committed when it isn't, and
      // that is exactly when they most want to know they can still stop.
      const onDisc = phase === 'writing' || phase === 'closing';
      const perTrack = phase === 'fetching' || phase === 'analyzing' || phase === 'rendering';
      const percent = layout.totalSectors > 0
        ? Math.min(100, Math.round((sectorsDone / Math.max(1, layout.totalSectors)) * 100))
        : 0;
      const current = trackIndex !== null ? arcs[trackIndex] : undefined;

      return {
        kicker: t(`burner.phase.${phase}`).toUpperCase(),
        big: onDisc
          ? `${percent}%`
          // During preparation the meaningful number is which track, not a
          // percentage of a disc nothing has been written to.
          : perTrack && trackIndex !== null && trackTotal > 0
            ? `${trackIndex + 1}/${trackTotal}`
            : '···',
        note: perTrack && current
          ? current.title
          : t(`burner.hubPhaseNote.${phase}`),
        mono: onDisc
          ? formatMsf(sectorsDone)
          : perTrack && current
            ? current.artist
            : '',
      };
    }
    if (hoveredIndex !== null && arcs[hoveredIndex]) {
      const arc = arcs[hoveredIndex];
      return {
        kicker: t('burner.hubTrackNumber', { number: String(arc.number).padStart(2, '0') }),
        big: formatDuration(arc.durationSec),
        note: arc.title,
        mono: `${arc.artist} · ${formatMsf(arc.startSector)}`,
      };
    }
    return {
      kicker: fits ? t('burner.hubRemaining') : t('burner.hubOverCapacity'),
      big: fits
        ? formatDuration(sectorsToSeconds(remainingSectors))
        : formatDuration(sectorsToSeconds(totalSectors - capacitySectors)),
      note: t('burner.hubTrackCount', { count: arcs.length }),
      mono: t('burner.hubSectors', {
        used: totalSectors.toLocaleString(),
        capacity: capacitySectors.toLocaleString(),
      }),
      warn: !fits || layout.pastRedBook74,
    };
  }, [busy, phase, sectorsDone, trackIndex, trackTotal, hoveredIndex, arcs, fits, remainingSectors, totalSectors, capacitySectors, layout.pastRedBook74, layout.totalSectors, t]);

  const [tick74Inner, tick74InnerY] = polar(R_TRACK_IN - 6, redBook74Angle);
  const [tick74Outer, tick74OuterY] = polar(R_TRACK_OUT + 10, redBook74Angle);
  const [label74X, label74Y] = polar(R_TRACK_OUT + 24, redBook74Angle);

  return (
    <div className="burner-ring-wrap">
      <svg
        className={`burner-ring${hoveredIndex !== null && !busy ? ' has-hover' : ''}${busy ? ' is-busy' : ''}`}
        viewBox="0 0 440 440"
        role="img"
        aria-label={t('burner.ringLabel', {
          count: arcs.length,
          used: formatDuration(sectorsToSeconds(totalSectors)),
          capacity: formatDuration(sectorsToSeconds(capacitySectors)),
        })}
      >
        <defs>
          <radialGradient id="burner-sheen" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--burner-groove)" stopOpacity="0" />
            <stop offset="72%" stopColor="var(--burner-groove)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--burner-groove)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Disc body */}
        <circle cx={CX} cy={CY} r={R_OUTER_EDGE} fill="var(--burner-void)" />
        <circle cx={CX} cy={CY} r={R_OUTER_EDGE} fill="url(#burner-sheen)" />
        <circle cx={CX} cy={CY} r={R_OUTER_EDGE} fill="none" stroke="var(--border-subtle)" strokeWidth="1" />

        {/* Unused program area */}
        <circle
          cx={CX}
          cy={CY}
          r={(R_TRACK_IN + R_TRACK_OUT) / 2}
          fill="none"
          stroke="var(--border)"
          strokeWidth={R_TRACK_OUT - R_TRACK_IN}
          strokeOpacity="0.28"
        />

        {/* Lead-in ring: innermost, where CD-TEXT lives */}
        <circle
          className={`burner-leadin${phase === 'preparing' ? ' is-active' : ''}`}
          cx={CX}
          cy={CY}
          r={R_LEADIN}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeOpacity="0.35"
        />

        {/* Hub */}
        <circle cx={CX} cy={CY} r={R_HUB} fill="var(--bg-sidebar)" />
        <circle cx={CX} cy={CY} r={R_HUB} fill="none" stroke="var(--border-subtle)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r={30} fill="none" stroke="var(--burner-groove)" strokeWidth="1" />

        {/* Track arcs */}
        <g>
          {arcs.map((arc, index) => (
            <path
              key={arc.key}
              className={`burner-arc${hoveredIndex === index ? ' is-hot' : ''}`}
              d={annularSector(R_TRACK_IN, R_TRACK_OUT, arc.startAngle, Math.max(arc.startAngle, arc.endAngle - ARC_GAP))}
              fill={arcColor(index)}
              fillOpacity="0.42"
              stroke={arcColor(index)}
              strokeWidth="1"
              tabIndex={busy ? -1 : 0}
              role="button"
              aria-label={t('burner.arcLabel', {
                number: arc.number,
                title: arc.title,
                artist: arc.artist,
                duration: formatDuration(arc.durationSec),
              })}
              onMouseEnter={() => !busy && onHoverChange(index)}
              onMouseLeave={() => !busy && onHoverChange(null)}
              onFocus={() => !busy && onHoverChange(index)}
              onBlur={() => !busy && onHoverChange(null)}
            />
          ))}
        </g>

        {/* Committed sectors, lit as the laser passes */}
        <g>
          {writtenPaths.map(written => (
            <path key={written.key} d={written.d} fill={arcColor(written.index)} fillOpacity="0.95" />
          ))}
        </g>

        {/* 74:00 boundary */}
        {redBook74Angle < 360 && (
          <g>
            <line
              x1={tick74Inner}
              y1={tick74InnerY}
              x2={tick74Outer}
              y2={tick74OuterY}
              stroke="var(--danger)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <text
              className="burner-tick-label"
              x={label74X}
              y={label74Y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              74:00
            </text>
          </g>
        )}

        {/*
          Hub readout — kicker and one number only. A track title never fits
          inside a 76-unit hub once the ring is drawn at its real size; it spilled
          over the artwork and read as broken. The detail line lives under the
          disc instead, where there is width for it.
        */}
        <g className="burner-hub">
          <text className="burner-hub-kicker" x={CX} y={200} textAnchor="middle">{hub.kicker}</text>
          <text
            className={`burner-hub-big${hub.warn ? ' is-warn' : ''}`}
            x={CX}
            y={250}
            textAnchor="middle"
          >
            {hub.big}
          </text>
        </g>
      </svg>

      {/* Fixed two-line caption: the layout must not jump as the pointer moves
          across the arcs. */}
      <div className="burner-ring-caption">
        <span className="burner-caption-note">{hub.note}</span>
        <span className="burner-caption-mono">{hub.mono}</span>
      </div>
    </div>
  );
}
