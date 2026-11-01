// Abre a página por HTTP num IP que não é localhost: contexto NÃO seguro, sem crypto.subtle.
// Confere o fallback de SHA-256 em JS puro e a degradação elegante da assinatura.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const ip = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal).address;
// Servidor estático mínimo: entrega index.html e os scripts dos pacotes.
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8765, '0.0.0.0');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://${ip}:8765/index.html`);
  await page.waitForTimeout(500);
  const ctx = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: !!(window.crypto && window.crypto.subtle) }));
  console.log('contexto:', JSON.stringify(ctx));
  await page.click('.seg button[data-key="ENTERPRISE_VALID_KEY"]');
  await page.evaluate(() => document.querySelector('#badge').shadowRoot.querySelector('[data-ref="btn"]').click());
  await page.waitForFunction(() => /HTTP 200/.test(document.querySelector('#httpLine').textContent), null, { timeout: 8000 });
  const resp = await page.evaluate(() => JSON.parse(document.querySelector('#responseView pre').textContent));
  console.log('hash:', resp.integrity.payloadHash, '| assinatura:', resp.signature.algorithm);
  await page.click('#btnVerify');
  await page.waitForFunction(() => ['valid', 'invalid'].includes(document.querySelector('#verifyOut').dataset.state), null, { timeout: 5000 });
  const verify = await page.$eval('#verifyOut', (el) => el.textContent.replace(/\s+/g, ' '));
  const seal = await page.evaluate(() => document.querySelector('#badge').shadowRoot.querySelector('[data-ref="seal"]').textContent.replace(/\s+/g, ' '));
  console.log('verificação:', verify.slice(0, 260));
  console.log('selo no badge:', seal.slice(0, 120));
  const ok = !ctx.subtle && /^[0-9a-f]{64}$/.test(resp.integrity.payloadHash) && resp.signature.algorithm === 'NONE' && /Integridade confirmada/.test(verify) && /não conferida neste contexto/.test(seal) && errors.length === 0;
  console.log(ok ? 'PASS fallback em contexto não seguro' : 'FAIL fallback', errors.join(' | '));
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); server.close(); process.exit(2); });
