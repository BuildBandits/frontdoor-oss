import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/**
 * RBAC unit tests — validates the core visibility query logic
 * using Node's built-in node:sqlite (no native deps needed).
 *
 * Run: npm test
 */

let db;
const DEFAULT_GROUP_ID = '00000000-0000-0000-0000-000000000001';

function initSchema(database) {
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      avatar_color TEXT,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📦',
      target_url TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'redirect-plain',
      sso_endpoint TEXT DEFAULT '/sso',
      sso_method TEXT DEFAULT 'GET',
      long_description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE user_groups (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE user_group_members (
      user_id TEXT REFERENCES users(id),
      group_id TEXT REFERENCES user_groups(id),
      PRIMARY KEY (user_id, group_id)
    );

    CREATE TABLE app_permissions (
      app_id TEXT REFERENCES apps(id),
      group_id TEXT REFERENCES user_groups(id),
      PRIMARY KEY (app_id, group_id)
    );

    CREATE INDEX idx_user_group_members_group ON user_group_members(group_id);
    CREATE INDEX idx_app_permissions_group ON app_permissions(group_id);
    CREATE INDEX idx_app_permissions_app ON app_permissions(app_id);
  `);
}

// The RBAC visibility query (mirrors server/routes/apps.js GET /)
function getVisibleApps(userId) {
  const stmt = db.prepare(`
    SELECT DISTINCT a.id, a.name, a.slug
    FROM apps a
    JOIN app_permissions p ON a.id = p.app_id
    JOIN user_group_members m ON p.group_id = m.group_id
    WHERE a.is_active = 1 AND m.user_id = ?
    ORDER BY a.sort_order, a.name
  `);
  return stmt.all(userId);
}

// Seed helpers
function addUser(id, email, role = 'user') {
  db.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(id, email, email.split('@')[0], role);
  db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)').run(id, DEFAULT_GROUP_ID);
}

function addApp(id, name, slug) {
  db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(id, name, slug, `https://${slug}.example.com`);
  db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(id, DEFAULT_GROUP_ID);
}

function addGroup(id, name) {
  db.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').run(id, name);
}

function addMembership(userId, groupId) {
  db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)').run(userId, groupId);
}

function addPermission(appId, groupId) {
  db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(appId, groupId);
}

// --- Tests ---

