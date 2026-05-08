import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { transferGroupApps } from '../server/services/groupAppTransfer.js';

let db;

function initSchema(database) {
  database.exec(`
    CREATE TABLE user_groups (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      source TEXT DEFAULT 'local'
    );

    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL
    );

    CREATE TABLE app_permissions (
      app_id TEXT REFERENCES apps(id),
      group_id TEXT REFERENCES user_groups(id),
      PRIMARY KEY (app_id, group_id)
    );
  `);
}

function addGroup(name) {
  const id = randomUUID();
  db.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

function addApp(slug) {
  const id = randomUUID();
  db.prepare('INSERT INTO apps (id, name, slug) VALUES (?, ?, ?)').run(id, slug, slug);
  return id;
}

function addPermission(appId, groupId) {
  db.prepare('INSERT INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(appId, groupId);
}

describe('group app transfer service', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
  });

  after(() => {
    db.close();
  });

  it('copies all apps from one group to another without removing the source permissions', () => {
    const sourceGroupId = addGroup('source');
    const targetGroupId = addGroup('target');
    const appA = addApp('app-a');
    const appB = addApp('app-b');

    addPermission(appA, sourceGroupId);
    addPermission(appB, sourceGroupId);

    const result = transferGroupApps({
      dbHandle: db,
      sourceGroupId,
      targetGroupId,
      mode: 'copy',
    });

    assert.equal(result.mode, 'copy');
    assert.equal(result.sourceCount, 2);
    assert.equal(result.addedCount, 2);
    assert.equal(result.removedCount, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_permissions WHERE group_id = ?').get(sourceGroupId).count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_permissions WHERE group_id = ?').get(targetGroupId).count, 2);
  });

  it('moves all apps from one group to another by removing the source permissions', () => {
    const sourceGroupId = addGroup('source-move');
    const targetGroupId = addGroup('target-move');
    const appA = addApp('app-c');
    const appB = addApp('app-d');

    addPermission(appA, sourceGroupId);
    addPermission(appB, sourceGroupId);

    const result = transferGroupApps({
      dbHandle: db,
      sourceGroupId,
      targetGroupId,
      mode: 'move',
    });

    assert.equal(result.mode, 'move');
    assert.equal(result.sourceCount, 2);
    assert.equal(result.addedCount, 2);
    assert.equal(result.removedCount, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_permissions WHERE group_id = ?').get(sourceGroupId).count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM app_permissions WHERE group_id = ?').get(targetGroupId).count, 2);
  });
});
