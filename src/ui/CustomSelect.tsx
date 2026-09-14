import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string; // group label — shown as non-selectable header when it changes
  disabled?: boolean;
}

interface Props {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  searchable?: boolean;
  allowCustomValue?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  minDropdownWidth?: number;
}

function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...options];
  return options.filter(option => (
    option.label.toLocaleLowerCase().includes(needle)
    || option.value.toLocaleLowerCase().includes(needle)
  ));
}

export default function CustomSelect({
  value,
  options,
  onChange,
  className = '',
  style,
  disabled,
  ariaLabel,
  ariaInvalid,
  searchable = false,
  allowCustomValue = false,
  searchPlaceholder,
  emptyMessage,
  minDropdownWidth,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  // Keyboard navigation: index of the highlighted option while the list is open.
  const [activeIndex, setActiveIndex] = useState(-1);
  // Stable, render-pure ids for the combobox/listbox relationship.
  const baseId = `custom-select-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const controlId = `${baseId}-control`;
  const listboxId = `${baseId}-listbox`;

  const selected = options.find(o => o.value === value);
  const visibleOptions = useMemo(
    () => (searchable && open ? filterOptions(options, query) : [...options]),
    [open, options, query, searchable],
  );

  const openList = () => {
    if (disabled) return;
    const selectedIdx = visibleOptions.findIndex(o => o.value === value && !o.disabled);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : visibleOptions.findIndex(o => !o.disabled));
    setOpen(true);
  };

  const moveActive = (delta: 1 | -1) => {
    setActiveIndex(prev => {
      let i = prev;
      for (let step = 0; step < visibleOptions.length; step++) {
        i = (i + delta + visibleOptions.length) % visibleOptions.length;
        if (!visibleOptions[i]?.disabled) return i;
      }
      return prev;
    });
  };

  const commitActive = () => {
    const opt = visibleOptions[activeIndex];
    if (opt && !opt.disabled) {
      onChange(opt.value);
      setQuery('');
      setOpen(false);
      if (searchable) inputRef.current?.focus();
      else triggerRef.current?.focus();
    }
  };

  const onControlKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else moveActive(e.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Home':
      case 'End': {
        if (!open || searchable) break;
        e.preventDefault();
        const enabled = visibleOptions.map((o, i) => (o.disabled ? -1 : i)).filter(i => i >= 0);
        if (enabled.length) setActiveIndex(e.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]);
        break;
      }
      case 'Enter':
        if (open) {
          e.preventDefault();
          if (visibleOptions[activeIndex]) commitActive();
          else if (searchable && allowCustomValue && query.trim()) {
            onChange(query.trim());
            setQuery('');
            setOpen(false);
            inputRef.current?.focus();
          }
        }
        break;
      case ' ':
        // Closed buttons use their native click. Search inputs keep normal text entry.
        if (!searchable && open) {
          e.preventDefault();
          commitActive();
        }
        break;
      case 'Tab':
        if (open) {
          if (!searchable) {
            const opt = visibleOptions[activeIndex];
            if (opt && !opt.disabled) onChange(opt.value);
          }
          setQuery('');
          setOpen(false);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setQuery('');
          setOpen(false);
          if (searchable) inputRef.current?.focus();
        }
        break;
      default:
        break;
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updateDropStyle = () => {
      const currentControl = inputRef.current ?? triggerRef.current;
      if (!currentControl) return;
      const rect = currentControl.getBoundingClientRect();
      const MARGIN = 6;
      const maxH = 320;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      const useAbove = spaceBelow < 80 && spaceAbove > spaceBelow;
      const viewportCap = Math.min(maxH, useAbove ? spaceAbove : spaceBelow);
      const contentH = listRef.current?.scrollHeight ?? 0;
      const needsScroll = contentH > viewportCap;
      setDropStyle({
        position: 'fixed',
        left: rect.left,
        width: Math.max(rect.width, minDropdownWidth ?? 0),
        ...(useAbove
          ? { bottom: window.innerHeight - rect.top + MARGIN }
          : { top: rect.bottom + MARGIN }),
        maxHeight: needsScroll ? viewportCap : contentH || viewportCap,
        overflowY: needsScroll ? 'auto' : 'hidden',
        zIndex: 99998,
      });
    };

    updateDropStyle();
    // Re-measure after layout so short lists (e.g. mood groups) don't get a spurious scrollbar.
    const id = requestAnimationFrame(updateDropStyle);
    window.addEventListener('scroll', updateDropStyle, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('scroll', updateDropStyle, true);
    };
  }, [minDropdownWidth, open, visibleOptions]);

  // Keep the keyboard-highlighted option visible in long lists.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listboxId}-opt-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, listboxId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !(inputRef.current ?? triggerRef.current)?.contains(e.target as Node) &&
        !listRef.current?.contains(e.target as Node)
      ) {
        setQuery('');
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <>
      {searchable ? (
        <input
          id={controlId}
          ref={inputRef}
          className={`input ${className}`}
          style={style}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0 && visibleOptions[activeIndex]
            ? `${listboxId}-opt-${activeIndex}`
            : undefined}
          disabled={disabled}
          placeholder={open ? searchPlaceholder : (selected?.label ?? value) || searchPlaceholder}
          value={open ? query : selected?.label ?? value}
          onFocus={() => {
            setQuery('');
            openList();
          }}
          onChange={event => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onControlKeyDown}
        />
      ) : (
        <button
          id={controlId}
          ref={triggerRef}
          type="button"
          role="combobox"
          className={`custom-select-trigger ${className}`}
          style={style}
          disabled={disabled}
          aria-invalid={ariaInvalid || undefined}
          onClick={() => { if (!disabled) { if (open) setOpen(false); else openList(); } }}
          onKeyDown={onControlKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        >
          <span className="custom-select-label">{selected?.label ?? value}</span>
          <ChevronDown size={14} className={`custom-select-chevron ${open ? 'open' : ''}`} />
        </button>
      )}

      {open && createPortal(
        <div
          ref={listRef}
          id={listboxId}
          className="custom-select-dropdown"
          style={dropStyle}
          role="listbox"
          aria-labelledby={controlId}
        >
          {visibleOptions.length === 0 && emptyMessage ? (
            <div className="custom-select-option disabled">{emptyMessage}</div>
          ) : visibleOptions.reduce<React.ReactNode[]>((acc, opt, i) => {
            const prevGroup = i > 0 ? visibleOptions[i - 1].group : undefined;
            if (opt.group && opt.group !== prevGroup) {
              acc.push(
                <div key={`group-${opt.group}`} className="custom-select-group-label">
                  {opt.group}
                </div>
              );
            }
            acc.push(
              <div
                key={opt.value}
                id={`${listboxId}-opt-${i}`}
                className={`custom-select-option ${opt.value === value ? 'selected' : ''} ${i === activeIndex ? 'active' : ''} ${opt.disabled ? 'disabled' : ''}`}
                role="option"
                aria-disabled={opt.disabled || undefined}
                aria-selected={opt.value === value}
                onMouseEnter={() => { if (!opt.disabled) setActiveIndex(i); }}
                onMouseDown={event => {
                  event.preventDefault();
                  if (!opt.disabled) {
                    setActiveIndex(i);
                    onChange(opt.value);
                    setQuery('');
                    setOpen(false);
                    if (searchable) inputRef.current?.focus();
                  }
                }}
              >
                {opt.label}
              </div>
            );
            return acc;
          }, [])}
        </div>,
        document.body
      )}
    </>
  );
}
