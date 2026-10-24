import { Search, X } from 'lucide-react';
import { useRef } from 'react';
import SortDropdown from '@/ui/SortDropdown';

export type TagCatalogSort = 'popularity' | 'alphabetical';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  sort: TagCatalogSort;
  onSortChange: (value: TagCatalogSort) => void;
  searchPlaceholder: string;
  searchAriaLabel: string;
  clearSearchLabel: string;
  sortAriaLabel: string;
  popularityLabel: string;
  alphabeticalLabel: string;
  benchmarkKind: 'genres' | 'moods';
}

export default function TagCatalogToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  searchPlaceholder,
  searchAriaLabel,
  clearSearchLabel,
  sortAriaLabel,
  popularityLabel,
  alphabeticalLabel,
  benchmarkKind,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="genre-catalog-toolbar">
      <div className="genre-catalog-search">
        <Search
          className="genre-catalog-search__icon"
          size={16}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          className="input-search"
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          data-benchmark-tag-catalog-search={benchmarkKind}
        />
        {query && (
          <button
            type="button"
            className="genre-catalog-search__clear"
            onClick={() => { onQueryChange(''); inputRef.current?.focus(); }}
            aria-label={clearSearchLabel}
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div data-benchmark-tag-catalog-sort={benchmarkKind}>
        <SortDropdown
          value={sort}
          options={[
            { value: 'popularity', label: popularityLabel },
            { value: 'alphabetical', label: alphabeticalLabel },
          ]}
          onChange={onSortChange}
          ariaLabel={sortAriaLabel}
          tooltip={sortAriaLabel}
          align="right"
        />
      </div>
    </div>
  );
}
