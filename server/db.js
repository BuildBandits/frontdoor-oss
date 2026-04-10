import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

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
    mode TEXT DEFAULT 'redirect-plain' CHECK(mode IN ('redirect', 'redirect-plain', 'shared-cookie')),
    sso_endpoint TEXT DEFAULT '/sso',
    sso_method TEXT DEFAULT 'GET' CHECK(sso_method IN ('GET', 'POST')),
    long_description TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
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
`);

// --- RBAC Bootstrap: "default" group + backfill ---
const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

// Ensure "default" group exists
db.prepare(`INSERT OR IGNORE INTO user_groups (id, name, description) VALUES (?, 'default', 'Default group: new users are added here')`)
  .run(DEFAULT_GROUP_ID);

// Auto-seed apps if table is empty
const appCount = db.prepare('SELECT COUNT(*) as count FROM apps').get().count;
if (appCount === 0) {
  const defaultApps = [
    { name: 'Demo App', slug: 'demo', description: 'A demo application to test the gateway', icon: '🚀', target_url: 'https://demo.example.com' },
    { name: 'Dashboard', slug: 'dashboard', description: 'Analytics and monitoring dashboard', icon: '📊', target_url: 'https://dashboard.example.com' },
    { name: 'Docs', slug: 'docs', description: 'Internal documentation portal', icon: '📚', target_url: 'https://docs.example.com' },
  ];

  const insert = db.prepare('INSERT INTO apps (id, name, slug, description, icon, target_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const assignDefault = db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
  const seedAll = db.transaction(() => {
    defaultApps.forEach((app, i) => {
      const id = uuidv4();
      insert.run(id, app.name, app.slug, app.description, app.icon, app.target_url, i);
      assignDefault.run(id, DEFAULT_GROUP_ID);
    });
  });
  seedAll();
  console.log(`Auto-seeded ${defaultApps.length} apps.`);
}

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

// NOTE: no app backfill — apps are auto-assigned to "default" when created via admin or bulk API

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
