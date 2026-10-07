// Decrypts a Frontdoor backup or database export made with a passphrase
// (*.json.gz.enc or *.db.enc). The passphrase is read from the
// FRONTDOOR_BACKUP_PASSPHRASE environment variable so it does not show up in
// the process list or shell history as a command-line argument.
//
// Usage: FRONTDOOR_BACKUP_PASSPHRASE=... npm run backup:decrypt -- <input.enc> [output]
import fs from 'node:fs';
import { decryptBackup, isEncryptedBackup } from '../server/services/backupCrypto.js';

const [input, outputArg] = process.argv.slice(2);
if (!input) {
  console.error('Usage: FRONTDOOR_BACKUP_PASSPHRASE=... npm run backup:decrypt -- <input.enc> [output]');
  process.exit(2);
}

const passphrase = process.env.FRONTDOOR_BACKUP_PASSPHRASE;
if (!passphrase) {
  console.error('Set FRONTDOOR_BACKUP_PASSPHRASE to the passphrase used for the export.');
  process.exit(2);
}

const buffer = fs.readFileSync(input);
if (!isEncryptedBackup(buffer)) {
  console.error(`${input} is not an encrypted Frontdoor file.`);
  process.exit(1);
}

const output = outputArg || input.replace(/\.enc$/, '');
if (output === input) {
  console.error('Choose an output path different from the input.');
  process.exit(2);
}

try {
  fs.writeFileSync(output, decryptBackup(buffer, passphrase), { flag: 'wx' });
  console.log(`Decrypted to ${output}`);
} catch (error) {
  console.error(error.code === 'EEXIST' ? `${output} already exists; choose another output path.` : error.message);
  process.exit(1);
}
