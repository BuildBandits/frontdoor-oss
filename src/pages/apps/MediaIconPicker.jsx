import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../services/api';
import Modal from '../../components/Modal';
import ClearableSearchField from '../../components/ClearableSearchField';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { useLatestRequest } from '../../hooks/useLatestRequest';

// shortcut: shows the first 100 matches (API page limit), search narrows the rest; add paging if libraries grow past that.
const PICKER_LIMIT = 100;

/** Grid of Media Library app icons; onPick receives an asset whose file is on disk. */
export default function MediaIconPicker({ onClose, onPick, ui, a }) {
  const [search, setSearch] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const { begin } = useLatestRequest();
  const searchInputRef = useRef(null);

  useEffect(() => {
    const isLatest = begin();
    setLoading(true);
    setFailed(false);
    api.get('/media-assets', { params: { kind: 'app-icon', limit: PICKER_LIMIT, q: debouncedSearch.trim() || undefined } })
      .then((res) => {
        if (!isLatest()) return;
        // The list groups identical files; link to a copy that is still on disk.
        const rows = Array.isArray(res.data?.assets) ? res.data.assets : [];
        setAssets(rows
          .map((group) => (group.duplicateAssets || [group]).find((item) => item.fileExists))
          .filter(Boolean));
      })
      .catch(() => {
        if (isLatest()) setFailed(true);
      })
      .finally(() => {
        if (isLatest()) setLoading(false);
      });
  }, [debouncedSearch, begin]);

  return (
    <Modal onClose={onClose} initialFocusRef={searchInputRef} labelledBy="media-icon-picker-title" panelClassName="w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl max-h-[85vh] flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 id="media-icon-picker-title" className="text-xl font-bold text-dark dark:text-gray-100">{a.libraryPickerTitle}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{a.libraryPickerHelp}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={ui.common.closeDialog} className="p-2 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="w-5 h-5" />
        </button>
      </div>

      <ClearableSearchField
        value={search}
        onChange={setSearch}
        placeholder={a.librarySearchPlaceholder}
        clearLabel={ui.common.clearSearch}
        className="mb-4"
        inputRef={searchInputRef}
        searchShortcutTarget="primary"
        searchShortcutLabel={ui.common.searchShortcut}
      />

      <div className="min-h-[10rem] overflow-y-auto" aria-busy={loading}>
        {/* Only the status line is announced, not the whole grid on every search. */}
        <p role="status" className={`text-sm ${failed ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {failed ? a.libraryLoadFailed : loading && assets.length === 0 ? ui.common.loading : !loading && assets.length === 0 ? a.libraryEmpty : ''}
        </p>
        {!failed && assets.length > 0 && (
          <ul className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {assets.map((asset) => {
              const label = asset.app_name || asset.original_name || asset.stored_file_name;
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    onClick={() => onPick(asset)}
                    title={label}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex flex-col items-center gap-2 hover:border-accent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent dark:focus-visible:ring-gray-500"
                  >
                    <img src={asset.assetUrl} alt="" loading="lazy" className="w-12 h-12 object-contain" />
                    <span className="w-full truncate text-xs text-gray-600 dark:text-gray-300">{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
