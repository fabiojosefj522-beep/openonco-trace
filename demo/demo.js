/* =============================================================================
 * HARNESS DA DEMONSTRAÇÃO (não faz parte do produto)
 * Faz o papel do sistema hospedeiro: cria o SDK, liga os badges, gera cenários,
 * simula o data logger e mostra resposta HTTP, eventos e verificação.
 * ===========================================================================*/
(function () {
  'use strict';
  const { THERMAL_PROFILES, SAMPLE_SCHEMA, STATUS_LABEL } = window.OpenOnco;
  const server = window.OpenOncoMockServer;
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const shortHash = (h) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 12)}…${h.slice(-10)}` : String(h));

  /* 1) O host cria o SDK. Operador fictício; em produção vem da sessão do SAP/Veeva/WMS. */
  const sdk = new OpenOncoSDK({
    endpoint: server.BASE_URL,
    operator: { userId: 'qa.asouza', printedName: 'Ana Souza' },
    sourceSystem: 'DEMO_WEB'
  });
  window.OOT = { sdk, server, OpenOnco: window.OpenOnco }; // para experimentar no console

  const badge = $('#badge');
  const mini = $('#badgeMini');
  badge.sdk = sdk;
  mini.sdk = sdk;

  /* 2) Cenários. Os horários são relativos ao carregamento da página. */
  const H = 3600e3;
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  const custody = (steps) => steps.map(([step, hoursAgo, actor, location]) => ({ step, timestamp: ago(hoursAgo * H), actor, location }));
  const SP = 'Centro de aférese, hospital parceiro SP-01';
  const SCENARIOS = [
    {
      key: 'cart-ok', expect: 'ok', title: 'CAR-T, leucaférese fresca', hint: 'Tudo dentro do protocolo. Esperado: verde.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-A7F3K9', patientId: 'PT-BR-004217',
        therapyOrder: { orderId: 'ORD-CT8X41QZ', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-004217' },
        biopsyType: 'LEUKAPHERESIS_FRESH',
        sensorTemp: { sensorId: 'LOG-TT4-88213', currentC: 4.6, minObservedC: 3.8, maxObservedC: 5.9, excursionMinutes: 0, recordedAt: ago(20e3) },
        qualityControl: { cellViabilityPct: 94.2 },
        chainOfCustody: custody([
          ['COLLECTION', 18.7, 'enf.aferese.rlima', SP],
          ['PACKAGING', 18.1, 'qa.site.mcosta', SP],
          ['COURIER_PICKUP', 17.4, 'courier.biolog.077', 'Doca 3, hospital parceiro SP-01'],
          ['IN_TRANSIT', 6.2, 'courier.biolog.077', 'Hub logístico GRU, Guarulhos/SP']
        ])
      })
    },
    {
      key: 'cart-thermal', expect: 'warn', title: 'CAR-T, excursão térmica leve', hint: 'Pico de 8,9 °C por 12 min. Esperado: amarelo.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-B2Q8M4', patientId: 'PT-BR-006142',
        therapyOrder: { orderId: 'ORD-CT2M77KD', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-006142' },
        biopsyType: 'LEUKAPHERESIS_FRESH',
        sensorTemp: { sensorId: 'LOG-TT4-90377', currentC: 6.8, minObservedC: 4.1, maxObservedC: 8.9, excursionMinutes: 12, recordedAt: ago(15e3) },
        qualityControl: { cellViabilityPct: 91.5 },
        chainOfCustody: custody([
          ['COLLECTION', 22.4, 'enf.aferese.tsilva', SP],
          ['PACKAGING', 21.8, 'qa.site.mcosta', SP],
          ['COURIER_PICKUP', 21.0, 'courier.biolog.031', 'Doca 3, hospital parceiro SP-01'],
          ['IN_TRANSIT', 9.5, 'courier.biolog.031', 'Hub logístico VCP, Campinas/SP']
        ])
      })
    },
    {
      key: 'cart-coi', expect: 'crit', title: 'CAR-T, paciente divergente', hint: 'Etiqueta 5308, ordem 5380 (dígitos trocados). Esperado: vermelho.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-C5N1R7', patientId: 'PT-BR-005308',
        therapyOrder: { orderId: 'ORD-CT9P05LX', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-005380' },
        biopsyType: 'LEUKAPHERESIS_FRESH',
        sensorTemp: { sensorId: 'LOG-TT4-77120', currentC: 4.4, minObservedC: 3.9, maxObservedC: 5.2, excursionMinutes: 0, recordedAt: ago(10e3) },
        qualityControl: { cellViabilityPct: 92.8 },
        chainOfCustody: custody([
          ['COLLECTION', 15.2, 'enf.aferese.rlima', SP],
          ['PACKAGING', 14.6, 'qa.site.mcosta', SP],
          ['COURIER_PICKUP', 13.9, 'courier.biolog.077', 'Doca 3, hospital parceiro SP-01'],
          ['IN_TRANSIT', 4.1, 'courier.biolog.077', 'Hub logístico GRU, Guarulhos/SP']
        ])
      })
    },
    {
      key: 'mrna-ok', expect: 'ok', title: 'mRNA, biópsia congelada', hint: 'Gelo seco a −78 °C. Esperado: verde.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-D8V3T2', patientId: 'PT-BR-011593',
        therapyOrder: { orderId: 'ORD-MV4K19TE', therapyType: 'MRNA_NEOANTIGEN_VACCINE', patientId: 'PT-BR-011593' },
        biopsyType: 'TUMOR_FRESH_FROZEN',
        sensorTemp: { sensorId: 'LOG-DI-20931', currentC: -78.4, minObservedC: -81.2, maxObservedC: -74.9, excursionMinutes: 0, recordedAt: ago(25e3) },
        qualityControl: { tumorContentPct: 45 },
        chainOfCustody: custody([
          ['COLLECTION', 9.3, 'cirurgia.onco.pfreitas', 'Centro cirúrgico, hospital parceiro RJ-03'],
          ['PACKAGING', 8.9, 'patologia.lsouza', 'Patologia, hospital parceiro RJ-03'],
          ['COURIER_PICKUP', 8.1, 'courier.biolog.114', 'Doca 1, hospital parceiro RJ-03'],
          ['IN_TRANSIT', 2.6, 'courier.biolog.114', 'Hub logístico GIG, Rio de Janeiro/RJ']
        ])
      })
    },
    {
      key: 'mrna-lowtumor', expect: 'crit', title: 'mRNA, biópsia FFPE', hint: 'Conteúdo tumoral de 12% (mínimo 20%). Esperado: vermelho.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-E1H6W9', patientId: 'PT-BR-012876',
        therapyOrder: { orderId: 'ORD-MV7J33RA', therapyType: 'MRNA_NEOANTIGEN_VACCINE', patientId: 'PT-BR-012876' },
        biopsyType: 'TUMOR_FFPE',
        sensorTemp: { sensorId: 'LOG-AMB-55102', currentC: 21.3, minObservedC: 19.8, maxObservedC: 23.1, excursionMinutes: 0, recordedAt: ago(30e3) },
        qualityControl: { tumorContentPct: 12 },
        chainOfCustody: custody([
          ['COLLECTION', 70, 'cirurgia.onco.mramos', 'Centro cirúrgico, hospital parceiro MG-02'],
          ['PACKAGING', 46, 'patologia.jnunes', 'Patologia, hospital parceiro MG-02'],
          ['COURIER_PICKUP', 44, 'courier.biolog.052', 'Doca 2, hospital parceiro MG-02'],
          ['IN_TRANSIT', 30, 'courier.biolog.052', 'Hub logístico CNF, Confins/MG'],
          ['RECEIVED_AT_SEQUENCING_LAB', 3, 'lab.seq.akato', 'Laboratório de sequenciamento, Campinas/SP']
        ])
      })
    },
    {
      key: 'schema-bad', expect: 'crit', title: 'Payload malformado', hint: 'Nome no lugar do pseudônimo, CPF e vírgula decimal. Esperado: bloqueio no cliente.',
      build: () => ({
        schemaVersion: '1.0.0', sampleId: 'SMP-2026-Z9X0Q1', patientId: 'Maria S. Oliveira', cpf: '000.000.000-00',
        therapyOrder: { orderId: 'ORD-CT1A2B3C', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-007731' },
        biopsyType: 'LEUKAPHERESIS_FRESH',
        sensorTemp: { sensorId: 'LOG-TT4-31001', currentC: '4,6', minObservedC: 3.9, maxObservedC: 5.0, excursionMinutes: 0, recordedAt: ago(30e3) },
        qualityControl: { cellViabilityPct: 93 },
        chainOfCustody: [{ step: 'COLLECTION', timestamp: '01/11/2026 08:15', actor: 'enf.aferese.rlima', location: SP }]
      })
    }
  ];

  /* 3) Data logger simulado. Em produção, a fonte seria SSE/WebSocket/MQTT do IoT logger. */
  function createSimulatedLogger(initial, profile, intervalMs = 1000) {
    const s = { ...initial };
    const baseline = initial.currentC;
    const span = profile.maxC - profile.minC;
    const noise = span * 0.012;
    let target = baseline;
    let slew = Math.max(span * 0.05, 0.1);
    const round2 = (n) => Math.round(n * 100) / 100;
    const source = (emit) => {
      let last = Date.now();
      const timer = setInterval(() => {
        const now = Date.now();
        const dtMin = (now - last) / 60000;
        last = now;
        const step = Math.max(-slew, Math.min(slew, target - s.currentC));
        s.currentC = round2(s.currentC + step + (Math.random() - 0.5) * noise);
        s.minObservedC = Math.min(s.minObservedC, s.currentC);
        s.maxObservedC = Math.max(s.maxObservedC, s.currentC);
        if (s.currentC < profile.minC || s.currentC > profile.maxC) s.excursionMinutes = round2(s.excursionMinutes + dtMin);
        s.recordedAt = new Date(now).toISOString();
        emit({ ...s });
      }, intervalMs);
      return () => clearInterval(timer);
    };
    // Rampa até além da margem crítica (verde, amarelo, vermelho) em cerca de 12 leituras.
    source.injectExcursion = () => { target = profile.maxC + profile.criticalDeltaC * 1.4; slew = Math.max(span * 0.05, Math.abs(target - s.currentC) / 12); };
    source.normalize = () => { target = baseline; slew = Math.max(span * 0.05, Math.abs(target - s.currentC) / 8); };
    return source;
  }

  let currentId = null;
  let logger = null;
  let paused = false;
  let lastReceipt = null;
  const btnExcursion = $('#btnExcursion');
  const btnNormalize = $('#btnNormalize');
  const btnPause = $('#btnPause');

  function startTelemetry() { if (currentId && logger && !paused) sdk.connectTelemetry(currentId, logger); }
  function stopTelemetry() {
    const rec = currentId && sdk.getRecord(currentId);
    if (rec && rec.stopTelemetry) rec.stopTelemetry();
  }
  function setTelemetryControls(enabled) { [btnExcursion, btnNormalize, btnPause].forEach((b) => { b.disabled = !enabled; }); }

  btnExcursion.addEventListener('click', () => { if (logger) logger.injectExcursion(); });
  btnNormalize.addEventListener('click', () => { if (logger) logger.normalize(); });
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.setAttribute('aria-pressed', String(paused));
    btnPause.textContent = paused ? 'Retomar telemetria' : 'Pausar telemetria';
    if (paused) stopTelemetry(); else startTelemetry();
  });

  /* 4) Carregar uma amostra: SDK rastreia, os dois badges se vinculam, a telemetria liga. */
  const editor = $('#payload');
  const editorNote = $('#editorNote');
  const DEFAULT_NOTE = editorNote.textContent;

  function loadSample(sample, { syncEditor = true } = {}) {
    stopTelemetry();
    let rec;
    try { rec = sdk.track(sample); } catch (err) { showParseError(err.message); return; }
    const previous = currentId;
    currentId = rec.sampleId;
    badge.sampleId = currentId;
    mini.sampleId = currentId;
    if (previous && previous !== currentId) sdk.untrack(previous);
    if (syncEditor) editor.value = JSON.stringify(sample, null, 2);
    editorNote.textContent = DEFAULT_NOTE;
    const profile = THERMAL_PROFILES[rec.sample.biopsyType];
    logger = rec.evaluation.schemaValid && profile ? createSimulatedLogger(rec.sample.sensorTemp, profile) : null;
    setTelemetryControls(Boolean(logger));
    startTelemetry();
  }

  const scenBox = $('#scenarios');
  scenBox.innerHTML = SCENARIOS.map((s) => `<button type="button" class="scenario" data-key="${s.key}" data-expect="${s.expect}" aria-pressed="false"><i aria-hidden="true"></i><b>${esc(s.title)}</b><span>${esc(s.hint)}</span></button>`).join('');
  const markScenario = (key) => scenBox.querySelectorAll('.scenario').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === key)));
  scenBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.scenario');
    if (!btn) return;
    const scenario = SCENARIOS.find((s) => s.key === btn.dataset.key);
    hideParseError();
    loadSample(scenario.build());
    markScenario(scenario.key);
  });

  const parseError = $('#parseError');
  function showParseError(msg) { parseError.textContent = msg; parseError.hidden = false; }
  function hideParseError() { parseError.hidden = true; parseError.textContent = ''; }
  function readEditor() {
    try { const value = JSON.parse(editor.value); hideParseError(); return value; } catch (err) { showParseError(`JSON inválido: ${err.message}`); return null; }
  }

  $('#btnLoadJson').addEventListener('click', () => {
    const parsed = readEditor();
    if (!parsed) return;
    loadSample(parsed, { syncEditor: false });
    markScenario(null);
  });

  /* 5) Licença (API Key) */
  const keyInput = $('#apiKey');
  const keyButtons = Array.from(document.querySelectorAll('[data-key]')).filter((b) => b.closest('.seg'));
  const syncKeyButtons = () => keyButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === keyInput.value.trim())));
  function applyKey(value) { keyInput.value = value; sdk.setApiKey(value); syncKeyButtons(); }
  keyButtons.forEach((b) => b.addEventListener('click', () => applyKey(b.dataset.key)));
  keyInput.addEventListener('input', syncKeyButtons);
  keyInput.addEventListener('change', () => applyKey(keyInput.value));

  const MODE_TEXT = {
    SANDBOX: { MISSING_API_KEY: 'Sandbox, sem chave', INVALID_API_KEY: 'Sandbox, chave recusada pelo servidor' },
    PENDING: { KEY_NOT_VERIFIED: 'Chave definida, ainda não verificada' },
    ENTERPRISE: { LICENSE_VALID: 'Enterprise, licença confirmada pelo servidor' }
  };
  function renderMode() {
    const label = (MODE_TEXT[sdk.mode] && MODE_TEXT[sdk.mode][sdk.modeReason]) || sdk.mode;
    $('#modeLine').innerHTML = `Modo atual: <b>${esc(label)}</b>`;
  }
  sdk.addEventListener('oot:mode', renderMode);

  /* 6) Painéis: resposta HTTP, eventos e verificação */
  function highlight(value) {
    const json = JSON.stringify(value, null, 2);
    const safe = (json === undefined ? 'undefined' : json).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
    return safe.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m, str, colon, bool) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (bool) return `<span class="j-bool">${m}</span>`;
      if (m === 'null') return '<span class="j-null">null</span>';
      return `<span class="j-num">${m}</span>`;
    });
  }

  function renderResponse(result) {
    const line = $('#httpLine');
    const view = $('#responseView');
    if (!result.http) {
      const why = result.stage === 'SCHEMA' ? 'O SDK bloqueou o envio: o payload viola o JSON Schema. Nenhuma requisição saiu do navegador.' : `Sem resposta do servidor: ${result.error}`;
      line.innerHTML = `<span class="pill" data-tone="crit">Bloqueado no cliente</span><span>${esc(why)}</span>`;
      view.innerHTML = `<pre class="code">${highlight({ stage: result.stage, status: result.status, findings: result.findings })}</pre>`;
      return;
    }
    const status = result.http.status;
    const tone = status === 200 ? 'ok' : status === 402 ? 'warn' : 'crit';
    const h = result.http.headers;
    const picked = ['x-oot-tier', 'x-request-id', 'x-ratelimit-remaining', 'idempotent-replayed'].filter((k) => h[k]).map((k) => `${k}: ${esc(h[k])}`).join('<br>');
    line.innerHTML = `<span class="pill" data-tone="${tone}">HTTP ${status} ${esc(result.http.statusText)}</span><span class="mono">POST /v1/custody/validate</span><span>${result.http.latencyMs} ms</span>${picked ? `<span class="headers">${picked}</span>` : ''}`;
    view.innerHTML = `<pre class="code">${highlight(result.response)}</pre>`;
  }

  const logEl = $('#log');
  const LEVEL = { info: 'info', ok: 'ok', warn: 'aviso', error: 'erro', host: 'host' };
  function appendLog(entry) {
    const d = new Date(entry.at);
    const li = document.createElement('li');
    li.dataset.level = entry.level;
    li.innerHTML = `<time datetime="${esc(entry.at)}">${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}</time><b>${esc(LEVEL[entry.level] || entry.level)}</b><span></span>`;
    li.lastElementChild.textContent = entry.message;
    logEl.prepend(li);
    while (logEl.children.length > 150) logEl.lastElementChild.remove();
  }

  const verifyOut = $('#verifyOut');
  function resetVerify() { verifyOut.innerHTML = ''; delete verifyOut.dataset.state; }

  $('#btnVerify').addEventListener('click', async () => {
    if (!lastReceipt) {
      verifyOut.dataset.state = 'idle';
      verifyOut.innerHTML = '<p>Ainda não há recibo selado. Valide com a chave Enterprise; o modo sandbox não emite hash nem selo.</p>';
      return;
    }
    const parsed = readEditor();
    if (!parsed) return;
    let v;
    try { v = await sdk.verifyReceipt(parsed, lastReceipt); } catch (err) { showParseError(err.message); return; }
    const hashFailed = v.checks[0].ok === false;
    const rows = v.checks.map((c) => {
      const cls = c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'skip';
      const mark = { ok: '✓', bad: '✕', skip: '–' }[cls];
      const sr = { ok: 'confere', bad: 'falhou', skip: 'não verificado' }[cls];
      let detail = c.note ? esc(c.note) : '';
      if (c.id === 'PAYLOAD_HASH') detail = c.ok ? esc(shortHash(c.actual)) : `esperado ${esc(shortHash(c.expected))}<br>obtido ${esc(shortHash(c.actual))}`;
      return `<li><span class="vm vm-${cls}" aria-hidden="true">${mark}</span><div><span class="sr">${sr}: </span>${esc(c.label)}${detail ? `<small>${detail}</small>` : ''}</div></li>`;
    }).join('');
    verifyOut.dataset.state = v.valid ? 'valid' : 'invalid';
    const summary = v.valid
      ? (v.signature === true
        ? 'O JSON do editor é idêntico ao registro selado e o selo é autêntico.'
        : 'O JSON do editor é idêntico ao registro selado. A assinatura não pôde ser conferida nesta página (Web Crypto indisponível).')
      : hashFailed
        ? 'O JSON do editor não corresponde ao registro selado. Em GxP, uma correção gera novo registro com justificativa; o original nunca é sobrescrito.'
        : 'A assinatura do selo não confere: o recibo foi alterado ou não veio do servidor licenciado.';
    verifyOut.innerHTML = `<h3>${v.valid ? 'Integridade confirmada' : 'Adulteração detectada'}</h3><p>${esc(summary)}</p><ul>${rows}</ul>`;
  });

  sdk.logs.forEach(appendLog);
  sdk.addEventListener('oot:log', (e) => appendLog(e.detail));
  sdk.addEventListener('oot:result', (e) => {
    const { result } = e.detail;
    renderResponse(result);
    if (result.mode === 'ENTERPRISE' && result.ok && result.receipt) {
      lastReceipt = result.receipt;
      editor.value = JSON.stringify(result.sample, null, 2); // o editor passa a mostrar exatamente o que foi selado
      editorNote.textContent = 'O editor mostra agora o payload exatamente como foi selado, incluindo a leitura do sensor naquele instante. Altere um caractere e clique em Verificar integridade.';
      resetVerify();
    }
  });
  // Integração típica de host: ouvir o evento DOM que o componente emite.
  document.addEventListener('oot-validated', (e) => {
    const r = e.detail;
    const tag = `<${e.target.localName}${e.target.hasAttribute('compact') ? ' compact' : ''}>`;
    appendLog({ at: new Date().toISOString(), level: 'host', message: `Host recebeu o evento oot-validated de ${tag}: modo ${r.mode}, status ${STATUS_LABEL[r.status] || r.status}.` });
  });

  /* 7) Documentação gerada das fontes reais (schema e contrato) */
  $('#schemaView').innerHTML = highlight(SAMPLE_SCHEMA);
  $('#contractView').innerHTML = highlight(server.API_CONTRACT);

  /* 8) Estado inicial */
  syncKeyButtons();
  renderMode();
  loadSample(SCENARIOS[0].build());
  markScenario(SCENARIOS[0].key);

  console.info(
    '%cOpenOnco-Trace%c demo carregada. No console: OOT.sdk, OOT.server, OOT.OpenOnco\n' +
    '  await (await fetch(OOT.server.BASE_URL + "/.well-known/jwks.json")).json()\n' +
    '  await (await fetch(OOT.server.BASE_URL + "/audit/ledger", { headers: { "X-API-Key": "ENTERPRISE_VALID_KEY" } })).json()',
    'font-weight:700', 'font-weight:400'
  );
})();
