import 'dotenv/config';
import { ConfidentialClientApplication } from '@azure/msal-node';
import db from '../db.js';
import { prewarmAvatarCacheForUser } from '../services/avatars.js';

const includeInactive = process.argv.includes('--include-inactive');
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
  },
};

async function acquireGraphAppToken() {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
    return null;
  }

  const client = new ConfidentialClientApplication(msalConfig);
  const response = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return response?.accessToken || null;
}

async function main() {
  const where = includeInactive ? '1=1' : 'is_active = 1';
  const users = db.prepare(`
    SELECT id, email, microsoft_id, display_name, is_active
    FROM users
    WHERE ${where}
    ORDER BY email
  `).all();

  const accessToken = await acquireGraphAppToken();
  if (!accessToken) {
    console.warn('Graph app credentials not configured. Microsoft 365 photos will not be prewarmed.');
  } else {
    console.log('Graph app token acquired. Microsoft 365 photos will be prewarmed when available.');
  }

  let cached = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const result = await prewarmAvatarCacheForUser(user, accessToken);
      if (result) {
        cached += 1;
        console.log(`[${user.email}] cached from ${result.source}`);
      } else {
        skipped += 1;
        console.log(`[${user.email}] no avatar found`);
      }
    } catch (error) {
      failed += 1;
      console.error(`[${user.email}] failed: ${error.message}`);
    }
  }

  console.log(`Done. users=${users.length} cached=${cached} skipped=${skipped} failed=${failed}`);
}

main().catch((error) => {
  console.error('Avatar prewarm failed:', error.message);
  process.exitCode = 1;
});
