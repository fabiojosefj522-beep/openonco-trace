// Teste ponta a ponta do index.html em Chromium headless (Playwright).
const { chromium } = require('playwright');
const path = require('path');

// Por padrão testa index.html (scripts separados); passe "standalone" para testar o build em arquivo único.
const TARGET = process.argv[2] === 'standalone' ? ['dist', 'openonco-trace-standalone.html'] : ['index.html'];
const FILE = 'file://' + path.resolve(__dirname, '..', ...TARGET);
console.log('Testando', FILE);
const results = [];
const check = (name, cond, extra = '') => { results.push({ name, ok: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  | ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(FILE);
  await page.waitForTimeout(600);

  // Helpers que leem o Shadow DOM do badge principal
  const badgeState = (sel = '#badge') => page.evaluate((s) => {
    const host = document.querySelector(s);
    const root = host.shadowRoot;
    const q = (x) => root.querySelector(x);
    return {
      status: q('.card').dataset.status,
      mode: q('.card').dataset.mode,
      thermal: q('.card').dataset.thermal,
      title: q('[data-ref="title"]').textContent,
      cTitle: q('[data-ref="cTitle"]').textContent,
      sub: q('[data-ref="sub"]').textContent,
      chip: q('[data-ref="chip"]').textContent,
      patient: q('[data-ref="patient"]').textContent,
      temp: q('[data-ref="temp"]').textContent,
      sealKind: q('[data-ref="seal"]').dataset.kind,
      sealText: q('[data-ref="seal"]').textContent.replace(/\s+/g, ' ').trim(),
      tapeVisible: getComputedStyle(q('.tape')).display !== 'none',
      findings: Array.from(root.querySelectorAll('.findings li')).map((li) => li.textContent),
      live: q('[data-ref="liveTxt"]').textContent,
      btnDisabled: q('[data-ref="btn"]').disabled,
      timeline: Array.from(root.querySelectorAll('.timeline li .s')).map((x) => x.textContent)
    };
  }, sel);
  const clickValidate = () => page.evaluate(() => document.querySelector('#badge').shadowRoot.querySelector('[data-ref="btn"]').click());
  const waitNotPending = async () => {
    await page.waitForFunction(() => document.querySelector('#badge').shadowRoot.querySelector('.card').dataset.status !== 'PENDING', null, { timeout: 8000 });
    await page.waitForTimeout(150);
  };
  const httpLine = () => page.$eval('#httpLine', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  const responseText = () => page.$eval('#responseView', (el) => el.textContent);

  // 0) Estado inicial
  let s = await badgeState();
  check('Inicial: VERIFIED verde (pré-validação local)', s.status === 'VERIFIED' && /verificada/i.test(s.title), `${s.status} / ${s.title} / ${s.sub}`);
  check('Inicial: modo SANDBOX com fita de risco', s.mode === 'SANDBOX' && s.tapeVisible && s.chip === 'Sandbox');
  check('Inicial: timeline com 4 eventos + destino', s.timeline.length === 5 && s.timeline[4] === 'Destino', s.timeline.join(','));
  await page.waitForTimeout(2300);
  s = await badgeState();
  check('Telemetria ao vivo ativa', s.live === 'ao vivo', s.live);
  const mini0 = await badgeState('#badgeMini');
  check('Badge compacto espelha o mesmo registro', mini0.status === 'VERIFIED' && mini0.cTitle.length > 0, mini0.cTitle);

  // 1) Sem chave → 402 sandbox
  await clickValidate();
  await page.waitForTimeout(50);
  const pendingState = await badgeState();
  check('Durante o envio: estado PENDING e botão desabilitado', pendingState.status === 'PENDING' && pendingState.btnDisabled, pendingState.title);
  await waitNotPending();
  s = await badgeState();
  let line = await httpLine();
  check('Sem chave: HTTP 402', /HTTP 402 Payment Required/.test(line), line.slice(0, 120));
  check('Sem chave: selo indisponível + aviso sandbox', s.sealKind === 'sandbox' && /MODO SANDBOX \(SEM VALIDADE REGULATÓRIA\)/.test(s.sealText), s.sealText.slice(0, 140));
  check('Sem chave: resposta com OOT-402-COMMERCIAL_USE_LIMITATION e MISSING_API_KEY', /OOT-402-COMMERCIAL_USE_LIMITATION/.test(await responseText()) && /MISSING_API_KEY/.test(await responseText()));
  check('Console: aviso de sandbox emitido pelo SDK', consoleMsgs.some((m) => m.type === 'warning' && /MODO SANDBOX/.test(m.text)));

  // 2) Chave inválida → 402 INVALID_API_KEY
  await page.click('.seg button[data-key="TRIAL-2026-XYZ"]');
  s = await badgeState();
  check('Chave inválida definida: chip "Chave não verificada", sem fita', s.mode === 'PENDING' && !s.tapeVisible, s.chip);
  await clickValidate();
  await waitNotPending();
  s = await badgeState();
  check('Chave inválida: HTTP 402 com INVALID_API_KEY', /INVALID_API_KEY/.test(await responseText()) && /HTTP 402/.test(await httpLine()));
  check('Chave inválida: volta a SANDBOX com fita', s.mode === 'SANDBOX' && s.tapeVisible);
  const modeLine = await page.$eval('#modeLine', (el) => el.textContent);
  check('Linha de modo explica a recusa', /recusada/.test(modeLine), modeLine);

  // 3) Chave Enterprise → 200 + SHA-256 + selo + assinatura conferida
  await page.click('.seg button[data-key="ENTERPRISE_VALID_KEY"]');
  await clickValidate();
  await waitNotPending();
  s = await badgeState();
  line = await httpLine();
  const resp = await page.evaluate(() => JSON.parse(document.querySelector('#responseView pre').textContent));
  check('Enterprise: HTTP 200', /HTTP 200 OK/.test(line), line.slice(0, 120));
  check('Enterprise: SHA-256 de 64 hex', /^[0-9a-f]{64}$/.test(resp.integrity.payloadHash), resp.integrity.payloadHash);
  check('Enterprise: selo com 21 CFR Part 11 e Anvisa', resp.complianceSeal.frameworks.some((f) => /21 CFR Part 11/.test(f.ref)) && resp.complianceSeal.frameworks.some((f) => /Anvisa/.test(f.ref)));
  check('Enterprise: assinatura ES256 presente', resp.signature.algorithm === 'ES256' && resp.signature.value.length > 40);
  check('Enterprise: badge mostra selo + assinatura conferida', s.sealKind === 'enterprise' && /conferida pelo SDK/.test(s.sealText) && /OOT-SEAL-/.test(s.sealText), s.sealText.slice(0, 160));
  check('Enterprise: chip Enterprise, sem fita', s.mode === 'ENTERPRISE' && !s.tapeVisible && s.chip === 'Enterprise');
  check('Enterprise: subtítulo "Registro selado"', /selado/i.test(s.sub), s.sub);
  const note = await page.$eval('#editorNote', (el) => el.textContent);
  check('Editor sincronizado com o payload selado', /exatamente como foi selado/.test(note));

  // 4) Verificar integridade → ok; adulterar → falha
  await page.click('#btnVerify');
  await page.waitForFunction(() => document.querySelector('#verifyOut').dataset.state === 'valid' || document.querySelector('#verifyOut').dataset.state === 'invalid', null, { timeout: 5000 });
  let vtext = await page.$eval('#verifyOut', (el) => el.textContent);
  check('Verificação: integridade confirmada', /Integridade confirmada/.test(vtext), vtext.slice(0, 80));
  check('Verificação: 3 checagens ok', (await page.$$eval('#verifyOut .vm-ok', (els) => els.length)) === 3);
  await page.evaluate(() => { const ed = document.querySelector('#payload'); ed.value = ed.value.replace('"cellViabilityPct": 94.2', '"cellViabilityPct": 94.3'); });
  await page.click('#btnVerify');
  await page.waitForFunction(() => document.querySelector('#verifyOut').dataset.state === 'invalid', null, { timeout: 5000 });
  vtext = await page.$eval('#verifyOut', (el) => el.textContent);
  check('Adulteração detectada após editar o JSON', /Adulteração detectada/.test(vtext) && /esperado/.test(vtext), vtext.slice(0, 100));
  check('Assinatura continua válida (o selo é autêntico; o payload é que mudou)', (await page.$$eval('#verifyOut .vm-ok', (els) => els.length)) === 2);

  // 5) Excursão térmica ao vivo: verde → amarelo → vermelho
  const seen = new Set();
  await page.click('#btnExcursion');
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const st = await badgeState();
    seen.add(st.status);
    if (st.status === 'CRITICAL') break;
    await page.waitForTimeout(300);
  }
  s = await badgeState();
  check('Excursão: passou por WARNING', seen.has('WARNING'), [...seen].join(','));
  check('Excursão: terminou CRITICAL (viabilidade)', s.status === 'CRITICAL' && /viabilidade/i.test(s.title), `${s.title} / ${s.temp} °C`);
  check('Excursão: badge avisa divergência com o registro selado', /difere do último resultado do servidor/.test(s.sealText));
  check('Excursão: temperatura em vermelho', s.thermal === 'red', s.thermal);
  await page.click('#btnNormalize');
  await page.waitForTimeout(3000);
  s = await badgeState();
  check('Normalizar não "desfaz" a excursão crítica registrada', s.status === 'CRITICAL', `${s.temp} °C`);
  await clickValidate();
  await waitNotPending();
  const resp2 = await page.evaluate(() => JSON.parse(document.querySelector('#responseView pre').textContent));
  check('Validação pós-excursão: selo com decisão de rejeição e trilha #2 encadeada', resp2.complianceSeal.disposition === 'REJECT_DO_NOT_PROCESS' && resp2.complianceSeal.auditTrail.sequence === 2 && resp2.complianceSeal.auditTrail.previousHash === resp.complianceSeal.auditTrail.chainHash);

  // 6) Cenários
  const pick = async (key) => { await page.click(`.scenario[data-key="${key}"]`); await page.waitForTimeout(250); return badgeState(); };
  s = await pick('cart-thermal');
  check('Cenário excursão leve: amarelo "Atenção térmica"', s.status === 'WARNING' && /térmica/i.test(s.title), s.sub);
  s = await pick('cart-coi');
  check('Cenário COI: vermelho "Erro de paciente"', s.status === 'CRITICAL' && /paciente/i.test(s.title), s.sub);
  await clickValidate();
  await waitNotPending();
  s = await badgeState();
  check('COI com Enterprise: selo registra rejeição', s.sealKind === 'enterprise' && /Rejeitada/.test(s.sealText));
  s = await pick('mrna-ok');
  check('Cenário mRNA congelada: verde', s.status === 'VERIFIED', `${s.temp} °C`);
  s = await pick('mrna-lowtumor');
  check('Cenário FFPE baixa celularidade: vermelho "Viabilidade"', s.status === 'CRITICAL' && /viabilidade/i.test(s.title), s.sub);
  check('Cenário FFPE: timeline termina em Sequenciamento (recebida)', s.timeline[s.timeline.length - 1] === 'Sequenciamento', s.timeline.join(','));
  s = await pick('schema-bad');
  check('Cenário malformado: "Payload inválido" com 4 violações', s.status === 'CRITICAL' && /inválido/i.test(s.title) && s.findings.length === 4, s.findings.join(' || ').slice(0, 300));
  check('Malformado: nome do paciente NÃO aparece no badge (LGPD)', !/Maria/.test(JSON.stringify(s)), s.patient);
  check('Malformado: dica de vírgula decimal', s.findings.some((f) => /ponto como separador decimal/.test(f)));
  check('Malformado: telemetria desabilitada', await page.$eval('#btnExcursion', (b) => b.disabled));
  await clickValidate();
  await page.waitForTimeout(400);
  line = await httpLine();
  check('Malformado: envio bloqueado no cliente (sem HTTP)', /Bloqueado no cliente/.test(line), line.slice(0, 100));

  // 7) Editor: JSON quebrado mostra erro claro
  await page.fill('#payload', '{ "sampleId": ');
  await page.click('#btnLoadJson');
  const perr = await page.$eval('#parseError', (el) => (el.hidden ? '' : el.textContent));
  check('Editor: JSON inválido gera mensagem de erro', /JSON inválido/.test(perr), perr);

  // 8) Contrato direto via fetch (rotas extras do servidor simulado)
  const api = await page.evaluate(async () => {
    const B = OOT.server.BASE_URL;
    const r422 = await fetch(B + '/custody/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sample: { foo: 1 } }) });
    const r400 = await fetch(B + '/custody/validate', { method: 'POST', body: '{nope' });
    const r404 = await fetch(B + '/nao-existe');
    const led402 = await fetch(B + '/audit/ledger');
    const led200 = await fetch(B + '/audit/ledger', { headers: { 'X-API-Key': 'ENTERPRISE_VALID_KEY' } });
    const ledger = await led200.json();
    const jwks = await (await fetch(B + '/.well-known/jwks.json')).json();
    return { s422: r422.status, s400: r400.status, s404: r404.status, l402: led402.status, l200: led200.status, entries: ledger.entries.length, kid: jwks.keys[0] && jwks.keys[0].kid };
  });
  check('API: 422 / 400 / 404 / ledger 402 sem chave / ledger 200 com chave', api.s422 === 422 && api.s400 === 400 && api.s404 === 404 && api.l402 === 402 && api.l200 === 200, JSON.stringify(api));
  check('API: ledger tem os 3 selos emitidos e JWKS publica a chave', api.entries === 3 && api.kid === 'oot-hsm-2026-11', JSON.stringify(api));

  // 9) Uso declarativo do componente (JSON inline, sandbox)
  const decl = await page.evaluate(async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<onco-badge id="decl"><script type="application/json">' + JSON.stringify({ schemaVersion: '1.0.0', sampleId: 'SMP-2026-QQ1234', patientId: 'PT-BR-000001', therapyOrder: { orderId: 'ORD-AAAA1111', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-000001' }, biopsyType: 'LEUKAPHERESIS_CRYO', sensorTemp: { sensorId: 'LOG-LN2-0001', currentC: -172, minObservedC: -180, maxObservedC: -165, excursionMinutes: 0, recordedAt: new Date().toISOString() }, qualityControl: { cellViabilityPct: 88 }, chainOfCustody: [{ step: 'COLLECTION', timestamp: new Date(Date.now() - 3600e3).toISOString(), actor: 'enf.x', location: 'Centro X' }] }) + '<\/script></onco-badge>';
    document.body.appendChild(wrap);
    await new Promise((r) => setTimeout(r, 100));
    const root = document.querySelector('#decl').shadowRoot;
    return { status: root.querySelector('.card').dataset.status, title: root.querySelector('[data-ref="title"]').textContent, temp: root.querySelector('[data-ref="temp"]').textContent };
  });
  check('Uso declarativo (JSON inline) renderiza e avalia', decl.status === 'VERIFIED', JSON.stringify(decl));
  await page.evaluate(() => document.querySelector('#decl').parentElement.remove());

  // 10) Erros de console / página
  const errs = consoleMsgs.filter((m) => m.type === 'error');
  check('Zero erros de console', errs.length === 0, errs.map((e) => e.text).join(' | '));
  check('Zero exceções na página', pageErrors.length === 0, pageErrors.join(' | '));

  // Screenshots
  await page.click('.scenario[data-key="cart-ok"]');
  await page.click('.seg button[data-key=""]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.resolve(__dirname, 'shot-desktop.png'), fullPage: true });
  await clickValidate(); await waitNotPending();
  await page.screenshot({ path: path.resolve(__dirname, 'shot-desktop-sandbox.png'), clip: { x: 340, y: 0, width: 700, height: 1000 } });
  await page.click('.seg button[data-key="ENTERPRISE_VALID_KEY"]');
  await clickValidate(); await waitNotPending();
  await page.waitForTimeout(500);
  const stage = await page.$('#blk-stage');
  await stage.screenshot({ path: path.resolve(__dirname, 'shot-stage-enterprise.png') });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mobile.goto(FILE);
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: path.resolve(__dirname, 'shot-mobile.png'), fullPage: true });
  const tablet = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await tablet.goto(FILE);
  await tablet.waitForTimeout(1500);
  await tablet.screenshot({ path: path.resolve(__dirname, 'shot-tablet.png'), fullPage: true });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checagens passaram`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
