// Testa as saídas publicáveis: ESM e CommonJS no Node, import do badge em SSR (sem DOM)
// e o badge como ES module num navegador real, resolvendo @openonco/sdk por import map.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const check = (name, cond, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`); };

// npm install (workspaces) cria este link; garante o mesmo localmente.
const link = path.join(ROOT, 'node_modules', '@openonco', 'sdk');
if (!fs.existsSync(link)) { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(path.join(ROOT, 'packages', 'sdk'), link, 'dir'); }

const sample = {
  schemaVersion: '1.0.0', sampleId: 'SMP-2026-PKG001', patientId: 'PT-BR-000123',
  therapyOrder: { orderId: 'ORD-PKG00001', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-000123' },
  biopsyType: 'LEUKAPHERESIS_FRESH',
  sensorTemp: { sensorId: 'LOG-PKG-0001', currentC: 4.5, minObservedC: 4, maxObservedC: 5, excursionMinutes: 0, recordedAt: new Date().toISOString() },
  qualityControl: { cellViabilityPct: 90 },
  chainOfCustody: [{ step: 'COLLECTION', timestamp: new Date(Date.now() - 3600e3).toISOString(), actor: 'enf.teste', location: 'Centro de teste' }]
};

(async () => {
  // 1) CommonJS
  const cjs = require(path.join(ROOT, 'packages/sdk/dist/index.cjs'));
  const sdk = new cjs.OpenOncoSDK();
  check('CJS: OpenOncoSDK + avaliação local verde', sdk.track(sample).evaluation.status === 'VERIFIED');
  const canon = cjs.Integrity.canonicalize(sample);
  check('CJS: SHA-256 (Web Crypto do Node) confere com node:crypto', (await cjs.Integrity.sha256Hex(canon)) === crypto.createHash('sha256').update(canon).digest('hex'));
  check('CJS: não cria globais', typeof globalThis.OpenOncoSDK === 'undefined' && typeof globalThis.OpenOnco === 'undefined');

  // 2) ESM e SSR (processo separado, como um app Node/Next.js faria)
  const esmOut = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import SDK, { OpenOncoSDK, Rules, SAMPLE_SCHEMA } from '@openonco/sdk';
    import Badge, { OncoBadge } from '${path.join(ROOT, 'packages/badge/dist/index.mjs').replace(/\\/g, '/')}';
    const s = ${JSON.stringify(sample)};
    console.log(JSON.stringify({ same: SDK === OpenOncoSDK, status: Rules.assess(s).status, title: SAMPLE_SCHEMA.title, badge: typeof OncoBadge, def: typeof Badge }));
  `], { cwd: ROOT, encoding: 'utf8' });
  const esm = JSON.parse(esmOut.trim());
  check('ESM: import default + nomeados do @openonco/sdk', esm.same && esm.status === 'VERIFIED' && esm.title === 'OpenOncoSample', esmOut.trim());
  check('ESM/SSR: badge importa sem DOM e não quebra (OncoBadge indefinido)', esm.badge === 'undefined' && esm.def === 'undefined');

  // 3) Navegador: badge como ES module com import map
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x').pathname;
    if (url === '/esm.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><script type="importmap">{"imports":{"@openonco/sdk":"/packages/sdk/dist/index.mjs"}}</script>
        <onco-badge id="b"></onco-badge>
        <script type="module">
          import { OpenOncoSDK } from '@openonco/sdk';
          import { OncoBadge } from '/packages/badge/dist/index.mjs';
          const sdk = new OpenOncoSDK();
          const rec = sdk.track(${JSON.stringify(sample)});
          const b = document.getElementById('b'); b.sdk = sdk; b.sampleId = rec.sampleId;
          window.__ok = { defined: customElements.get('onco-badge') === OncoBadge, globals: typeof window.OpenOncoSDK };
        </script>`);
      return;
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.mjs') || file.endsWith('.js') ? 'text/javascript' : 'text/plain' });
    res.end(fs.readFileSync(file));
  }).listen(8790);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8790/esm.html');
  await page.waitForFunction(() => window.__ok, null, { timeout: 5000 });
  const res = await page.evaluate(() => ({ ...window.__ok, status: document.getElementById('b').shadowRoot.querySelector('.card').dataset.status }));
  check('Navegador: badge ESM registra <onco-badge> e renderiza', res.defined && res.status === 'VERIFIED', JSON.stringify(res));
  check('Navegador: ESM não cria globais', res.globals === 'undefined');
  check('Navegador: zero exceções', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();

  console.log(failed ? `\n${failed} falha(s) nos pacotes` : '\nPacotes OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
