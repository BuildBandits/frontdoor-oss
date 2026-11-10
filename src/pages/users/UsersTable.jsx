import { useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import UserAvatar from '../../components/UserAvatar';
import Tooltip from '../../components/Tooltip';
import DataTable from '../../components/DataTable';
import { formatMessage } from '../../i18n';

const CELL = 'px-4 py-3';
const MUTED_CELL = `${CELL} text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap`;
const ROLES = ['owner', 'admin', 'admin_readonly', 'user'];

// Filter value getters: module level so the table's column definitions stay stable.
const getUserText = (user) => `${user.display_name || ''} ${user.email || ''}`;
const getRole = (user) => user.role;
const getStatus = (user) => (user.is_active ? 'active' : 'inactive');
const getGroups = (user) => (Number(user.group_count || 0) > 0 ? 'with' : 'without');
const getSignIn = (user) => (user.last_login ? 'signedIn' : 'never');
const getPersonalization = (user) => (user.personalized ? 'customized' : 'none');
const getEntra = (user) => (user.entra_missing_since ? 'missing' : 'present');

export default function UsersTable({
  users,
  pageSize,
  pageResetKey,
  columnFilters,
  onColumnFiltersChange,
  expandedUser,
  toggleExpand,
  renderUserDetail,
  roleBadgeClass,
  roleBadgeContent,
  roleLabel,
  isComposeLockedAdmin,
  formatDate,
  language,
  ui,
  t,
  u,
}) {
  // Ascending comparators; ties fall back to the user name. Missing dates sort first.
  const sortFns = useMemo(() => {
    const text = (get) => (x, y) => (get(x) || '').localeCompare(get(y) || '', language, { sensitivity: 'base' });
    const byName = text((user) => user.display_name || user.email);
    const thenName = (compare) => (x, y) => compare(x, y) || byName(x, y);
    const date = (key) => thenName((x, y) => (Date.parse(x[key] || '') || 0) - (Date.parse(y[key] || '') || 0));
    return {
      user: byName,
      role: thenName((x, y) => ROLES.indexOf(x.role) - ROLES.indexOf(y.role)),
      status: thenName((x, y) => Number(Boolean(y.is_active)) - Number(Boolean(x.is_active))),
      group_count: thenName((x, y) => Number(x.group_count || 0) - Number(y.group_count || 0)),
      last_login: date('last_login'),
      last_activity_at: date('last_activity_at'),
      created_at: date('created_at'),
    };
  }, [language]);

  const tt = ui.common.table;
  const labels = {
    ...tt,
    filterColumn: (column) => formatMessage(tt.filterColumn, { column }),
    pageSummary: (pagination) => formatMessage(ui.admin.users.pageSummary, pagination),
    previous: ui.common.previous,
    next: ui.common.next,
    noRows: t.noUsersFound,
  };
  const plainDate = (iso) => (iso ? formatDate(iso) : '—');

  const columns = [
    {
      id: 'user',
      header: ui.nav.users,
      hideable: false,
      filter: { type: 'text', getValue: getUserText },
      cellClassName: CELL,
      cell: (user) => {
        const expanded = expandedUser === user.id;
        return (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleExpand(user.id);
              }}
              aria-expanded={expanded}
              aria-label={`${user.display_name || user.email}: ${t.info}`}
              className="rounded-md p-0.5 text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <UserAvatar
              userId={user.id}
              displayName={user.display_name}
              email={user.email}
              avatarColor={user.avatar_color}
              className={`w-9 h-9 shrink-0 ${!user.is_active ? 'opacity-40' : ''}`}
              initialsClassName="text-xs"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold text-sm ${user.is_active ? 'text-dark dark:text-gray-100' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                  {user.display_name || user.email}
                </span>
                {isComposeLockedAdmin(user) && (
                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">{u.composeBadge}</span>
                )}
                {user.entra_missing_since && (
                  <Tooltip content={u.entraMissingSince.replace('{date}', formatDate(user.entra_missing_since))}>
                    <span className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 px-1.5 py-0.5 rounded-sm font-medium">{u.entraMissingBadge}</span>
                  </Tooltip>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: 'role',
      header: t.role,
      filter: { type: 'values', getValue: getRole, options: ROLES.map((role) => ({ value: role, label: roleLabel(role) })) },
      cellClassName: CELL,
      cell: (user) => (
        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm font-medium whitespace-nowrap ${roleBadgeClass(user.role)}`}>
          {roleBadgeContent(user.role)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t.status,
      filter: { type: 'values', getValue: getStatus, options: [{ value: 'active', label: t.active }, { value: 'inactive', label: t.inactive }] },
      cellClassName: CELL,
      cell: (user) => (user.is_active
        ? <span className="text-xs font-medium text-accent-dark">{t.active}</span>
        : <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-sm font-medium">{t.inactive}</span>),
    },
    {
      id: 'group_count',
      header: ui.nav.groups,
      headerClassName: 'text-center',
      filter: { type: 'values', getValue: getGroups, options: [{ value: 'with', label: u.withGroups }, { value: 'without', label: u.withoutGroups }] },
      cellClassName: `${MUTED_CELL} text-center`,
      cell: (user) => Number(user.group_count || 0),
    },
    {
      id: 'last_login',
      header: t.lastLogin,
      filter: { type: 'values', getValue: getSignIn, options: [{ value: 'signedIn', label: u.signedIn }, { value: 'never', label: t.noLogin }] },
      cellClassName: MUTED_CELL,
      cell: (user) => (user.last_login
        ? formatDate(user.last_login)
        : <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-sm font-medium dark:bg-purple-900/40">{t.noLogin}</span>),
    },
    {
      id: 'last_activity_at',
      header: t.lastActivity,
      hiddenByDefault: true,
      cellClassName: MUTED_CELL,
      cell: (user) => plainDate(user.last_activity_at),
    },
    {
      id: 'created_at',
      header: t.registered,
      hiddenByDefault: true,
      cellClassName: MUTED_CELL,
      cell: (user) => plainDate(user.created_at),
    },
    {
      id: 'personalization',
      header: u.personalizationFilterLabel,
      hiddenByDefault: true,
      filter: { type: 'values', getValue: getPersonalization, options: [{ value: 'customized', label: u.personalizedOnly }, { value: 'none', label: u.noPersonalizations }] },
      cellClassName: MUTED_CELL,
      cell: (user) => (user.personalized ? u.personalizedOnly : u.noPersonalizations),
    },
    {
      id: 'entra',
      header: u.entraColumn,
      hiddenByDefault: true,
      filter: { type: 'values', getValue: getEntra, options: [{ value: 'present', label: u.entraPresent }, { value: 'missing', label: u.entraMissingBadge }] },
      cellClassName: MUTED_CELL,
      cell: (user) => (user.entra_missing_since ? formatDate(user.entra_missing_since) : u.entraPresent),
    },
  ];

  return (
    <DataTable
      headerPaddingClassName="px-4"
      columns={columns}
      sortFns={sortFns}
      rows={users}
      getRowId={(user) => user.id}
      pageSize={pageSize}
      pageResetKey={pageResetKey}
      storageKey="frontdoor.admin.users.columns"
      labels={labels}
      columnFilters={columnFilters}
      onColumnFiltersChange={onColumnFiltersChange}
      onRowClick={(user) => toggleExpand(user.id)}
      isRowExpanded={(user) => expandedUser === user.id}
      renderExpandedRow={renderUserDetail}
      rowClassName={(user) => `border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors hover:bg-gray-50/90 dark:hover:bg-gray-800/55 ${
        user.is_active ? '' : 'bg-red-50/30 dark:bg-red-950/25'
      }`}
    />
  );
}
