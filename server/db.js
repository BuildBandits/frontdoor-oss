import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

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
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    avatar_color TEXT,
    is_active INTEGER DEFAULT 1,
    last_login TEXT,
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
    mode TEXT DEFAULT 'redirect-plain' CHECK(mode IN ('redirect', 'redirect-plain', 'shared-cookie', 'entra-app')),
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
    show_app_mode_badges INTEGER DEFAULT 1,
    default_compact_view INTEGER DEFAULT 0,
    show_shared_cookie_mode INTEGER DEFAULT 1,
    show_redirect_sso_mode INTEGER DEFAULT 1,
    show_entra_app_mode INTEGER DEFAULT 1,
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

  CREATE TABLE IF NOT EXISTS entra_group_cache (
    entra_group_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
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
    target_type TEXT NOT NULL CHECK(target_type IN ('group', 'membership', 'permission', 'role', 'user_status')),
    target_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Secondary indexes for RBAC join performance
  CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_id);
  CREATE INDEX IF NOT EXISTS idx_app_permissions_group ON app_permissions(group_id);
  CREATE INDEX IF NOT EXISTS idx_app_permissions_app ON app_permissions(app_id);
  CREATE INDEX IF NOT EXISTS idx_access_logs_app ON access_logs(app_id);
  CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit_logs(actor_id);
  CREATE INDEX IF NOT EXISTS idx_rbac_audit_target ON rbac_audit_logs(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_entra_group_cache_last_seen ON entra_group_cache(last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_entra_user_group_memberships_group ON entra_user_group_memberships(entra_group_id);
`);

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`);
  }
}

ensureColumn('user_groups', 'source', "source TEXT DEFAULT 'local' CHECK(source IN ('local', 'entra'))");
ensureColumn('user_groups', 'entra_group_id', 'entra_group_id TEXT');
ensureColumn('user_groups', 'entra_display_name', 'entra_display_name TEXT');
ensureColumn('user_groups', 'entra_synced_at', 'entra_synced_at TEXT');
ensureColumn('apps', 'icon_file_name', 'icon_file_name TEXT');
ensureColumn('branding_settings', 'show_app_mode_badges', 'show_app_mode_badges INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'default_compact_view', 'default_compact_view INTEGER DEFAULT 0');
ensureColumn('branding_settings', 'show_shared_cookie_mode', 'show_shared_cookie_mode INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'show_redirect_sso_mode', 'show_redirect_sso_mode INTEGER DEFAULT 1');
ensureColumn('branding_settings', 'show_entra_app_mode', 'show_entra_app_mode INTEGER DEFAULT 1');

// Migration: add 'entra-app' to apps.mode CHECK constraint (existing databases only)
{
  const appsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='apps'").get();
  if (appsSchema && !appsSchema.sql.includes('entra-app')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
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
        mode TEXT DEFAULT 'redirect-plain' CHECK(mode IN ('redirect', 'redirect-plain', 'shared-cookie', 'entra-app')),
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
    db.pragma('foreign_keys = ON');
  }
}
db.exec('UPDATE branding_settings SET show_app_mode_badges = COALESCE(show_app_mode_badges, 1)');
db.exec('UPDATE branding_settings SET default_compact_view = COALESCE(default_compact_view, 0)');
db.exec('UPDATE branding_settings SET show_shared_cookie_mode = COALESCE(show_shared_cookie_mode, 1)');
db.exec('UPDATE branding_settings SET show_redirect_sso_mode = COALESCE(show_redirect_sso_mode, 1)');
db.exec('UPDATE branding_settings SET show_entra_app_mode = COALESCE(show_entra_app_mode, 1)');

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
    id, hero_title_line1, hero_title_line2, hero_subtitle, show_app_mode_badges, default_compact_view, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, logo_file_name, logo_content_type
  )
  VALUES (?, ?, ?, ?, 1, 0, 1, 1, 1, NULL, NULL)
`).run(
  'default',
  'Le tue applicazioni,',
  'tutte in un unico posto.',
  'Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.'
);

// --- RBAC Bootstrap: "default" group + backfill ---
const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

// Ensure "default" group exists
db.prepare(`INSERT OR IGNORE INTO user_groups (id, name, description) VALUES (?, 'default', 'Default group: new users are added here')`)
  .run(DEFAULT_GROUP_ID);

// Demo apps are intentionally not auto-seeded on restart.
// Use `npm run db:seed` or the admin restore action when you want them back.

// Ensure default admins (from env var, comma-separated)
const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
for (const email of adminEmails) {
  const result = db.prepare("UPDATE users SET role = 'admin', updated_at = datetime('now') WHERE email = ? AND role != 'admin'").run(email);
  if (result.changes > 0) console.log('Promoted user to admin.');
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

/** Log an RBAC mutation for audit trail. Never throws — failures are logged to stderr. */
function logRbacAudit(actorId, action, targetType, targetId, details = null) {
  try {
    db.prepare('INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(actorId, action, targetType, targetId, details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('RBAC audit log write failed:', e.message);
  }
}

export { DEFAULT_GROUP_ID, logRbacAudit };
export default db;
