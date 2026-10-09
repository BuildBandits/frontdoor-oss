import { ChevronDown, Check, Filter, Settings, Tag } from 'lucide-react';
import ClearableSearchField from '../../components/ClearableSearchField';
import DropdownSelect from '../../components/DropdownSelect';
import { UNLABELED_TAG_FILTER } from './constants';

export default function AppsFilterBar({
  appSearch,
  setAppSearch,
  ui,
  modeFilterRef,
  setModeFilterOpen,
  filterButtonMinWidth,
  a,
  currentModeFilterOption,
  modeFilterOpen,
  visibleModeFilterOptions,
  appModeFilter,
  setAppModeFilter,
  tagFilterRef,
  setTagFilterOpen,
  hasTagFilters,
  tagFilterOpen,
  selectedTagFilters,
  tagFilterSearch,
  setTagFilterSearch,
  tagFilterSearchRef,
  handleTagFilterSearchKeyDown,
  setSelectedTagFilters,
  tagFilterItemRefs,
  handleTagFilterItemKeyDown,
  toggleTagFilter,
  t,
  filteredTags,
  pageSize,
  setPageSize,
  filteredApps,
  apps,
}) {
  return (
    <>
      <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex-[1.1] min-w-[180px]">
            <ClearableSearchField
              value={appSearch}
              onChange={setAppSearch}
              placeholder={ui.admin.apps.searchPlaceholder}
              clearLabel={ui.common.clearSearch}
              searchShortcutTarget="primary"
              searchShortcutLabel={ui.common.searchShortcut}
            />
          </div>
          <div className="relative" ref={modeFilterRef}>
            <button
              type="button"
              onClick={() => setModeFilterOpen((prev) => !prev)}
            className={`relative inline-flex h-12 items-center w-full ${filterButtonMinWidth} pl-10 pr-10 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-left text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-900`}
            >
              <Settings className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="shrink-0 text-gray-400 dark:text-gray-500">{a.modeFilterShort}:</span>
                <span className="truncate">{currentModeFilterOption.label}</span>
              </span>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </button>

            {modeFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                <div className="py-1">
                  {visibleModeFilterOptions.map((opt) => {
                    const selected = appModeFilter === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setAppModeFilter(opt.value);
                          setModeFilterOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selected ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex-1">{opt.label}</span>
                        {selected && <Check className="h-4 w-4 text-dark dark:text-gray-100" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="relative" ref={tagFilterRef}>
            <button
              type="button"
              onClick={() => setTagFilterOpen((prev) => !prev)}
              className={`relative inline-flex h-12 items-center w-full ${filterButtonMinWidth} pl-10 pr-10 border rounded-xl text-sm text-left transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-gray-500 dark:focus-visible:ring-offset-gray-900 ${
                hasTagFilters
                  ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/45 dark:text-violet-100'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300'
              }`}
              aria-haspopup="menu"
              aria-expanded={tagFilterOpen}
            >
              <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span
                className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden pr-12 whitespace-nowrap"
                style={{
                  WebkitMaskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 3rem), transparent 100%)',
                  maskImage: 'linear-gradient(to right, #000 0, #000 calc(100% - 3rem), transparent 100%)',
                }}
              >
                <span className="shrink-0 text-gray-400 dark:text-gray-500">{a.tagFilterLabel}:</span>
                <span className="min-w-0">
                  {selectedTagFilters.length === 0
                    ? a.tagFilterAll
                    : a.tagFilterSelected.replace('{count}', String(selectedTagFilters.length))}
                </span>
              </span>
              <span className="absolute right-10 top-1/2 -translate-y-1/2 inline-flex min-w-6 items-center justify-center rounded-full bg-white/80 dark:bg-gray-900/80 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-300">
                {selectedTagFilters.length}
              </span>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </button>

            {tagFilterOpen && (
              <div className="absolute right-0 z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                <div className="border-b border-gray-100 dark:border-gray-800 px-3 py-3">
                  <ClearableSearchField
                    value={tagFilterSearch}
                    onChange={setTagFilterSearch}
                    placeholder={a.tagFilterSearchPlaceholder}
                    clearLabel={ui.common.clearSearch}
                    inputClassName="text-sm"
                    autoFocus
                    inputRef={tagFilterSearchRef}
                    onKeyDown={handleTagFilterSearchKeyDown}
                  />
                </div>
                <div className="max-h-72 overflow-auto py-1">
                  {hasTagFilters && (
                    <button
                      type="button"
                      onClick={() => setSelectedTagFilters([])}
                      ref={(node) => { tagFilterItemRefs.current[0] = node; }}
                      onKeyDown={(event) => handleTagFilterItemKeyDown(event, 0)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors text-violet-700 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                    >
                      <span className="flex h-4 w-4 items-center justify-center rounded-sm border border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100" aria-hidden="true">
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="flex-1 font-semibold">{a.clearTagFilters}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedTagFilters([])}
                    ref={(node) => { tagFilterItemRefs.current[hasTagFilters ? 1 : 0] = node; }}
                    onKeyDown={(event) => handleTagFilterItemKeyDown(event, hasTagFilters ? 1 : 0)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      !hasTagFilters
                        ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        !hasTagFilters ? 'border-dark bg-dark text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1">{a.tagFilterAll}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTagFilter(UNLABELED_TAG_FILTER)}
                    ref={(node) => { tagFilterItemRefs.current[hasTagFilters ? 2 : 1] = node; }}
                    onKeyDown={(event) => handleTagFilterItemKeyDown(event, hasTagFilters ? 2 : 1)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      selectedTagFilters.includes(UNLABELED_TAG_FILTER)
                        ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        selectedTagFilters.includes(UNLABELED_TAG_FILTER)
                          ? 'border-dark bg-dark text-white'
                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1">{a.appsWithoutTags}</span>
                  </button>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                  {filteredTags.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">
                      {a.noTagFilterMatches}
                    </div>
                  ) : filteredTags.map((tag, tagIndex) => {
                    const selected = selectedTagFilters.includes(tag);
                    const index = (hasTagFilters ? 3 : 2) + tagIndex;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTagFilter(tag)}
                        ref={(node) => { tagFilterItemRefs.current[index] = node; }}
                        onKeyDown={(event) => handleTagFilterItemKeyDown(event, index)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? 'bg-gray-50 dark:bg-gray-900 text-dark dark:text-gray-100'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            selected ? 'border-dark bg-dark text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-transparent'
                          }`}
                          aria-hidden="true"
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="flex-1 truncate">{tag}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DropdownSelect
            value={pageSize}
            onChange={(next) => setPageSize(parseInt(next, 10))}
            label={ui.admin.logs.rows}
            icon={Filter}
            options={[
              { value: 25, label: '25' },
              { value: 50, label: '50' },
              { value: 100, label: '100' },
              { value: 150, label: '150' },
            ]}
            className="min-w-[150px]"
          />
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {filteredApps.length} {ui.nav.apps.toLowerCase()} {t.of} {apps.length}
          </div>
        </div>
      </div>
    </>
  );
}
