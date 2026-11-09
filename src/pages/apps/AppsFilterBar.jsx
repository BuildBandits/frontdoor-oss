import { Filter } from 'lucide-react';
import ClearableSearchField from '../../components/ClearableSearchField';
import DropdownSelect from '../../components/DropdownSelect';

export default function AppsFilterBar({
  appSearch,
  setAppSearch,
  ui,
  a,
  t,
  pageSize,
  setPageSize,
  tableAppCount,
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
            {tableAppCount} {ui.nav.apps.toLowerCase()} {t.of} {apps.length}
          </div>
        </div>
      </div>
    </>
  );
}