describe('RBAC app visibility', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  it('user in "default" sees all apps assigned to default', () => {
    const userId = randomUUID();
    const app1 = randomUUID();
    const app2 = randomUUID();

    addUser(userId, 'alice@test.com');
    addApp(app1, 'App One', 'app-one');
    addApp(app2, 'App Two', 'app-two');

    const visible = getVisibleApps(userId);
    const slugs = visible.map(a => a.slug);

    assert.ok(slugs.includes('app-one'), 'should see app-one');
    assert.ok(slugs.includes('app-two'), 'should see app-two');
  });

  it('user NOT in a specific group does NOT see group-only apps', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const secretApp = randomUUID();

    addUser(userId, 'bob@test.com');
    addGroup(groupId, 'secret-team');

    // App assigned ONLY to secret-team (not default)
    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(secretApp, 'Secret App', 'secret-app', 'https://secret.example.com');
    addPermission(secretApp, groupId);

    const visible = getVisibleApps(userId);
    const slugs = visible.map(a => a.slug);

    assert.ok(!slugs.includes('secret-app'), 'should NOT see secret-app');
  });

  it('user added to a group sees group apps', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const groupApp = randomUUID();

    addUser(userId, 'carol@test.com');
    addGroup(groupId, 'design-team');

    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(groupApp, 'Design Tool', 'design-tool', 'https://design.example.com');
    addPermission(groupApp, groupId);

    // Before membership: not visible
    let visible = getVisibleApps(userId);
    assert.ok(!visible.map(a => a.slug).includes('design-tool'), 'should NOT see design-tool before membership');

    // Add membership
    addMembership(userId, groupId);

    // After: visible
    visible = getVisibleApps(userId);
    assert.ok(visible.map(a => a.slug).includes('design-tool'), 'should see design-tool after membership');
  });

  it('removing user from group removes visibility of group-only apps', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const app = randomUUID();

    addUser(userId, 'dave@test.com');
    addGroup(groupId, 'temp-group');
    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(app, 'Temp App', 'temp-app', 'https://temp.example.com');
    addPermission(app, groupId);
    addMembership(userId, groupId);

    let visible = getVisibleApps(userId);
    assert.ok(visible.map(a => a.slug).includes('temp-app'));

    db.prepare('DELETE FROM user_group_members WHERE user_id = ? AND group_id = ?').run(userId, groupId);

    visible = getVisibleApps(userId);
    assert.ok(!visible.map(a => a.slug).includes('temp-app'));
  });

  it('inactive apps are not visible regardless of permissions', () => {
    const userId = randomUUID();
    const app = randomUUID();

    addUser(userId, 'eve@test.com');
    db.prepare('INSERT INTO apps (id, name, slug, target_url, is_active) VALUES (?, ?, ?, ?, 0)').run(app, 'Disabled App', 'disabled-app', 'https://disabled.example.com');
    db.prepare('INSERT INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(app, DEFAULT_GROUP_ID);

    const visible = getVisibleApps(userId);
    assert.ok(!visible.map(a => a.slug).includes('disabled-app'));
  });

  it('app in multiple groups does not appear as duplicate', () => {
    const userId = randomUUID();
    const g1 = randomUUID();
    const g2 = randomUUID();
    const app = randomUUID();

    addUser(userId, 'frank@test.com');
    addGroup(g1, 'group-a');
    addGroup(g2, 'group-b');

    addApp(app, 'Shared App', 'shared-app');
    addPermission(app, g1);
    addPermission(app, g2);

    addMembership(userId, g1);
    addMembership(userId, g2);

    const visible = getVisibleApps(userId);
    const count = visible.filter(a => a.slug === 'shared-app').length;
    assert.equal(count, 1, 'shared-app should appear exactly once');
  });

  it('deleting a group removes its app permissions (cascade logic)', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const app = randomUUID();

    addUser(userId, 'grace@test.com');
    addGroup(groupId, 'ephemeral-group');
    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(app, 'Ephemeral App', 'ephemeral-app', 'https://ephemeral.example.com');
    addPermission(app, groupId);
    addMembership(userId, groupId);

    let visible = getVisibleApps(userId);
    assert.ok(visible.map(a => a.slug).includes('ephemeral-app'));

    // Cascade delete (mirrors server/routes/groups.js DELETE /:id)
    db.prepare('DELETE FROM user_group_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM app_permissions WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM user_groups WHERE id = ?').run(groupId);

    visible = getVisibleApps(userId);
    assert.ok(!visible.map(a => a.slug).includes('ephemeral-app'));
  });

  it('"default" group exists as invariant', () => {
    const row = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(DEFAULT_GROUP_ID);
    assert.ok(row, 'default group must exist');
  });
});

describe('RBAC SSO redirect access check', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  // Mirrors the RBAC check in GET /:slug/sso-redirect
  function hasAppAccess(appId, userId) {
    return !!db.prepare(`
      SELECT 1 FROM app_permissions p
      JOIN user_group_members m ON p.group_id = m.group_id
      WHERE p.app_id = ? AND m.user_id = ?
    `).get(appId, userId);
  }

  it('user with group permission can access app via SSO', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'sso-allowed@test.com');
    addGroup(groupId, 'sso-group');
    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(appId, 'SSO App', 'sso-app', 'https://sso.example.com');
    addPermission(appId, groupId);
    addMembership(userId, groupId);

    assert.ok(hasAppAccess(appId, userId), 'user with group membership should have access');
  });

  it('user without group permission is denied SSO access', () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'sso-denied@test.com');
    addGroup(groupId, 'restricted-group');
    db.prepare('INSERT INTO apps (id, name, slug, target_url) VALUES (?, ?, ?, ?)').run(appId, 'Restricted App', 'restricted-app', 'https://restricted.example.com');
    addPermission(appId, groupId);
    // user NOT added to restricted-group

    assert.ok(!hasAppAccess(appId, userId), 'user without group membership should be denied');
  });

  it('removing app from default makes it invisible to basic users', () => {
    const userId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'basic-user@test.com');
    addApp(appId, 'Visible App', 'visible-app');

    // Initially visible via default
    let visible = getVisibleApps(userId);
    assert.ok(visible.map(a => a.slug).includes('visible-app'));

    // Remove from default
    db.prepare('DELETE FROM app_permissions WHERE app_id = ? AND group_id = ?').run(appId, DEFAULT_GROUP_ID);

    // No longer visible
    visible = getVisibleApps(userId);
    assert.ok(!visible.map(a => a.slug).includes('visible-app'), 'app removed from default should be invisible');
  });
});

