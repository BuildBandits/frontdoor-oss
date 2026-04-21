import { v4 as uuidv4 } from 'uuid';

export const DEFAULT_DEMO_APPS = [
  {
    name: 'Demo App',
    slug: 'demo',
    description: 'A demo application to test the gateway',
    icon: '🚀',
    target_url: 'https://demo.example.com',
  },
  {
    name: 'Dashboard',
    slug: 'dashboard',
    description: 'Analytics and monitoring dashboard',
    icon: '📊',
    target_url: 'https://dashboard.example.com',
  },
  {
    name: 'Docs',
    slug: 'docs',
    description: 'Internal documentation portal',
    icon: '📚',
    target_url: 'https://docs.example.com',
  },
];

export function restoreDefaultDemoApps(database, defaultGroupId) {
  const upsertApp = database.prepare(`
    INSERT INTO apps (
      id, name, slug, description, icon, icon_file_name, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, long_description, tags, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'redirect-plain', '/sso', 'GET', '', '[]', datetime('now'), datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      icon = excluded.icon,
      icon_file_name = excluded.icon_file_name,
      target_url = excluded.target_url,
      is_active = 1,
      sort_order = excluded.sort_order,
      mode = excluded.mode,
      sso_endpoint = excluded.sso_endpoint,
      sso_method = excluded.sso_method,
      long_description = excluded.long_description,
      tags = excluded.tags,
      updated_at = datetime('now')
  `);

  const ensurePermission = database.prepare(`
    INSERT OR IGNORE INTO app_permissions (app_id, group_id)
    VALUES (?, ?)
  `);

  const existingBySlug = database.prepare('SELECT id FROM apps WHERE slug = ?');

  const tx = database.transaction(() => {
    let created = 0;
    let updated = 0;

    DEFAULT_DEMO_APPS.forEach((app, sortOrder) => {
      const existing = existingBySlug.get(app.slug);
      const appId = existing?.id || uuidv4();

      upsertApp.run(
        appId,
        app.name,
        app.slug,
        app.description,
        app.icon,
        null,
        app.target_url,
        sortOrder
      );

      ensurePermission.run(appId, defaultGroupId);

      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
    });

    return {
      created,
      updated,
      total: DEFAULT_DEMO_APPS.length,
    };
  });

  return tx();
}
