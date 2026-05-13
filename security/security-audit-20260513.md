# SECURITY AUDIT REPORT

**Progetto:** oss-frontdoor (v1.0.1)
**Data audit:** 2026-05-13
**Data ultimo aggiornamento:** 2026-05-13 (post-remediation pass + triage finding aperti)
**Branch:** worktree-silly-jumping-aurora
**Riferimenti:** OWASP Top 10 (2021), Node.js Security Cheat Sheet OWASP, CIS Docker Benchmark

---

## STATO COMPLESSIVO

- **Findings totali:** 17
- **Risolti:** 11 (4 HIGH, 4 MEDIUM, 2 LOW, 1 INFO)
- **Aperti / da pianificare:** 1 (1 MEDIUM — design da definire)
- **Won't fix / accepted risk:** 4 (1 MEDIUM, 3 LOW)
- **Note INFO:** 1 (CORS — non applicabile)
- **CRITICAL:** 0 (mai presenti)

### Distribuzione attuale

| Severità  | Originali | Risolti | Aperti | Won't fix | Note     |
|-----------|-----------|---------|--------|-----------|----------|
| CRITICAL  | 0         | —       | 0      | —         | —        |
| HIGH      | 4         | **4**   | 0      | 0         | —        |
| MEDIUM    | 6         | **4**   | 1      | 1         | —        |
| LOW       | 5         | **2**   | 0      | 3         | —        |
| INFO      | 2         | **1**   | 0      | 0         | 1 (N/A)  |

---

## ✅ FIX COMPLETATI

Ordine cronologico inverso (più recenti in cima). Modifiche del pass iniziale sul branch `worktree-silly-jumping-aurora`; i 3 fix più recenti (triage 2026-05-13) sono direttamente su `main`.

### ✅ [LOW] Vulnerabilità moderate in dev dependencies (Vite/esbuild)
**Commit:** `46a6e44 security: upgrade Vite 5 → 8 and bump @vitejs/plugin-react to 5`
**File:** `package.json`, `package-lock.json`, `vite.config.js` (verificato compatibile, no modifiche)
**Fix:** upgrade `vite` da `^5.1.0` a `^8.0.12` e `@vitejs/plugin-react` da `^4.2.1` a `^5.x`. Chiude le 2 CVE moderate residue (`GHSA-67mh-4wv8-2f99` esbuild dev-server SSRF e `GHSA-4w7w-66w2-5vf9` vite `.map` path traversal). `npm audit` ora pulito (0 vulnerabilità).
**Verifica empirica:** `npm run build` completa (1539 moduli, tutti i chunk `manualChunks` rigenerati correttamente); 57/57 test passano.

### ✅ [INFO] `helmet` v7 — versione attuale è 8
**Commit:** `642f10b security: upgrade helmet v7 → v8`
**File:** `package.json`, `package-lock.json`
**Fix:** bump da `^7.1.0` a `^8.1.0`. La `contentSecurityPolicy.directives` in `server/index.js` resta identica: helmet 8 mantiene la stessa option shape per le direttive usate.
**Verifica empirica:** boot del server raggiunge il `listen` senza errori (helmet caricato e middleware installato); 57/57 test passano.

### ✅ [MEDIUM] CSRF state SSO conservato in-memory (Map)
**Commit:** `0521b6e security: persist SSO CSRF state in SQLite`
**File:** `server/db.js`, `server/routes/auth.js`
**Fix:** rimossa la `Map` `pendingAuthStates` in favore di una tabella `auth_pending_states` (`state` PK, `created_at`). Inserimento + cleanup vecchi >10 min al `/microsoft`, validazione+consumo atomico in DELETE condizionale al `/microsoft/callback` (TTL applicato nella WHERE, una sola roundtrip). Lo state ora sopravvive tra repliche.
**Verifica empirica:** tabella creata correttamente in `frontdoor.db` (`.schema auth_pending_states`), 57/57 test passano, modulo `auth.js` carica senza errori.

