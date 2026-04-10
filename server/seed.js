import 'dotenv/config';
import db from './db.js';
import { v4 as uuidv4 } from 'uuid';

const apps = [
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

const insertApp = db.prepare(`
  INSERT OR IGNORE INTO apps (id, name, slug, description, icon, target_url, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const seedApps = db.transaction(() => {
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    insertApp.run(uuidv4(), app.name, app.slug, app.description, app.icon, app.target_url, i);
  }
});

seedApps();
console.log(`Seeded ${apps.length} apps.`);
