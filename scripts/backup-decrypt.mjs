// Decrypts a Frontdoor backup or database export made with a passphrase
// (*.tar.gz.enc, *.json.gz.enc or *.db.enc). The passphrase is read from the
// FRONTDOOR_BACKUP_PASSPHRASE environment variable so it does not show up in
// the process list or shell history as a command-line argument.
//
// Usage: FRONTDOOR_BACKUP_PASSPHRASE=... npm run backup:decrypt -- <input.enc> [output]
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createDecryptStream, decryptBackup, encryptionFormat } from '../server/services/backupCrypto.js';

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

const head = Buffer.alloc(8);
const fd = fs.openSync(input, 'r');
fs.readSync(fd, head, 0, 8, 0);
fs.closeSync(fd);
const format = encryptionFormat(head);
if (!format) {
  console.error(`${input} is not an encrypted Frontdoor file.`);
  process.exit(1);
}

const output = outputArg || input.replace(/\.enc$/, '');
if (output === input) {
  console.error('Choose an output path different from the input.');
  process.exit(2);
}
if (fs.existsSync(output)) {
  console.error(`${output} already exists; choose another output path.`);
  process.exit(1);
}

try {
  if (format === 1) {
    fs.writeFileSync(output, decryptBackup(fs.readFileSync(input), passphrase), { flag: 'wx' });
  } else {
    await pipeline(await createDecryptStream(input, passphrase), fs.createWriteStream(output, { flags: 'wx' }));
  }
  console.log(`Decrypted to ${output}`);
} catch (error) {
  // Never leave a partial or unauthenticated file behind.
  fs.rmSync(output, { force: true });
  console.error(error.message);
  process.exit(1);
}
