import React, { Fragment } from 'react';
import type { SubsonicOpenArtistRef } from '@/lib/api/subsonicTypes';

interface Props {
  refs: SubsonicOpenArtistRef[];
  /** Used when `refs` is empty (callers should normally avoid that). */
  fallbackName: string;
  /** Invoked with Subsonic artist id when a ref has an id. */
  onGoArtist: (artistId: string) => void;
  /** Wrapper element: `span` (default) or `fragment` children only. */
  as?: 'span' | 'none';
  /** `button` for album header; `span` matches dense player / track rows. */
  linkTag?: 'button' | 'span';
  outerClassName?: string;
  linkClassName?: string;
  /** Applied to every name, linked or not — track cells style both alike. */
  plainClassName?: string;
  separatorClassName?: string;
}

/**
 * Renders OpenSubsonic `artists` / `albumArtists` refs as •-separated names with
 * per-artist navigation when `id` is present (same interaction model as album
 * track rows).
 *
 * The names are trimmed on the way in: servers split a tagged credit string on
 * its separator and keep the surrounding spaces, so a two-artist track arrives as
 * `"Name "` + `" Other Name"`. The separator itself is an empty element that CSS
 * draws and spaces — a bullet character sits wherever the font puts it relative
 * to the baseline (it read as bottom-aligned), and literal spaces around it would
 * collapse against the remnants in the names.
 */
export function OpenArtistRefInline({
  refs,
  fallbackName,
  onGoArtist,
  as = 'span',
  linkTag = 'button',
  outerClassName,
  linkClassName,
  plainClassName,
  separatorClassName = 'open-artist-ref-sep',
}: Props) {
  const list = refs.length > 0 ? refs : [{ name: fallbackName }];
  const linked = [plainClassName, linkClassName].filter(Boolean).join(' ') || undefined;
  const nameOf = (a: { name?: string }) => (a.name ?? fallbackName).trim() || fallbackName;
  const inner = (
    <>
      {list.map((a, i) => (
        <Fragment key={a.id ?? `n:${a.name ?? ''}:${i}`}>
          {i > 0 && <span className={separatorClassName} aria-hidden="true" />}
          {a.id ? (
            linkTag === 'span' ? (
              <span
                role="link"
                tabIndex={0}
                className={linked}
                onClick={e => {
                  e.stopPropagation();
                  onGoArtist(a.id!);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onGoArtist(a.id!);
                  }
                }}
              >
                {nameOf(a)}
              </span>
            ) : (
              <button
                type="button"
                className={linked}
                onClick={e => {
                  e.stopPropagation();
                  onGoArtist(a.id!);
                }}
              >
                {nameOf(a)}
              </button>
            )
          ) : (
            <span className={plainClassName}>{nameOf(a)}</span>
          )}
        </Fragment>
      ))}
    </>
  );
  if (as === 'none') return inner;
  return <span className={outerClassName}>{inner}</span>;
}
