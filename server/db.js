import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { restoreDefaultDemoApps } from './services/demoApps.js';
import { withAuditRefs } from './services/auditDetails.js';
import { DEFAULT_LANGUAGE } from '../shared/languages.js';
import { DEFAULT_GROUP_ID } from '../shared/groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'frontdoor.db');

const db = new Database(dbPath);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Schema initialization
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    microsoft_id TEXT UNIQUE,
    role TEXT DEFAULT 'user' CHECK(role IN ('owner', 'admin', 'admin_readonly', 'user')),
    avatar_color TEXT,
    home_desktop_view TEXT DEFAULT 'cards' CHECK(home_desktop_view IN ('cards', 'compact')),
    preferred_language TEXT,
    preferred_timezone TEXT,
    app_order TEXT,
    app_order_updated_at TEXT,
    favorite_apps TEXT,
    favorite_apps_updated_at TEXT,
    home_tour_seen_at TEXT,
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
    last_activity_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '📦',
    target_url TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'redirect-plain' CHECK(mode IN ('redirect', 'redirect-plain', 'internal-link', 'shared-cookie', 'entra-app')),
    sso_endpoint TEXT DEFAULT '/sso',
    sso_method TEXT DEFAULT 'GET' CHECK(sso_method IN ('GET', 'POST')),
    long_description TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS branding_settings (
    id TEXT PRIMARY KEY,
    hero_title_line1 TEXT NOT NULL,
    hero_title_line2 TEXT NOT NULL,
    hero_subtitle TEXT NOT NULL,
    show_home_hero INTEGER DEFAULT 1,
    hide_home_hero_on_mobile INTEGER DEFAULT 0,
    show_app_mode_badges INTEGER DEFAULT 1,
    default_home_desktop_view TEXT DEFAULT 'cards' CHECK(default_home_desktop_view IN ('cards', 'compact')),
    default_compact_view INTEGER DEFAULT 0,
    default_language TEXT DEFAULT 'en',
    default_timezone TEXT DEFAULT 'UTC',
    default_color_scheme TEXT DEFAULT 'light' CHECK(default_color_scheme IN ('light', 'dark', 'auto')),
    enable_dark_mode_beta INTEGER DEFAULT 0,
    use_european_date_format INTEGER DEFAULT 0,
    log_retention_days INTEGER DEFAULT 90,
    hide_login_page INTEGER DEFAULT 0,
    show_shared_cookie_mode INTEGER DEFAULT 1,
    show_redirect_sso_mode INTEGER DEFAULT 1,
    show_entra_app_mode INTEGER DEFAULT 1,
    plugins_enabled INTEGER DEFAULT 0,
    logo_file_name TEXT,
    logo_content_type TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT REFERENCES users(id),
    app_id TEXT REFERENCES apps(id),
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('app-icon', 'branding-logo')),
    source_ref TEXT,
    original_name TEXT,
    app_name TEXT,
    app_slug TEXT,
    app_target_url TEXT,
    app_mode TEXT,
    stored_file_name TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_groups (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    source TEXT DEFAULT 'local' CHECK(source IN ('local', 'entra')),
    entra_group_id TEXT UNIQUE,
    entra_display_name TEXT,
    entra_synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_group_members (
    user_id TEXT REFERENCES users(id),
    group_id TEXT REFERENCES user_groups(id),
    PRIMARY KEY (user_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS app_permissions (
    app_id TEXT REFERENCES apps(id),
    group_id TEXT REFERENCES user_groups(id),
    PRIMARY KEY (app_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS group_group_memberships (
    parent_group_id TEXT REFERENCES user_groups(id),
    child_group_id TEXT REFERENCES user_groups(id),
    PRIMARY KEY (parent_group_id, child_group_id)
  );

  CREATE TABLE IF NOT EXISTS group_entra_group_memberships (
    parent_group_id TEXT REFERENCES user_groups(id),
    entra_group_id TEXT NOT NULL,
    PRIMARY KEY (parent_group_id, entra_group_id)
  );

  CREATE TABLE IF NOT EXISTS entra_group_cache (
    entra_group_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entra_user_group_memberships (
    user_id TEXT REFERENCES users(id),
    entra_group_id TEXT NOT NULL,
    synced_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, entra_group_id)
  );

  CREATE TABLE IF NOT EXISTS rbac_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('group', 'membership', 'permission', 'role', 'user_status', 'app', 'branding', 'auth', 'plugin')),
    target_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auth_pending_states (
    state TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plugin_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    version TEXT DEFAULT '0.0.0',
    source TEXT DEFAULT 'local',
    entry TEXT,
    manifest_json TEXT NOT NULL DEFAULT '{}',
    permissions_json TEXT DEFAULT '[]',
    roles_json TEXT,
    backend_enabled INTEGER DEFAULT 0,
    backend_url TEXT,
    backend_secret TEXT,
    event_subscriptions_json TEXT DEFAULT '[]',
    approved INTEGER DEFAULT 0,
    approved_by TEXT,
    approved_at TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Admin notification center: one open notification per (type, subject_key).
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info', 'warning', 'critical')),
    subject_key TEXT NOT NULL,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (notification_id, user_id)
  );

  -- Secondary indexes for RBAC join performance
  CREATE INDEX IF NOT EXISTS idx_auth_pending_states_created ON auth_pending_states(created_at);
  CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_app_permissions_group ON app_permissions(group_id);
  CREATE INDEX IF NOT EXISTS idx_app_permissions_app ON app_permissions(app_id);
  CREATE INDEX IF NOT EXISTS idx_group_group_memberships_parent ON group_group_memberships(parent_group_id);
  CREATE INDEX IF NOT EXISTS idx_group_group_memberships_child ON group_group_memberships(child_group_id);
  CREATE INDEX IF NOT EXISTS idx_group_entra_group_memberships_parent ON group_entra_group_memberships(parent_group_id);
  CREATE INDEX IF NOT EXISTS idx_group_entra_group_memberships_entra ON group_entra_group_memberships(entra_group_id);
  CREATE INDEX IF NOT EXISTS idx_access_logs_app ON access_logs(app_id);
  CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_access_logs_created ON access_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_media_assets_kind ON media_assets(kind);
  CREATE INDEX IF NOT EXISTS idx_media_assets_source_ref ON media_assets(source_ref);
  CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit_logs(actor_id);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_target ON rbac_audit_logs(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_created ON rbac_audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_entra_group_cache_last_seen ON entra_group_cache(last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_entra_user_group_memberships_group ON entra_user_group_memberships(entra_group_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_registry_enabled ON plugin_registry(enabled);
  CREATE INDEX IF NOT EXISTS idx_plugin_registry_source ON plugin_registry(source);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_open_subject ON notifications(type, subject_key) WHERE resolved_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_notifications_resolved ON notifications(resolved_at);
`);

const ensuredColumns = [];

function addColumnIfMissing(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
  }
}

// Columns are ensured before the table-rebuild migrations (which copy them) and
// again afterwards, so a rebuild with a stale column list cannot drop them.
function ensureColumn(tableName, columnName, columnDefinition) {
  ensuredColumns.push([tableName, columnName, columnDefinition]);
  addColumnIfMissing(tableName, columnName, columnDefinition);
}

// Rebuilds a table (CREATE _new / copy / DROP / RENAME) atomically. foreign_keys
// is a no-op inside a transaction, so it is toggled around it.
function runTableRebuild(sql) {
  const tableName = sql.match(/CREATE TABLE (\w+)_new/)?.[1] || 'unknown';
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(sql);
      const violations = db.pragma(`foreign_key_check(${tableName})`);
      if (violations.length > 0) {
        console.warn(`[startup][migrations] ${tableName}: ${violations.length} foreign key violation(s) after rebuild.`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

ensureColumn('user_groups', 'source', "source TEXT DEFAULT 'local' CHECK(source IN ('local', 'entra'))");
ensureColumn('user_groups', 'entra_group_id', 'entra_group_id TEXT');
ensureColumn('user_groups', 'entra_display_name', 'entra_display_name TEXT');
ensureColumn('user_groups', 'entra_synced_at', 'entra_synced_at TEXT');
ensureColumn('apps', 'icon_file_name', 'icon_file_name TEXT');
ensureColumn('users', 'home_desktop_view', "home_desktop_view TEXT DEFAULT 'cards' CHECK(home_desktop_view IN ('cards', 'compact'))");
ensureColumn('users', 'preferred_language', 'preferred_language TEXT');
ensureColumn('users', 'preferred_timezone', 'preferred_timezone TEXT');
ensureColumn('users', 'preferred_color_scheme', "preferred_color_scheme TEXT CHECK(preferred_color_scheme IN ('light', 'dark', 'auto'))");
ensureColumn('users', 'app_order', 'app_order TEXT');
ensureColumn('users', 'app_order_updated_at', 'app_order_updated_at TEXT');
ensureColumn('users', 'favorite_apps', 'favorite_apps TEXT');
ensureColumn('users', 'favorite_apps_updated_at', 'favorite_apps_updated_at TEXT');
ensureColumn('users', 'home_tour_seen_at', 'home_tour_seen_at TEXT');
ensureColumn('users', 'last_activity_at', 'last_activity_at TEXT');
ensureColumn('branding_settings', 'show_app_mode_badges', 'show_app_mode_badges INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'default_home_desktop_view', "default_home_desktop_view TEXT DEFAULT 'cards' CHECK(default_home_desktop_view IN ('cards', 'compact'))");
ensureColumn('branding_settings', 'default_compact_view', 'default_compact_view INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'default_language', `default_language TEXT DEFAULT '${DEFAULT_LANGUAGE}'`);
ensureColumn('branding_settings', 'default_timezone', "default_timezone TEXT DEFAULT 'UTC'");
ensureColumn('branding_settings', 'use_european_date_format', 'use_european_date_format INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'use_24h_time_format', 'use_24h_time_format INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'log_retention_days', 'log_retention_days INTEGER DEFAULT 90');
ensureColumn('branding_settings', 'show_home_hero', 'show_home_hero INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'hide_home_hero_on_mobile', 'hide_home_hero_on_mobile INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'hide_login_page', 'hide_login_page INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'show_shared_cookie_mode', 'show_shared_cookie_mode INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'show_redirect_sso_mode', 'show_redirect_sso_mode INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'show_entra_app_mode', 'show_entra_app_mode INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'plugins_enabled', 'plugins_enabled INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'default_color_scheme', "default_color_scheme TEXT DEFAULT 'light' CHECK(default_color_scheme IN ('light', 'dark', 'auto'))");
ensureColumn('branding_settings', 'enable_dark_mode_beta', 'enable_dark_mode_beta INTEGER DEFAULT 0');
// Per-language overrides for the Home hero, stored as JSON maps keyed by language code
// (e.g. {"en":"...","it":"..."}). Empty/absent falls back to the scalar hero_* columns.
ensureColumn('branding_settings', 'hero_title_line1_i18n', 'hero_title_line1_i18n TEXT');
ensureColumn('branding_settings', 'hero_title_line2_i18n', 'hero_title_line2_i18n TEXT');
ensureColumn('branding_settings', 'hero_subtitle_i18n', 'hero_subtitle_i18n TEXT');
ensureColumn('entra_group_cache', 'description', 'description TEXT');
ensureColumn('media_assets', 'app_name', 'app_name TEXT');
ensureColumn('media_assets', 'app_slug', 'app_slug TEXT');
ensureColumn('media_assets', 'app_target_url', 'app_target_url TEXT');
ensureColumn('media_assets', 'app_mode', 'app_mode TEXT');
ensureColumn('plugin_registry', 'approved', 'approved INTEGER DEFAULT 0');
ensureColumn('plugin_registry', 'approved_by', 'approved_by TEXT');
ensureColumn('plugin_registry', 'approved_at', 'approved_at TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_app_slug ON media_assets(app_slug);');

// Migration: normalize user roles to owner/admin/admin_readonly/user on existing databases.
{
  const usersSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const usersSchemaSql = usersSchema?.sql || '';
  const hasOwnerRole = usersSchemaSql.includes("'owner'");
  const hasSuperadminRole = usersSchemaSql.includes("'superadmin'");
  const hasReadonlyRole = usersSchemaSql.includes("'admin_readonly'");
  const needsUsersRoleMigration = usersSchema && (!hasOwnerRole || hasSuperadminRole || !hasReadonlyRole);
  const roleStatsBeforeMigration = usersSchema
    ? db.prepare(`
      SELECT
        SUM(CASE WHEN role = 'superadmin' THEN 1 ELSE 0 END) AS superadmin_count,
        SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) AS owner_count,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
        SUM(CASE WHEN role = 'admin_readonly' THEN 1 ELSE 0 END) AS admin_readonly_count,
        SUM(CASE WHEN role = 'user' OR role IS NULL OR TRIM(COALESCE(role, '')) = '' THEN 1 ELSE 0 END) AS user_count
      FROM users
  `).get()
    : null;
  if (needsUsersRoleMigration) {
    console.log('[startup][roles] users role schema migration required.');
    console.log(`[startup][roles] schema snapshot: owner=${hasOwnerRole}, superadmin=${hasSuperadminRole}, admin_readonly=${hasReadonlyRole}`);
    if (roleStatsBeforeMigration) {
      console.log(`[startup][roles] rows before migration: superadmin=${roleStatsBeforeMigration.superadmin_count || 0}, owner=${roleStatsBeforeMigration.owner_count || 0}, admin=${roleStatsBeforeMigration.admin_count || 0}, admin_readonly=${roleStatsBeforeMigration.admin_readonly_count || 0}, user=${roleStatsBeforeMigration.user_count || 0}`);
    }
    const normalizeRoleSql = hasSuperadminRole || hasReadonlyRole
      ? "CASE WHEN role = 'superadmin' THEN 'owner' ELSE COALESCE(role, 'user') END"
      : "CASE WHEN role = 'admin' THEN 'owner' ELSE COALESCE(role, 'user') END";
    runTableRebuild(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        microsoft_id TEXT UNIQUE,
        role TEXT DEFAULT 'user' CHECK(role IN ('owner', 'admin', 'admin_readonly', 'user')),
        avatar_color TEXT,
        home_desktop_view TEXT DEFAULT 'cards' CHECK(home_desktop_view IN ('cards', 'compact')),
        preferred_language TEXT,
        preferred_timezone TEXT,
        preferred_color_scheme TEXT CHECK(preferred_color_scheme IN ('light', 'dark', 'auto')),
        app_order TEXT,
        app_order_updated_at TEXT,
        favorite_apps TEXT,
        favorite_apps_updated_at TEXT,
        home_tour_seen_at TEXT,
        is_active INTEGER DEFAULT 1,
        last_login TEXT,
        last_activity_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, display_name, microsoft_id, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, is_active, last_login, last_activity_at, created_at, updated_at)
      SELECT id, email, display_name, microsoft_id, ${normalizeRoleSql},
        avatar_color, COALESCE(home_desktop_view, 'cards'), preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, is_active, last_login, last_login, created_at, updated_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    console.log('[startup][roles] users table migrated to role set: owner/admin/admin_readonly/user.');
  }

  const legacySuperadminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin'").get().count || 0;
  if (legacySuperadminCount > 0) {
    console.log(`[startup][roles] converting ${legacySuperadminCount} legacy superadmin role value(s) to owner.`);
    const result = db.prepare("UPDATE users SET role = 'owner', updated_at = datetime('now') WHERE role = 'superadmin'").run();
    console.log(`[startup][roles] converted ${result.changes || 0} user row(s) from superadmin to owner.`);
  } else if (needsUsersRoleMigration) {
    console.log('[startup][roles] no legacy superadmin role values found.');
  }
}

// Migration: relax language CHECK constraints so adding new supported languages does not require DB schema edits.
{
  const usersSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const brandingSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='branding_settings'").get();
  const usersNeedLanguageMigration = usersSchema?.sql?.includes("preferred_language TEXT CHECK(preferred_language IN ('en', 'it'))");
  const brandingNeedLanguageMigration = brandingSchema?.sql?.includes("default_language TEXT DEFAULT 'en' CHECK(default_language IN ('en', 'it'))");

  if (usersNeedLanguageMigration) {
    runTableRebuild(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT,
        microsoft_id TEXT UNIQUE,
        role TEXT DEFAULT 'user' CHECK(role IN ('owner', 'admin', 'admin_readonly', 'user')),
        avatar_color TEXT,
        home_desktop_view TEXT DEFAULT 'cards' CHECK(home_desktop_view IN ('cards', 'compact')),
        preferred_language TEXT,
        preferred_timezone TEXT,
        preferred_color_scheme TEXT CHECK(preferred_color_scheme IN ('light', 'dark', 'auto')),
        app_order TEXT,
        app_order_updated_at TEXT,
        favorite_apps TEXT,
        favorite_apps_updated_at TEXT,
        home_tour_seen_at TEXT,
        is_active INTEGER DEFAULT 1,
        last_login TEXT,
        last_activity_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, display_name, microsoft_id, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, is_active, last_login, last_activity_at, created_at, updated_at)
      SELECT id, email, display_name, microsoft_id, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, is_active, last_login, last_login, created_at, updated_at
      FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }

  if (brandingNeedLanguageMigration) {
    runTableRebuild(`
      CREATE TABLE branding_settings_new (
        id TEXT PRIMARY KEY,
        hero_title_line1 TEXT NOT NULL,
        hero_title_line2 TEXT NOT NULL,
        hero_subtitle TEXT NOT NULL,
        show_home_hero INTEGER DEFAULT 1,
        hide_home_hero_on_mobile INTEGER DEFAULT 0,
        show_app_mode_badges INTEGER DEFAULT 1,
        default_home_desktop_view TEXT DEFAULT 'cards' CHECK(default_home_desktop_view IN ('cards', 'compact')),
        default_compact_view INTEGER DEFAULT 0,
        default_language TEXT DEFAULT '${DEFAULT_LANGUAGE}',
        default_timezone TEXT DEFAULT 'UTC',
        default_color_scheme TEXT DEFAULT 'light' CHECK(default_color_scheme IN ('light', 'dark', 'auto')),
        enable_dark_mode_beta INTEGER DEFAULT 0,
        use_european_date_format INTEGER DEFAULT 0,
        use_24h_time_format INTEGER DEFAULT 0,
        log_retention_days INTEGER DEFAULT 90,
        hide_login_page INTEGER DEFAULT 0,
        show_shared_cookie_mode INTEGER DEFAULT 1,
        show_redirect_sso_mode INTEGER DEFAULT 1,
        show_entra_app_mode INTEGER DEFAULT 1,
        plugins_enabled INTEGER DEFAULT 0,
        logo_file_name TEXT,
        logo_content_type TEXT,
        hero_title_line1_i18n TEXT,
        hero_title_line2_i18n TEXT,
        hero_subtitle_i18n TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO branding_settings_new (id, hero_title_line1, hero_title_line2, hero_subtitle, show_home_hero, hide_home_hero_on_mobile, show_app_mode_badges, default_home_desktop_view, default_compact_view, default_language, default_timezone, default_color_scheme, enable_dark_mode_beta, use_european_date_format, use_24h_time_format, log_retention_days, hide_login_page, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, plugins_enabled, logo_file_name, logo_content_type, hero_title_line1_i18n, hero_title_line2_i18n, hero_subtitle_i18n, created_at, updated_at)
      SELECT id, hero_title_line1, hero_title_line2, hero_subtitle, show_home_hero, hide_home_hero_on_mobile, show_app_mode_badges, default_home_desktop_view, default_compact_view, default_language, default_timezone, default_color_scheme, COALESCE(enable_dark_mode_beta, 0), use_european_date_format, use_24h_time_format, log_retention_days, hide_login_page, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, COALESCE(plugins_enabled, 0), logo_file_name, logo_content_type, hero_title_line1_i18n, hero_title_line2_i18n, hero_subtitle_i18n, created_at, updated_at
      FROM branding_settings;
      DROP TABLE branding_settings;
      ALTER TABLE branding_settings_new RENAME TO branding_settings;
    `);
  }
}

// Migration: expand RBAC audit target types on existing databases.
{
  const auditSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rbac_audit_logs'").get();
  if (auditSchema && (!auditSchema.sql.includes("'app'") || !auditSchema.sql.includes("'branding'") || !auditSchema.sql.includes("'auth'") || !auditSchema.sql.includes("'plugin'"))) {
    runTableRebuild(`
      CREATE TABLE rbac_audit_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('group', 'membership', 'permission', 'role', 'user_status', 'app', 'branding', 'auth', 'plugin')),
        target_id TEXT,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO rbac_audit_logs_new (id, actor_id, action, target_type, target_id, details, created_at)
      SELECT id, actor_id, action, target_type, target_id, details, created_at
      FROM rbac_audit_logs;
      DROP TABLE rbac_audit_logs;
      ALTER TABLE rbac_audit_logs_new RENAME TO rbac_audit_logs;
      CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_rbac_audit_target ON rbac_audit_logs(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_rbac_audit_created ON rbac_audit_logs(created_at);
    `);
  }
}

// Migration: add 'entra-app' and 'internal-link' to apps.mode CHECK constraint (existing databases only)
{
  const appsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='apps'").get();
  if (appsSchema && (!appsSchema.sql.includes('entra-app') || !appsSchema.sql.includes('internal-link'))) {
    runTableRebuild(`
      CREATE TABLE apps_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '📦',
        icon_file_name TEXT,
        target_url TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        mode TEXT DEFAULT 'redirect-plain' CHECK(mode IN ('redirect', 'redirect-plain', 'internal-link', 'shared-cookie', 'entra-app')),
        sso_endpoint TEXT DEFAULT '/sso',
        sso_method TEXT DEFAULT 'GET' CHECK(sso_method IN ('GET', 'POST')),
        long_description TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO apps_new SELECT id, name, slug, description, icon, icon_file_name, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, long_description, tags, created_at, updated_at FROM apps;
      DROP TABLE apps;
      ALTER TABLE apps_new RENAME TO apps;
    `);
  }
}

for (const [tableName, columnName, columnDefinition] of ensuredColumns) {
  addColumnIfMissing(tableName, columnName, columnDefinition);
}

db.exec('UPDATE branding_settings SET show_app_mode_badges = 1 WHERE show_app_mode_badges IS NULL');
db.exec("UPDATE branding_settings SET default_home_desktop_view = 'cards' WHERE default_home_desktop_view IS NULL");
db.exec('UPDATE branding_settings SET default_compact_view = 0 WHERE default_compact_view IS NULL');
db.exec(`UPDATE branding_settings SET default_language = '${DEFAULT_LANGUAGE}' WHERE default_language IS NULL`);
db.exec("UPDATE branding_settings SET default_timezone = 'UTC' WHERE default_timezone IS NULL");
db.exec('UPDATE branding_settings SET use_european_date_format = 0 WHERE use_european_date_format IS NULL');
db.exec('UPDATE branding_settings SET use_24h_time_format = 0 WHERE use_24h_time_format IS NULL');
db.exec('UPDATE branding_settings SET log_retention_days = 90 WHERE log_retention_days IS NULL');
db.exec('UPDATE branding_settings SET show_home_hero = 1 WHERE show_home_hero IS NULL');
db.exec('UPDATE branding_settings SET hide_home_hero_on_mobile = 0 WHERE hide_home_hero_on_mobile IS NULL');
db.exec('UPDATE branding_settings SET hide_login_page = 0 WHERE hide_login_page IS NULL');
db.exec('UPDATE branding_settings SET show_shared_cookie_mode = 1 WHERE show_shared_cookie_mode IS NULL');
db.exec('UPDATE branding_settings SET show_redirect_sso_mode = 1 WHERE show_redirect_sso_mode IS NULL');
db.exec('UPDATE branding_settings SET show_entra_app_mode = 1 WHERE show_entra_app_mode IS NULL');
db.exec('UPDATE branding_settings SET plugins_enabled = 0 WHERE plugins_enabled IS NULL');
db.exec("UPDATE users SET last_activity_at = COALESCE(last_login, updated_at) WHERE last_activity_at IS NULL");

db.exec("UPDATE user_groups SET source = 'local' WHERE source IS NULL OR source NOT IN ('local', 'entra');");
db.exec("CREATE INDEX IF NOT EXISTS idx_user_groups_source ON user_groups(source);");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_entra_group_id ON user_groups(entra_group_id) WHERE entra_group_id IS NOT NULL;");
db.exec(`
  INSERT OR IGNORE INTO entra_group_cache (entra_group_id, display_name, first_seen_at, last_seen_at)
  SELECT entra_group_id, COALESCE(entra_display_name, name), COALESCE(created_at, datetime('now')), COALESCE(entra_synced_at, created_at, datetime('now'))
  FROM user_groups
  WHERE source = 'entra' AND entra_group_id IS NOT NULL;
`);
db.exec(`
  INSERT OR IGNORE INTO entra_user_group_memberships (user_id, entra_group_id, synced_at)
  SELECT m.user_id, g.entra_group_id, COALESCE(g.entra_synced_at, datetime('now'))
  FROM user_group_members m
  JOIN user_groups g ON g.id = m.group_id
  WHERE g.source = 'entra' AND g.entra_group_id IS NOT NULL;
`);

db.prepare(`
  INSERT OR IGNORE INTO branding_settings (
    id, hero_title_line1, hero_title_line2, hero_subtitle, show_home_hero, hide_home_hero_on_mobile, show_app_mode_badges, default_home_desktop_view, default_compact_view, default_language, default_timezone, use_european_date_format, use_24h_time_format, log_retention_days, hide_login_page, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, plugins_enabled, logo_file_name, logo_content_type
  )
  VALUES (?, ?, ?, ?, 1, 0, 1, 'cards', 0, 'en', 'UTC', 0, 0, 90, 0, 1, 1, 1, 0, NULL, NULL)
`).run(
  'default',
  'Your apps,',
  'all in one place.',
  'Quickly access all the tools and platforms in your workspace.'
);

db.exec(`
  UPDATE users
  SET app_order_updated_at = updated_at
  WHERE app_order_updated_at IS NULL
    AND app_order IS NOT NULL
    AND TRIM(COALESCE(app_order, '')) <> ''
`);

// Set by the Entra force sync when Microsoft Graph no longer finds the user (after the users table rebuilds above).
ensureColumn('users', 'entra_missing_since', 'entra_missing_since TEXT');

// PKCE verifier and browser-binding nonce (hashed) for pending Microsoft sign-ins.
ensureColumn('auth_pending_states', 'code_verifier', 'code_verifier TEXT');
ensureColumn('auth_pending_states', 'browser_nonce_hash', 'browser_nonce_hash TEXT');

// --- RBAC Bootstrap: "default" group + backfill ---

// Ensure "default" group exists
db.prepare(`INSERT OR IGNORE INTO user_groups (id, name, description) VALUES (?, 'default', 'Default group: new users are added here')`)
  .run(DEFAULT_GROUP_ID);

// Seed demo apps only on a brand-new installation (no apps and no users yet), so an
// admin who deleted every app does not get the demo apps back on the next restart.
if (!db.prepare('SELECT 1 FROM apps LIMIT 1').get() && !db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const result = restoreDefaultDemoApps(db, DEFAULT_GROUP_ID);
  console.log(`Seeded ${result.total} demo apps (${result.created} created, ${result.updated} refreshed).`);
}

// Ensure default admins (from env var, comma-separated)
const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
for (const email of adminEmails) {
  const promoted = db.prepare("UPDATE users SET role = 'owner', updated_at = datetime('now') WHERE email = ? AND role != 'owner' RETURNING id").get(email);
  if (promoted) console.log(`[startup][roles] promoted compose-managed owner [${promoted.id}]`);
}

// Backfill: add users to "default" only if they are not in ANY group yet
const backfillMembers = db.prepare(`
  INSERT OR IGNORE INTO user_group_members (user_id, group_id)
  SELECT id, ? FROM users
  WHERE id NOT IN (SELECT user_id FROM user_group_members)
`);
const memberResult = backfillMembers.run(DEFAULT_GROUP_ID);
if (memberResult.changes > 0) console.log(`RBAC: added ${memberResult.changes} users to default group.`);

// NOTE: no app backfill — app permissions are assigned explicitly by admin flows or restore actions

/**
 * Log an RBAC mutation for audit trail. Never throws — failures are logged to stderr.
 * Names of the entities involved are snapshotted into `details.refs`, so the row
 * stays readable after those entities are renamed or deleted.
 */
function logRbacAudit(actorId, action, targetType, targetId, details = null) {
  try {
    const payload = withAuditRefs(db, { action, targetType, targetId, details });
    db.prepare('INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(actorId, action, targetType, targetId, payload ? JSON.stringify(payload) : null);
  } catch (e) {
    console.error('RBAC audit log write failed:', e.message);
  }
}

export { DEFAULT_GROUP_ID, logRbacAudit, dbPath };
export default db;