### ✅ [HIGH] axios e lodash con CVE attivi
**Commit:** `3dea2ad security: upgrade axios and add isomorphic-dompurify deps`
**File:** `package.json`, `package-lock.json`
**Fix:**
- `axios` aggiornato da `^1.6.7` a `^1.16.0` → risolve 12 advisory (SSRF, prototype pollution, CRLF injection, cloud metadata exfiltration, response tampering)
- `npm audit fix` risolve `lodash` (code injection + prototype pollution), `postcss` (XSS), `follow-redirects` (auth header leak)
- Aggiunte `dompurify@^3.4.3` + `jsdom@^24` per sanitizzazione SVG server-side
- **Vulnerabilità rimanenti:** 2 moderate dev-only (Vite/esbuild path traversal sul dev server) — fix disponibile solo via breaking upgrade a Vite 8, vedi sezione "Aperti"

### ✅ [HIGH] Container Docker eseguito come root
**Commit:** `3826348 security: run Docker container as non-root frontdoor user`
**File:** `Dockerfile`
**Fix:** runtime stage crea utente `frontdoor` (uid/gid 1001) con `useradd`, `chown` su `/app` e `/data`, e `USER frontdoor` prima del `CMD`. Volume `/data` resta scrivibile per SQLite, avatar cache e branding asset dir. CIS Docker Benchmark 4.1 ✓.

