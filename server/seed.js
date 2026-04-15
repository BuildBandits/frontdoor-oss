import 'dotenv/config';
import db from './db.js';
import { DEFAULT_GROUP_ID } from './db.js';
import { restoreDefaultDemoApps } from './services/demoApps.js';

const result = restoreDefaultDemoApps(db, DEFAULT_GROUP_ID);
console.log(`Seeded ${result.total} demo apps (${result.created} created, ${result.updated} refreshed).`);