describe('User deletion cascades', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  it('deleting a user cleans up group memberships', () => {
    const userId = randomUUID();
    const groupId = randomUUID();

    addUser(userId, 'deleteme@test.com');
    addGroup(groupId, 'some-group');
    addMembership(userId, groupId);

    // Verify membership exists
    let memberships = db.prepare('SELECT COUNT(*) AS count FROM user_group_members WHERE user_id = ?').get(userId).count;
    assert.ok(memberships >= 2, 'should have at least 2 memberships (default + some-group)');

    // Cascade delete (mirrors server/routes/users.js DELETE /:id)
    db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    memberships = db.prepare('SELECT COUNT(*) AS count FROM user_group_members WHERE user_id = ?').get(userId).count;
    assert.equal(memberships, 0, 'no orphan memberships should remain');

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    assert.equal(user, undefined, 'user should be deleted');
  });
});

describe('Admin role protection', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  it('last admin detection works correctly', () => {
    const adminId = randomUUID();
    db.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(adminId, 'solo-admin@test.com', 'Solo Admin', 'admin');

    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
    assert.equal(adminCount, 1);
  });

  it('with two admins, demotion is safe', () => {
    const admin2 = randomUUID();
    db.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(admin2, 'admin2@test.com', 'Admin 2', 'admin');

    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
    assert.ok(adminCount > 1, 'demotion should be safe with multiple admins');
  });
});

