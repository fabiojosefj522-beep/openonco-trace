// Teste de contrato: exercita o mock (Parte Z) e o SDK num navegador real, grava todas as
// trocas HTTP e entrega a test/validate_contract.py, que confere cada uma contra o OpenAPI.
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(400);

  const capture = await page.evaluate(async () => {
    const B = OOT.server.BASE_URL;
    const exchanges = [];
    const requests = [];
    const call = async (name, method, route, { headers = {}, body } = {}) => {
      const res = await fetch(B + route, { method, headers, body });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* corpo não JSON */ }
      exchanges.push({ name, method: method.toLowerCase(), path: route, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json });
      return json;
    };
    const sample = JSON.parse(document.querySelector('#payload').value);
    const operator = { userId: 'qa.asouza', printedName: 'Ana Souza' };
    const JSONH = { 'Content-Type': 'application/json' };
    const KEY = { 'X-API-Key': 'ENTERPRISE_VALID_KEY' };

    // 1) Requisição REAL montada pelo SDK, capturada antes de chegar ao mock.
    const mockFetch = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).endsWith('/custody/validate')) requests.push({ name: 'sdk.submit', headers: init.headers, body: JSON.parse(init.body) });
      return mockFetch(input, init);
    };
    OOT.sdk.setApiKey('ENTERPRISE_VALID_KEY');
    await OOT.sdk.submit(OOT.sdk.getRecord(sample.sampleId) ? sample.sampleId : sample);
    OOT.sdk.setApiKey(null);
    await OOT.sdk.submit(sample);
    window.fetch = mockFetch;

    // 2) Respostas de cada rota e status documentados.
    const reqBody = JSON.stringify({ sample, context: { operator, sourceSystem: 'CONTRACT_TEST', signatureMeaning: 'REVIEW_APPROVAL' } });
    await call('402 sem chave', 'POST', '/custody/validate', { headers: JSONH, body: reqBody });
    await call('402 chave inválida', 'POST', '/custody/validate', { headers: { ...JSONH, 'X-API-Key': 'TRIAL-2026-XYZ' }, body: reqBody });
    const idem = crypto.randomUUID ? crypto.randomUUID() : '7b0e5d0e-3f1a-4c2b-9d7e-2a6f1c0b9e11';
    await call('200 enterprise', 'POST', '/custody/validate', { headers: { ...JSONH, ...KEY, 'Idempotency-Key': idem }, body: reqBody });
    await call('200 reenvio idempotente', 'POST', '/custody/validate', { headers: { ...JSONH, ...KEY, 'Idempotency-Key': idem }, body: reqBody });
    await call('422 schema', 'POST', '/custody/validate', { headers: JSONH, body: JSON.stringify({ sample: { ...sample, patientId: 'Maria' } }) });
    await call('422 signatário', 'POST', '/custody/validate', { headers: { ...JSONH, ...KEY }, body: JSON.stringify({ sample }) });
    await call('400 json', 'POST', '/custody/validate', { headers: JSONH, body: '{nope' });
    await call('200 jwks', 'GET', '/.well-known/jwks.json');
    await call('200 ledger', 'GET', '/audit/ledger', { headers: KEY });
    await call('402 ledger', 'GET', '/audit/ledger');
    // 429: esgota a cota sandbox (100) em paralelo e faz mais uma chamada.
    await Promise.all(Array.from({ length: 100 }, () => fetch(B + '/custody/validate', { method: 'POST', headers: JSONH, body: reqBody })));
    await call('429 cota', 'POST', '/custody/validate', { headers: JSONH, body: reqBody });

    return { exchanges, requests };
  });
  await browser.close();

  const out = path.join(os.tmpdir(), 'oot-contract-capture.json');
  fs.writeFileSync(out, JSON.stringify(capture, null, 2));
  console.log(`Capturadas ${capture.exchanges.length} respostas e ${capture.requests.length} requisições do SDK.`);
  if (pageErrors.length) { console.error('Exceções na página:', pageErrors); process.exit(1); }

  const py = spawnSync('python3', [path.join(__dirname, 'validate_contract.py'), out], { stdio: 'inherit' });
  process.exit(py.status === null ? 2 : py.status);
})().catch((err) => { console.error(err); process.exit(2); });