### ✅ [HIGH] Stored XSS via upload SVG
**Commit:** `6a95de3 security: sanitize uploaded SVGs and tighten CSP`
**File:** `server/services/svgSanitize.js` (new), `server/services/appIcons.js`, `server/services/branding.js`, `server/services/mediaAssets.js`, `server/index.js`
**Fix combinato (opzioni 2 + 3 + CSP):**
1. **Sanitizzazione DOMPurify** server-side su ogni SVG buffer prima della scrittura. Rimuove `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<use>`, URL `javascript:` e tutti gli handler `on*`. Helper condiviso in `server/services/svgSanitize.js`.
2. **Response CSP scoped + nosniff** quando il file è servito (`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `X-Content-Type-Options: nosniff`). Le icone caricate via `<img>` continuano a renderizzare normalmente; la navigazione diretta non può eseguire script anche se un payload sfugge a DOMPurify.
3. **CSP globale**: rimosso `'unsafe-inline'` da `script-src` (vedi finding correlato qui sotto).

**Verifica empirica:** payload SVG con `<script>alert('xss')</script>`, `onload="..."`, `href="javascript:..."` è stato accettato dall'API e all'upload risultato:
```svg
<svg ...><rect width="100" height="100" fill="red"></rect><a><text x="10" y="50">click</text></a></svg>
```
Tutti i vettori XSS rimossi, geometria preservata.

### ✅ [MEDIUM] CSP con 'unsafe-inline' su script-src
**Commit:** `6a95de3 security: sanitize uploaded SVGs and tighten CSP`
**File:** `server/index.js:91`
**Fix:** rimosso `'unsafe-inline'` da `scriptSrc`. Build Vite produce solo `<script type="module" src="...">` esterni; verificato che nel bundle non ci sono `eval()` o `new Function()`. Lo script inline del flusso SSO POST (`server/routes/apps.js:127`) ha già una CSP scoped che mantiene `'unsafe-inline'` solo su quella response.
**Verifica empirica:** server avviato con la nuova CSP, smoke test su UI completa via dev-login, nessuna violazione `Refused to execute inline script` in DevTools console.

### ✅ [MEDIUM] Errori 500 espongono error.message non sanitizzato
**Commit:** `9e22825 security: do not leak raw error.message in 500 responses`
**File:** `server/services/errors.js` (new), `server/services/branding.js`, `server/services/backup.js`, `server/services/entraGroups.js`, `server/routes/branding.js`, `server/routes/groups.js`, `server/routes/backups.js`
**Fix:**
- Introdotta `class UserFacingError extends Error` con flag `expose=true` e `statusCode` esplicito
- Helper `respondWithError(res, error, fallback)` che forwarda `error.message` solo se è una `UserFacingError`, altrimenti restituisce un messaggio generico
- Convertiti tutti i `throw new Error(...)` di validazione in `throw new UserFacingError(...)` nei servizi branding, backup, entraGroups
- Aggiunto `try/catch` esplicito intorno a `JSON.parse` nel restore backup
- Applicato a 4 endpoint che prima esponevano `error.message` raw

### ✅ [MEDIUM] PII (email utente) in console.log/error
**Commit:** `aa4ddd6 security: remove user email from server logs`
**File:** `server/routes/users.js:57`, `server/scripts/prewarmAvatars.js` (3 occorrenze)
**Fix:** sostituito `user.email` con `user.id` in tutti i log identificati. L'id utente è interno (UUID) e non considerato PII secondo GDPR / data minimization. Lo stack trace operativo è preservato perché l'id è univoco.

### ✅ [MEDIUM] Warning UI per SSO method GET
**Commit:** `b12b29b security: warn admins when selecting GET method for Redirect SSO`
**File:** `src/pages/Admin.jsx`, `src/i18n/en.json`, `src/i18n/it.json`
**Fix:** quando l'admin seleziona `sso_method=GET` nel form di un app Redirect SSO, viene mostrato un banner ambra sotto il select con il testo che spiega i rischi (token leak via Referer, cronologia, access log) e raccomanda POST se l'app destinazione lo supporta. Stringhe i18n in italiano e inglese.

### ✅ [LOW] JWT_SECRET placeholder accettato dallo startup
**Commit:** `946fa45 security: reject placeholder JWT_SECRET at startup`
**File:** `server/config.js`
**Fix:**
- Nuova whitelist `JWT_SECRET_PLACEHOLDERS` con `change-this-in-production`, `your-jwt-secret`, `changeme`, dev fallback
- In produzione (`NODE_ENV=production` && `DEV_LOGIN=false`), se `JWT_SECRET` è uno dei placeholder noti o è < 32 caratteri, lo startup **fallisce** invece di emettere solo warning
- Dev mode (`DEV_LOGIN=true` && `NODE_ENV != production`) continua a tollerare il dev fallback per il lavoro locale

**Verifica empirica:** avviato con `NODE_ENV=production JWT_SECRET=change-this-in-production node server/index.js` → exit con error: `JWT_SECRET is set to a known placeholder value; generate a unique secret before starting the server`.

---

## 🔵 APERTI / DA PIANIFICARE

### [MEDIUM] Endpoint pubblici senza autenticazione

**Stato:** 🔵 Aperto — richiede decisione di design.
**File:** `server/routes/branding.js:10`, `:73`, `server/routes/apps.js:230`
**Descrizione:** `GET /api/branding`, `GET /api/branding/logo`, `GET /api/apps/:id/icon` esposti senza `authenticate`. Per branding/logo è intenzionale (login page). Per le icone app è enumerazione.
**Perché aperto:** `GET /api/branding` espone flag interni come `showEntraAppMode` utili al frontend pre-login. Restringere richiede di separare branding "pubblico" (logo + hero text) da branding "interno" (flag UI). Da affrontare con design dedicato in una iterazione successiva.

---

## ⛔ WON'T FIX / ACCEPTED RISK

Findings consapevolmente non fixati. Documentati qui perché la decisione resti rintracciabile e il prossimo audit non li riapra come novità.

### [MEDIUM] JWT SSO esposto via query string nei redirect GET — ACCEPTED

**File:** `server/routes/apps.js:132-134`
**Descrizione:** Per app `mode=redirect` con `sso_method=GET`, il token JWT short-lived (5 min) viene appeso come `?token=<JWT>` e può finire in access log del target, Referer, history, proxy log.
**Mitigazione in essere:** warning UI per gli admin quando selezionano `sso_method=GET` (commit `b12b29b`).
**Motivazione del won't fix:** il warning UI è ritenuto sufficiente. Forzare POST come default romperebbe i satelliti che supportano solo GET. La scelta resta in mano all'admin con visibilità del rischio.

---

### [LOW] Bulk API key — confronto non-constant-time, nessun rate limit dedicato — ACCEPTED

**File:** `server/routes/apps.js:640-789`
**Descrizione:** `GET/POST /api/apps/bulk` autenticano con header `x-api-key`. Confronto `apiKey !== expected` non è constant-time. Coperti solo dal general rate limiter (6000 req/min).
**Motivazione del won't fix:** `ADMIN_API_KEY` è un secret a entropia alta scelto dall'operatore e usato server-to-server; un timing attack richiederebbe molti tentativi mirati dietro una rete che il general rate limiter già contiene. Costo/beneficio non giustifica il refactor in questo pass.

---

### [LOW] Cookie `frontdoor_token` su domain wildcard — ACCEPTED

**File:** `server/routes/auth.js:228`
**Descrizione:** `domain: .${baseDomain}` condivide il cookie con tutti i subdomain. In caso di subdomain takeover il cookie è esposto.
**Motivazione del won't fix:** il wildcard è **funzionalmente richiesto** dalla modalità shared-cookie SSO, che è un valore di prodotto centrale di FrontDoor. Il rischio si gestisce a livello di hygiene DNS (controllare i subdomain dell'organizzazione), non di codice applicativo.

---

### [LOW] `sameSite: 'lax'` sul cookie di sessione — ACCEPTED

**File:** `server/routes/auth.js:227`
**Descrizione:** `lax` permette di inviare il cookie su navigazioni top-level GET cross-origin. Rischio marginale, l'API muta solo via POST/PUT/DELETE.
**Motivazione del won't fix:** `lax` è **necessario** per il flusso SSO redirect callback (top-level GET dal provider). `strict` lo romperebbe. Il vettore residuo è già contenuto dal fatto che ogni mutation richiede POST/PUT/DELETE.

---

## ℹ️ NOTE INFORMATIVE

### [INFO] CORS — non configurato (corretto per questo deploy)

**File:** `server/index.js`
**Descrizione:** N/A per single-origin deployment. Da configurare con allowlist se in futuro l'API viene esposta a un frontend separato.

---

## SEZIONE 7 — Protezione costi AI/LLM

**N/A.** Il progetto non integra LLM/OpenAI/Whisper. Le uniche chiamate esterne sono verso Microsoft Graph, già protette da rate limit auth.

---

## CHECKLIST POST-REMEDIATION

- [x] Secrets e .env protetti (gitignore corretto, history pulita, **placeholder JWT_SECRET ora bloccato allo startup**)
- [x] CORS — non applicabile, single-origin deployment
- [x] Security headers (Helmet attivo, **CSP senza `'unsafe-inline'`**)
- [x] Rate limiting su tutti gli endpoint (auth, rbac, general, sso-introspection)
- [x] Auth su rotte sensibili (RBAC sistematico)
- [x] Validazione input completa
- [x] **File upload sicuro — SVG sanitizzati con DOMPurify + servizio con sandbox CSP**
- [x] **npm audit pulito sui HIGH** — restano solo 2 moderate dev-only (Vite/esbuild)
- [x] Nessun secret nel frontend
- [x] Nessun XSS/injection nel codice React (1 solo `dangerouslySetInnerHTML`, sanitizzato)
- [x] **Dockerfile hardened — USER non-root**
- [x] .dockerignore completo
- [x] **Logging sicuro — PII rimossa dai log identificati**
- [x] File temporanei puliti (icon cache cleanup endpoint, retention purge daily)
- [x] Rate limiting AI adeguato — N/A
- [x] Spending caps su API AI — N/A
- [x] **(Done)** CSRF state SSO persistente in SQLite — `0521b6e`
- [x] **(Done)** helmet v7 → v8 — `642f10b`
- [x] **(Done)** Vite/esbuild upgrade — `46a6e44`
- [ ] **(Open)** Endpoint pubblici senza auth — design da definire
- [x] **(Won't fix)** SSO method default = GET — coperto da warning UI
- [x] **(Won't fix)** Bulk API key constant-time — accettato
- [x] **(Won't fix)** Cookie domain wildcard — funzionalmente richiesto
- [x] **(Won't fix)** sameSite lax — funzionalmente richiesto

---

## DETTAGLI TECNICI VERIFICATI (POSITIVI)

Elementi che hanno passato l'audit:

- **SQL injection:** tutte le query usano `db.prepare(...).get/run/all(...)` con parametri posizionali
- **SSRF:** `validateTargetUrl` (`server/routes/apps.js:286-299`) blocca esplicitamente private networks (RFC1918, loopback, link-local, 0.0.0.0)
- **CSRF state SSO:** validato e cancellato dopo uso (`server/routes/auth.js:110-113`), TTL 10 min cleanup
- **JWT:** cookie httpOnly + secure + sameSite lax. Token NON in localStorage
- **Rate limiting:** 4 limiter distinti, tutti tunable via env
- **RBAC:** middleware sistematico, 4 ruoli (owner/admin/admin_readonly/user)
- **Audit log:** ogni mutation RBAC logga su `rbac_audit_logs`, retention configurabile
- **DOMPurify lato client:** unico `dangerouslySetInnerHTML` sanitizzato
- **Trust proxy:** `app.set('trust proxy', 1)` per IP reale dietro LB
- **Dotfiles:** `express.static(..., { dotfiles: 'deny' })` blocca `/.git`, `/.env`
- **Body limit:** `express.json({ limit: '5mb' })` configurato
- **Git history:** nessun `.env`, `.pem`, `.key` mai committato
- **🆕 SVG sanitize:** DOMPurify server-side + response CSP sandbox + nosniff (defense in depth)
- **🆕 Docker non-root:** uid/gid 1001 dedicato
- **🆕 Errori 500:** generic message, dettagli solo server-side
- **🆕 PII log:** sostituito con user id
- **🆕 JWT_SECRET startup:** placeholder e secret deboli rifiutati in produzione

---

## TRACCIA COMMIT

Triage 2026-05-13 (direttamente su `main`):
```
46a6e44 security: upgrade Vite 5 → 8 and bump @vitejs/plugin-react to 5
642f10b security: upgrade helmet v7 → v8
0521b6e security: persist SSO CSRF state in SQLite
c7f85ee docs(security): triage open findings into Won't fix / Open / In progress
```

Pass iniziale (branch `worktree-silly-jumping-aurora`):
```
fff7e66 docs: update CHANGELOG with security hardening pass
b12b29b security: warn admins when selecting GET method for Redirect SSO
946fa45 security: reject placeholder JWT_SECRET at startup
aa4ddd6 security: remove user email from server logs
9e22825 security: do not leak raw error.message in 500 responses
3826348 security: run Docker container as non-root frontdoor user
6a95de3 security: sanitize uploaded SVGs and tighten CSP
3dea2ad security: upgrade axios and add isomorphic-dompurify deps
```

---

## NOTE FINALI

- Audit originale basato su analisi statica al commit `4504d55`. Remediation applicata su `worktree-silly-jumping-aurora`, branchato successivamente.
- Verifica empirica delle 3 mitigations principali (SVG sanitize, CSP, JWT placeholder block) eseguita via curl + server live + dev-login.
- I 9 finding ancora aperti sono tutti MEDIUM/LOW/INFO e non bloccano la produzione single-instance corrente. Vanno pianificati in iterazioni successive.
