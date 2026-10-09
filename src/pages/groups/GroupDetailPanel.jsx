import { Eye, Shield, X, Save, Users, ChevronDown, AppWindow, Pencil, Clock, Layers3 } from 'lucide-react';
import UserAvatar from '../../components/UserAvatar';
import AppIcon from '../../components/AppIcon';
import { DEFAULT_GROUP_ID } from '../../../shared/groups.js';

export default function GroupDetailPanel({
  group,
  ui,
  expandedGroup,
  t,
  detailLoading,
  groupDetail,
  editingGroup,
  g,
  editName,
  setEditName,
  isEntraGroup,
  editDesc,
  setEditDesc,
  saveEdit,
  setEditingGroup,
  startEdit,
  canEdit,
  activeGroupPanel,
  setActiveGroupPanel,
  totalLinkedGroupCount,
  openAddGroups,
  linkedGroups,
  groupLabel,
  removeLinkedGroup,
  linkedEntraGroups,
  removeLinkedEntraGroup,
  openAddMembers,
  removeMember,
  openAddApps,
  removeApp,
}) {
  return (
    <>
      {/* Expanded detail */}
      {expandedGroup === group.id && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-6 py-5">
          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-dark rounded-full" />
            </div>
          ) : groupDetail ? (
            <>
              {/* Edit group info */}
              <div className="mb-5 pb-5 border-b border-gray-100 dark:border-gray-800">
                {editingGroup === group.id ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{g.groupNameLabel}</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={group.id === DEFAULT_GROUP_ID || isEntraGroup(group)}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-accent disabled:bg-gray-50 disabled:text-gray-400"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{g.groupDescriptionLabel}</label>
                      <input
                        type="text"
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <button type="button" onClick={saveEdit} title={t.save} aria-label={t.save} className="px-3 py-2 bg-dark text-white rounded-lg text-sm font-medium hover:bg-gray-800">
                        <Save className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setEditingGroup(null)} title={ui.common.cancel} aria-label={ui.common.cancel} className="px-3 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {groupDetail.group?.description || <span className="italic text-gray-300 dark:text-gray-600">{t.noDescription}</span>}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(group); }}
                      disabled={!canEdit || isEntraGroup(group)}
                      className={`flex items-center gap-1 text-xs transition-colors ${
                        !canEdit || isEntraGroup(group)
                          ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                          : 'text-gray-400 dark:text-gray-500 hover:text-dark dark:hover:text-white'
                      }`}
                    >
                      <Pencil className="w-3 h-3" />
                      {g.edit}
                    </button>
                  </div>
                )}
              </div>

              <div className={`grid grid-cols-1 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-6 ${isEntraGroup(group) ? 'xl:items-stretch' : ''}`}>
                <div className={`flex flex-col gap-3 xl:min-h-0 ${isEntraGroup(group) ? 'xl:h-auto' : 'xl:h-[560px]'}`}>
                  {!isEntraGroup(group) && (
                    <section
                    className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 transition-all duration-300 xl:flex xl:flex-col xl:min-h-0 ${
                      activeGroupPanel === 'linked'
                        ? 'xl:flex-[1.35] bg-white dark:bg-gray-900'
                        : 'xl:flex-[0.34] bg-white/80 dark:bg-gray-950/50'
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveGroupPanel('linked')}
                      className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                            {g.linkedGroups} ({totalLinkedGroupCount})
                          </h3>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAddGroups();
                            }}
                            disabled={!canEdit || isEntraGroup(group) || group.id === DEFAULT_GROUP_ID}
                            className={`text-xs font-semibold transition-colors ${
                              !canEdit || isEntraGroup(group) || group.id === DEFAULT_GROUP_ID
                                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                : 'text-accent-dark hover:text-accent-dark'
                            }`}
                          >
                            + {t.add}
                          </button>
                        </div>
                        <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">{g.linkedGroupsHelp}</p>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${activeGroupPanel === 'linked' ? 'rotate-180 text-dark dark:text-gray-100' : ''}`} />
                    </div>
                    <div className={`overflow-hidden transition-all duration-300 ${activeGroupPanel === 'linked' ? 'mt-4 max-h-[430px] opacity-100 xl:flex-1 xl:min-h-0' : 'max-h-0 opacity-0'}`}>
                      {totalLinkedGroupCount === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 min-h-[140px]">
                          <Layers3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">{g.noLinkedGroups}</p>
                          <p className="text-xs mt-1">{g.linkedGroupsHint}</p>
                        </div>
                      ) : (
                        <div className="space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable xl:h-full">
                          {linkedGroups.map((childGroup) => (
                            <div key={childGroup.id} className="flex items-center justify-between py-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <Layers3 className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm text-dark dark:text-gray-100 truncate">{groupLabel(childGroup)}</span>
                                    {childGroup.source === 'entra' && (
                                      <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                                    )}
                                  </div>
                                  {childGroup.description && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{childGroup.description}</p>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => removeLinkedGroup(childGroup.id, groupLabel(childGroup))}
                                disabled={!canEdit}
                                className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title={g.removeLinkedGroup}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          {linkedEntraGroups.length > 0 && (
                            <div className="pt-3">
                              <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                <Layers3 className="w-3.5 h-3.5" />
                                {g.linkedEntraGroups}
                              </div>
                              <div className="space-y-2">
                                {linkedEntraGroups.map((childGroup) => (
                                  <div key={childGroup.entra_group_id} className="flex items-center justify-between py-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Layers3 className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-sm text-dark dark:text-gray-100 truncate">{childGroup.display_name || childGroup.entra_group_id}</span>
                                          <span className="text-[10px] bg-sky-100 text-sky-700 dark:bg-sky-950/55 dark:text-sky-300 px-1.5 py-0.5 rounded-sm font-medium">{g.entraBadge}</span>
                                        </div>
                                        {childGroup.description && (
                                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{childGroup.description}</p>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => removeLinkedEntraGroup(childGroup.entra_group_id, childGroup.display_name || childGroup.entra_group_id)}
                                      disabled={!canEdit}
                                      className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                      title={g.removeLinkedGroup}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    </section>
                  )}

                  <section
                    className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 transition-all duration-300 ${
                      isEntraGroup(group)
                        ? 'xl:flex xl:flex-col bg-white dark:bg-gray-900'
                        : 'xl:flex xl:flex-col xl:min-h-0 ' + (activeGroupPanel === 'members' ? 'xl:flex-[1.35] bg-white dark:bg-gray-900' : 'xl:flex-[0.34] bg-white/80 dark:bg-gray-950/50')
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveGroupPanel('members')}
                      className="flex w-full items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                            {t.members} ({groupDetail.members.length})
                          </h3>
                          {isEntraGroup(group) ? (
                            <span className="text-xs font-semibold text-gray-300 dark:text-gray-600 cursor-not-allowed select-none">
                              + {t.add}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAddMembers();
                              }}
                              disabled={!canEdit || group.id === DEFAULT_GROUP_ID}
                            className={`text-xs font-semibold transition-colors ${
                              !canEdit || group.id === DEFAULT_GROUP_ID
                                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                : 'text-accent-dark hover:text-accent-dark'
                            }`}
                          >
                            + {t.add}
                          </button>
                          )}
                        </div>
                        <p className="text-xs text-sky-600 dark:text-sky-400 mt-1">
                          {groupDetail.members.length === 0
                            ? (!isEntraGroup(group) && totalLinkedGroupCount > 0 ? g.linkedGroupsHint : t.memberAssignedHelp)
                            : t.memberAssignedHelp}
                        </p>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${activeGroupPanel === 'members' ? 'rotate-180 text-dark dark:text-gray-100' : ''}`} />
                    </div>
                    <div className={`overflow-hidden transition-all duration-300 ${isEntraGroup(group)
                      ? 'mt-4 opacity-100'
                      : activeGroupPanel === 'members'
                        ? 'mt-4 opacity-100 xl:flex-1 xl:min-h-0'
                        : 'max-h-0 opacity-0'
                    }`}>
                      {groupDetail.members.length === 0 ? (
                        <div className={`flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 ${
                          isEntraGroup(group) ? 'min-h-[140px]' : 'min-h-[140px]'
                        }`}>
                          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">{t.noMembers}</p>
                          <p className="text-xs mt-1">{!isEntraGroup(group) && totalLinkedGroupCount > 0 ? g.linkedGroupsHint : t.memberAssignedHelp}</p>
                        </div>
                      ) : (
                        <div className={`space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable ${isEntraGroup(group) ? 'max-h-[260px]' : 'xl:h-full'}`}>
                          {groupDetail.members.map((m) => (
                            <div key={m.id} className="flex items-center justify-between py-1.5">
                              <div className="flex items-center gap-2">
                                <UserAvatar
                                  userId={m.id}
                                  displayName={m.display_name}
                                  email={m.email}
                                  avatarColor={m.avatar_color}
                                  className="w-7 h-7"
                                  initialsClassName="text-[10px]"
                                />
                                <div>
                                  <span className="text-sm text-dark dark:text-gray-100">{m.display_name || m.email}</span>
                                  {m.role === 'owner' && (
                                    <span className="ml-1.5 inline-flex items-center align-middle leading-none text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-rose-950/40 dark:text-rose-300">{g.ownerBadge}</span>
                                  )}
                                  {m.role === 'admin' && (
                                    <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-sm font-medium dark:bg-amber-950/40 dark:text-amber-300">
                                      <Shield className="w-3 h-3" />
                                      {g.adminBadge}
                                    </span>
                                  )}
                                  {m.role === 'admin_readonly' && (
                                    <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-1 text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded-sm font-medium">
                                      <Eye className="w-3 h-3" />
                                      {t.readOnlyRole}
                                    </span>
                                  )}
                                  {!m.last_login && (
                                    <span className="ml-1.5 inline-flex items-center align-middle leading-none gap-0.5 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-sm font-medium dark:bg-purple-900/40">
                                      <Clock className="w-3 h-3" />{t.noLogin}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!isEntraGroup(group) && (
                                <button
                                  onClick={() => removeMember(m.id, m.display_name)}
                                  disabled={!canEdit}
                                  className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={t.removeFromGroup}
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {isEntraGroup(group) && (
                        <p className="mt-2 text-xs text-sky-600 dark:text-sky-400">{t.syncedFromEntra}</p>
                      )}
                    </div>
                  </section>
                </div>

                <section className={`rounded-2xl border border-gray-100 dark:border-gray-800 p-4 xl:min-h-0 xl:flex xl:flex-col ${isEntraGroup(group) ? 'xl:h-auto' : 'xl:h-[560px]'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                      {t.visibleApps} ({groupDetail.apps.length})
                    </h3>
                    <button
                      onClick={openAddApps}
                      disabled={!canEdit}
                      className="text-xs font-semibold text-accent-dark hover:text-accent-dark disabled:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + {t.add}
                    </button>
                  </div>
                  {groupDetail.apps.length === 0 ? (
                    <div className={`flex flex-col items-center justify-center text-center py-6 text-gray-300 dark:text-gray-600 ${isEntraGroup(group) ? 'min-h-[140px]' : 'flex-1 min-h-[140px]'}`}>
                      <AppWindow className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">{t.noAppsAssigned}</p>
                      <p className="text-xs mt-1">{(linkedGroups.length + linkedEntraGroups.length) > 0 ? g.linkedGroupsHelp : t.appAssignedHelp}</p>
                    </div>
                  ) : (
                    <div className={`space-y-2 overflow-y-auto pr-3 scrollbar-gutter-stable ${isEntraGroup(group) ? 'max-h-[260px]' : 'xl:flex-1 xl:min-h-0'}`}>
                      {groupDetail.apps.map((a) => (
                        <div key={a.id} className="flex items-center justify-between py-1.5">
                          <div className="flex items-center gap-2">
                            <AppIcon app={a} className="w-6 h-6" textClassName="text-lg" />
                            <span className="text-sm text-dark dark:text-gray-100">{a.name}</span>
                          </div>
                          <button
                            onClick={() => removeApp(a.id, a.name)}
                            disabled={!canEdit}
                            className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={g.removeAppFromGroup}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
