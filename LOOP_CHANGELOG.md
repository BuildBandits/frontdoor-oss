# OSS Cleanup Loop Changelog

10 iterazioni di pulizia per trasformare il progetto proprietario in versione open source.

---

## Loop 1 — Core Cleanup (COMPLETATO)

**Obiettivo:** Rimuovere tutti i riferimenti proprietari, domini aziendali, app specifiche.

- `package.json`: rinominato a `oss-frontdoor`, description generica
- `index.html`: title generico "Frontdoor"
- `src/pages/Login.jsx`: testi UI generici
- `src/pages/Home.jsx`: rimosso brand aziendale dal hero
- `src/pages/Admin.jsx`: rimosso endpoint legacy e placeholder URL aziendali
- `server/routes/apps.js`: JWT issuer `frontdoor`, endpoint SSO `/sso`
- `server/db.js`: seed con app generiche, rimosso blocco `ensureApps` proprietario
- `server/seed.js`: riscritto con app generiche
- `.env.example`: rimossi commenti con domini aziendali
- `docker-compose.yml`: default domain `frontdoor.local`
- `test/rbac.test.js`: endpoint SSO `/sso`
- `README.md`: riscritto completamente per OSS (inglese)
- `CHANGELOG.md`: riscritto per versione 1.0.0 OSS
- `SECURITY.md`: riscritto senza riferimenti aziendali
- `.claude/CLAUDE.md`: riscritto per OSS

---

## Loop 2 — License & Secrets Audit (COMPLETATO)

**Obiettivo:** Aggiungere licenza, verificare assenza di segreti, migliorare gitignore/dockerignore.

- Aggiunto `LICENSE` (MIT)
- Audit completo: 0 segreti hardcoded, solo placeholder in .env.example
- `.gitignore`: aggiunto `.env.local`, `*.log`, `*.pem`, `*.key`
- `.dockerignore`: aggiunto `.claude`, `test`, `LOOP_CHANGELOG.md`, `*.pem`, `*.key`

---

## Loop 3 — UI & Default Fix (COMPLETATO)

**Obiettivo:** Verificare testi UI, placeholder, coerenza valori di default.

- Fix bug: `mode: 'proxy'` (non valido) -> `mode: 'redirect-plain'` in `Admin.jsx` (emptyApp e openEdit)
- Verificati tutti i componenti: TagGroupCard, TagInput, AppCard, Layout — puliti
- Confermato: tutti i placeholder e default allineati con i CHECK constraint del DB

---

## Loop 4 — Database Migration Cleanup (COMPLETATO)

**Obiettivo:** Rimuovere migration legacy non necessarie per un DB nuovo.

- Rimosso intero blocco migration (75 righe) — tutto gia' nello schema `CREATE TABLE`
- Rimossa migration legacy di rename gruppi
- Commenti RBAC tradotti in inglese

---

## Loop 5 — OSS Metadata (COMPLETATO)

**Obiettivo:** Completare metadata per distribuzione OSS.

- `index.html`: `lang="it"` -> `lang="en"`
- `package.json`: aggiunto `license`, `repository`, `keywords` (auth, gateway, sso, azure-ad, rbac)

---

## Loop 6 — Final Grep (COMPLETATO)

**Obiettivo:** Verifica esaustiva assenza riferimenti proprietari.

- Grep per tutti i pattern aziendali
- Risultato: 0 match nei sorgenti

---

## Loop 7 — SSO Security Audit (COMPLETATO)

**Obiettivo:** Audit di sicurezza del flusso SSO, verifica firme token, protezione bypass.

Findings:
- State parameter anti-CSRF: OK (uuidv4, verificato, eliminato dopo uso)
- Token OAuth: verificato da MSAL (firma contro certificati Azure pubblici)
- JWT locale: firmato con JWT_SECRET, verificato con `jwt.verify()`
- Cookie: httpOnly, secure in prod, sameSite lax
- Nessun bypass possibile senza code valido da Microsoft

**Fix applicato:** Rimosso JWT token dall'URL di redirect post-SSO. Prima: `/login?token=JWT&user=...` (token leggibile in browser history/log). Dopo: `/login?sso=ok&user=...` (token solo nel cookie httpOnly).

---

## Loop 8 — Azure Entra ID Documentation (COMPLETATO)

**Obiettivo:** Guida dettagliata setup Azure Entra ID nel README.

- Aggiunta guida completa in 5 step: creazione App Registration, identificatori, client secret, API permissions (openid, profile, email, User.Read), env vars
- Documentati i permessi necessari e il grant admin consent
- Aggiunte security notes su PKCE, validazione firma MSAL, httpOnly cookie

---

## Loop 9 — Seed Bug Fix & Code Review (COMPLETATO)

**Obiettivo:** Rilettura di tutti i file modificati, verifica coerenza.

- **Bug fix critico:** le app auto-seeded non venivano assegnate al gruppo default (`app_permissions`), quindi erano invisibili a tutti gli utenti al primo avvio.
- **Fix ordine inizializzazione:** spostato bootstrap RBAC (creazione gruppo default) PRIMA del seed app.
- 27/27 test passati

---

## Loop 10 — Final Sweep (COMPLETATO)

**Obiettivo:** Verifica finale globale.

- Grep finale per tutti i pattern proprietari: 0 match
- Verificato seed.js standalone: app generiche, OK
- 27/27 test passati
- Progetto funzionale e pronto per OSS

---

## Riepilogo Complessivo

| File | Tipo modifica |
|------|--------------|
| `package.json` | Nome, description, license, keywords |
| `package-lock.json` | Rigenerato |
| `index.html` | Title, lang |
| `LICENSE` | Nuovo (MIT) |
| `.gitignore` | Pattern aggiuntivi sicurezza |
| `.dockerignore` | Pattern aggiuntivi |
| `.claude/CLAUDE.md` | Riscritto per OSS |
| `.env.example` | Rimossi commenti aziendali |
| `docker-compose.yml` | Default domain generici |
| `README.md` | Riscritto completo + guida Azure Entra ID |
| `CHANGELOG.md` | Riscritto per v1.0.0 OSS |
| `SECURITY.md` | Riscritto senza riferimenti aziendali |
| `server/db.js` | Seed generico, rimosso migration legacy, fix ordine init, fix assegnazione default group |
| `server/seed.js` | App generiche |
| `server/routes/apps.js` | JWT issuer, `/sso` default |
| `server/routes/auth.js` | Rimosso token da URL redirect |
| `src/pages/Login.jsx` | Testi generici, rimosso token da URL |
| `src/pages/Home.jsx` | Rimosso brand aziendale |
| `src/pages/Admin.jsx` | Default mode fix, placeholder generici |
| `test/rbac.test.js` | `/sso` default |