describe('Access logs', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    // Add access_logs table (mirrors server/db.js)
    db.exec(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        app_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_access_logs_app ON access_logs(app_id);
      CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id);
    `);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  it('access logs are recorded and queryable', () => {
    const userId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'logger@test.com');
    addApp(appId, 'Logged App', 'logged-app');

    // Simulate 3 accesses
    const insertLog = db.prepare('INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (?, ?, ?, ?)');
    insertLog.run(userId, appId, '192.168.1.1', 'TestAgent/1.0');
    insertLog.run(userId, appId, '192.168.1.2', 'TestAgent/2.0');
    insertLog.run(userId, appId, '10.0.0.1', 'TestAgent/3.0');

    const count = db.prepare('SELECT COUNT(*) AS count FROM access_logs WHERE user_id = ?').get(userId).count;
    assert.equal(count, 3, 'should have 3 log entries');

    // Query with JOIN (mirrors GET /api/logs)
    const logs = db.prepare(`
      SELECT l.id, l.ip_address, u.email AS user_email, a.name AS app_name
      FROM access_logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN apps a ON l.app_id = a.id
      WHERE l.user_id = ?
      ORDER BY l.created_at DESC
    `).all(userId);

    assert.equal(logs.length, 3);
    assert.equal(logs[0].user_email, 'logger@test.com');
    assert.equal(logs[0].app_name, 'Logged App');
  });

  it('deleting a user cascades access logs', () => {
    const userId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'cascade-log@test.com');
    addApp(appId, 'Cascade App', 'cascade-app');

    db.prepare('INSERT INTO access_logs (user_id, app_id, ip_address) VALUES (?, ?, ?)').run(userId, appId, '1.2.3.4');
    db.prepare('INSERT INTO access_logs (user_id, app_id, ip_address) VALUES (?, ?, ?)').run(userId, appId, '5.6.7.8');

    // Cascade delete (mirrors server/routes/users.js DELETE /:id)
    db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM access_logs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    const logs = db.prepare('SELECT COUNT(*) AS count FROM access_logs WHERE user_id = ?').get(userId).count;
    assert.equal(logs, 0, 'access logs should be cleaned up after user deletion');
  });

  it('deleting an app cascades access logs', () => {
    const userId = randomUUID();
    const appId = randomUUID();

    addUser(userId, 'app-cascade@test.com');
    addApp(appId, 'Doomed App', 'doomed-app');

    db.prepare('INSERT INTO access_logs (user_id, app_id, ip_address) VALUES (?, ?, ?)').run(userId, appId, '9.9.9.9');

    // Cascade delete (mirrors server/routes/apps.js DELETE /:id)
    db.prepare('DELETE FROM app_permissions WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM access_logs WHERE app_id = ?').run(appId);
    db.prepare('DELETE FROM apps WHERE id = ?').run(appId);

    const logs = db.prepare('SELECT COUNT(*) AS count FROM access_logs WHERE app_id = ?').get(appId).count;
    assert.equal(logs, 0, 'access logs should be cleaned up after app deletion');
  });
});

describe('Group name validation', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  // Test the sanitization logic (mirrors server/routes/groups.js)
  function sanitizeName(name) {
    if (!name) return null;
    return name.replace(/<[^>]*>/g, '').trim().slice(0, 100);
  }

  function validateGroupName(name) {
    if (!name || !name.trim()) return 'name is required';
    const clean = sanitizeName(name);
    if (clean.length < 2) return 'name must be at least 2 characters';
    if (clean.length > 100) return 'name must be 100 characters or less';
    if (/[<>"'&]/.test(clean)) return 'name contains invalid characters';
    return null;
  }

  it('rejects empty names', () => {
    assert.ok(validateGroupName('') !== null);
    assert.ok(validateGroupName('  ') !== null);
    assert.ok(validateGroupName(null) !== null);
  });

  it('rejects names with HTML tags', () => {
    const result = sanitizeName('<script>alert("xss")</script>Hello');
    assert.equal(result, 'alert("xss")Hello');
  });

  it('rejects single-character names', () => {
    assert.ok(validateGroupName('a') !== null);
  });

  it('accepts valid names', () => {
    assert.equal(validateGroupName('Design Team'), null);
    assert.equal(validateGroupName('HR'), null);
    assert.equal(validateGroupName('team-alpha-2025'), null);
  });

  it('truncates names over 100 characters', () => {
    const longName = 'A'.repeat(150);
    const sanitized = sanitizeName(longName);
    assert.equal(sanitized.length, 100);
  });
});

describe('RBAC audit trail', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS rbac_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('group', 'membership', 'permission', 'role', 'user_status')),
        target_id TEXT,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_rbac_audit_actor ON rbac_audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_rbac_audit_target ON rbac_audit_logs(target_type, target_id);
    `);
    addGroup(DEFAULT_GROUP_ID, 'default');
  });

  after(() => {
    db.close();
  });

  function logAudit(actorId, action, targetType, targetId, details = null) {
    db.prepare('INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(actorId, action, targetType, targetId, details ? JSON.stringify(details) : null);
  }

  it('records audit entry for group creation', () => {
    const adminId = randomUUID();
    const groupId = randomUUID();
    addUser(adminId, 'audit-admin@test.com', 'admin');

    logAudit(adminId, 'create', 'group', groupId, { name: 'test-group' });

    const entry = db.prepare('SELECT * FROM rbac_audit_logs WHERE target_id = ?').get(groupId);
    assert.ok(entry, 'audit entry should exist');
    assert.equal(entry.action, 'create');
    assert.equal(entry.target_type, 'group');
    assert.equal(entry.actor_id, adminId);
    const details = JSON.parse(entry.details);
    assert.equal(details.name, 'test-group');
  });

  it('records audit entry for role change', () => {
    const adminId = randomUUID();
    const userId = randomUUID();
    addUser(adminId, 'role-admin@test.com', 'admin');
    addUser(userId, 'role-target@test.com', 'user');

    logAudit(adminId, 'change_role', 'role', userId, { from: 'user', to: 'admin' });

    const entry = db.prepare("SELECT * FROM rbac_audit_logs WHERE action = 'change_role' AND target_id = ?").get(userId);
    assert.ok(entry);
    const details = JSON.parse(entry.details);
    assert.equal(details.from, 'user');
    assert.equal(details.to, 'admin');
  });

  it('records membership mutations', () => {
    const adminId = randomUUID();
    const groupId = randomUUID();
    const userId = randomUUID();
    addUser(adminId, 'mem-admin@test.com', 'admin');

    logAudit(adminId, 'add_members', 'membership', groupId, { userIds: [userId], added: 1 });
    logAudit(adminId, 'remove_member', 'membership', groupId, { userId });

    const entries = db.prepare("SELECT * FROM rbac_audit_logs WHERE target_type = 'membership' AND target_id = ? ORDER BY id").all(groupId);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].action, 'add_members');
    assert.equal(entries[1].action, 'remove_member');
  });

  it('audit logs are queryable by actor', () => {
    const actorId = randomUUID();
    addUser(actorId, 'prolific-admin@test.com', 'admin');

    logAudit(actorId, 'create', 'group', randomUUID(), { name: 'g1' });
    logAudit(actorId, 'delete', 'group', randomUUID(), { name: 'g2' });
    logAudit(actorId, 'add_apps', 'permission', randomUUID(), { appIds: ['a1'], added: 1 });

    const entries = db.prepare('SELECT * FROM rbac_audit_logs WHERE actor_id = ?').all(actorId);
    assert.equal(entries.length, 3, 'should have 3 audit entries for this actor');
  });

  it('rejects invalid target_type', () => {
    const adminId = randomUUID();
    addUser(adminId, 'bad-type@test.com', 'admin');

    assert.throws(() => {
      logAudit(adminId, 'create', 'invalid_type', randomUUID(), {});
    }, /CHECK constraint/i);
  });
});
