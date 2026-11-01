/* =============================================================================
 * PARTE A, OPEN SOURCE: @openonco/badge        SPDX-License-Identifier: Apache-2.0
 * <onco-badge>: Custom Element com Shadow DOM. Funciona em qualquer stack
 * (SAP UI5/Fiori, Veeva Vault, Angular, React, Vue ou HTML puro).
 *
 * Uso programático:
 *   const sdk = new OpenOncoSDK({ endpoint, operator });  // a chave fica no backend
 *   const rec = sdk.track(amostra);
 *   badge.sdk = sdk;  badge.sampleId = rec.sampleId;
 *
 * Uso declarativo (sandbox, sem JavaScript próprio):
 *   <onco-badge><script type="application/json">{ ...amostra... }</script></onco-badge>
 *
 * Atributos: sample-id, compact, endpoint (só no modo declarativo)
 * Eventos DOM: oot-validated (detail = resultado do SDK; bubbles + composed)
 * Tema: propriedades CSS --oot-* e ::part(card | status | compact)
 * ===========================================================================*/
(function (global) {
  'use strict';
  const { THERMAL_PROFILES, STEP_LABEL, STATUS_LABEL, DISPOSITION_LABEL, SAMPLE_SCHEMA, SANDBOX_NOTICE, VERSION, SCHEMA_VERSION } = global.OpenOnco;
  const PSEUDONYM = new RegExp(SAMPLE_SCHEMA.properties.patientId.pattern);

  /* ── utilitários de formatação (pt-BR) ── */
  const NF = [0, 1, 2].map((d) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
  const num = (n, d = 1) => (isNum(n) ? NF[d].format(n) : '—');
  const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const text = (v, fallback = '—') => (v === undefined || v === null || v === '' ? fallback : String(v));
  const pad = (n) => String(n).padStart(2, '0');
  // Data e hora em duas linhas curtas: cabem na linha do tempo mesmo em telas de celular.
  const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}<br>${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dateTime = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }); };
  const duration = (ms, seconds = true) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return seconds ? `${h}h ${pad(m)}m ${pad(r)}s` : `${h}h ${pad(m)}m`;
  };
  const shortHash = (h) => (typeof h === 'string' && h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : text(h));
  const setHTML = (el, html) => { if (el.__ootHTML !== html) { el.innerHTML = html; el.__ootHTML = html; } };

  const MODE_CHIP = {
    SANDBOX: { full: 'Sandbox', compact: 'Sandbox', tone: 'yellow' },
    PENDING: { full: 'Chave não verificada', compact: 'Pendente', tone: 'idle' },
    ENTERPRISE: { full: 'Enterprise', compact: 'Enterprise', tone: 'green' }
  };

  const BADGE_CSS = `
:host {
  --oot-bg: #121214; --oot-raised: #18181c; --oot-line: #26262c; --oot-line-strong: #36363e;
  --oot-text: #e6e6ea; --oot-muted: #9a9aa6; --oot-faint: #686874;
  --oot-green: #2bff88; --oot-green-rgb: 43, 255, 136;
  --oot-yellow: #ffd60a; --oot-yellow-rgb: 255, 214, 10;
  --oot-red: #ff3b5c; --oot-red-rgb: 255, 59, 92;
  --oot-cyan: #4cc9f0; --oot-cyan-rgb: 76, 201, 240;
  --oot-idle: #6b6b76; --oot-idle-rgb: 107, 107, 118;
  --oot-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --oot-display: "DIN Alternate", Bahnschrift, "DIN 2014", "D-DIN", Barlow, "Roboto Condensed", var(--oot-font);
  --oot-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, "Liberation Mono", monospace;
  display: block; max-width: 480px; color: var(--oot-text); font: 13px/1.45 var(--oot-font); -webkit-font-smoothing: antialiased;
}
:host([hidden]) { display: none; }
:host([compact]) { max-width: none; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  --c: var(--oot-idle); --c-rgb: var(--oot-idle-rgb);
  position: relative; overflow: hidden; background: var(--oot-bg);
  border: 1px solid var(--oot-line); border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03), 0 1px 0 rgba(0,0,0,.5), 0 18px 40px -18px rgba(0,0,0,.85);
}
.card[data-status="VERIFIED"] { --c: var(--oot-green); --c-rgb: var(--oot-green-rgb); }
.card[data-status="WARNING"] { --c: var(--oot-yellow); --c-rgb: var(--oot-yellow-rgb); }
.card[data-status="CRITICAL"] { --c: var(--oot-red); --c-rgb: var(--oot-red-rgb); }
.card[data-status="PENDING"] { --c: var(--oot-cyan); --c-rgb: var(--oot-cyan-rgb); }
.card[data-thermal="green"] { --t: var(--oot-green); }
.card[data-thermal="yellow"] { --t: var(--oot-yellow); }
.card[data-thermal="red"] { --t: var(--oot-red); }
/* trilho de estado na borda esquerda, como num painel de equipamento */
.card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c); box-shadow: 0 0 14px rgba(var(--c-rgb), .55); }
.progress { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; opacity: 0; }
.card[data-status="PENDING"] .progress { opacity: 1; }
.progress::after { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; background: linear-gradient(90deg, transparent, var(--oot-cyan), transparent); animation: sweep 1.1s linear infinite; }
@keyframes sweep { from { left: -40%; } to { left: 100%; } }
@keyframes blink { 50% { opacity: .35; } }

.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px 10px 17px; border-bottom: 1px solid var(--oot-line); }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 650; font-size: 12.5px; }
.brand svg { width: 18px; height: 18px; fill: none; stroke: var(--oot-muted); stroke-width: 2.2; }
.chip { flex: none; padding: 4px 7px; font: 650 11px/1 var(--oot-font); border: 1px solid currentColor; border-radius: 4px; white-space: nowrap; }
.chip[data-tone="yellow"] { color: var(--oot-yellow); background: rgba(var(--oot-yellow-rgb), .08); }
.chip[data-tone="green"] { color: var(--oot-green); background: rgba(var(--oot-green-rgb), .08); }
.chip[data-tone="idle"] { color: var(--oot-muted); border-color: var(--oot-line-strong); }

/* fita de risco: o modo sandbox não pode ser confundido com resultado regulado */
.tape { display: none; padding: 3px 0; background: repeating-linear-gradient(-45deg, var(--oot-yellow) 0 9px, var(--oot-bg) 9px 18px); }
.card[data-mode="SANDBOX"] .tape { display: block; }
.tape span { display: block; width: max-content; max-width: calc(100% - 24px); margin: 0 auto; padding: 5px 10px; background: var(--oot-bg); color: var(--oot-yellow); font: 700 11.5px/1.2 var(--oot-display); letter-spacing: .05em; text-align: center; }

.status { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 14px; padding: 16px 16px 15px 19px; }
.led { flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px rgba(var(--c-rgb), .14), 0 0 10px rgba(var(--c-rgb), .9), 0 0 24px rgba(var(--c-rgb), .45); }
.led-lg { width: 16px; height: 16px; }
.card[data-status="IDLE"] .led { box-shadow: 0 0 0 3px rgba(var(--c-rgb), .12); }
.card[data-status="WARNING"] .led, .card[data-status="CRITICAL"] .led { animation: blink 1.4s ease-in-out infinite; }
.card[data-status="PENDING"] .led { animation: blink .7s ease-in-out infinite; }
.title { font: 700 21px/1.1 var(--oot-display); letter-spacing: .03em; text-transform: uppercase; color: var(--c); text-shadow: 0 0 14px rgba(var(--c-rgb), .35); }
.card[data-status="IDLE"] .title { color: var(--oot-muted); text-shadow: none; }
.sub { margin-top: 4px; font-size: 12.5px; color: var(--oot-muted); }

.ids { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 16px; margin: 0; padding: 12px 16px 14px 19px; border-top: 1px solid var(--oot-line); }
.ids dt { margin-bottom: 2px; font-size: 11.5px; color: var(--oot-muted); }
.ids dd { margin: 0; font-size: 12.5px; overflow-wrap: anywhere; }
.mono { font-family: var(--oot-mono); font-size: 12px; }
.faint { color: var(--oot-faint); }
.coi { display: inline-block; margin-left: 6px; padding: 1px 5px; font-size: 11px; font-weight: 650; border-radius: 3px; vertical-align: 1px; }
.coi:empty { display: none; }
.coi[data-ok="true"] { color: var(--oot-green); background: rgba(var(--oot-green-rgb), .1); }
.coi[data-ok="false"] { color: var(--oot-red); background: rgba(var(--oot-red-rgb), .12); }

.thermal, .custody { padding: 12px 16px 14px 19px; border-top: 1px solid var(--oot-line); }
.row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.lbl { font-size: 11.5px; color: var(--oot-muted); }
.tabnum { font-variant-numeric: tabular-nums; }
.live { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--oot-faint); white-space: nowrap; }
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--oot-faint); }
.live[data-on="true"] { color: var(--oot-text); }
.live[data-on="true"] i { background: var(--oot-cyan); box-shadow: 0 0 8px var(--oot-cyan); animation: blink 1s ease-in-out infinite; }
.t-mid { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 16px; margin-top: 6px; }
.t-value { min-width: 4.6ch; font: 700 36px/1 var(--oot-display); font-variant-numeric: tabular-nums; letter-spacing: -.01em; color: var(--t, var(--oot-text)); white-space: nowrap; }
.t-value small { margin-left: 3px; font-size: 15px; font-weight: 600; color: var(--oot-muted); }
.spark { display: block; width: 100%; height: 48px; }
.spark .band { fill: rgba(255,255,255,.045); stroke: rgba(255,255,255,.12); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.spark .trace { fill: none; stroke: var(--t, var(--oot-muted)); stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.t-meta { display: flex; flex-wrap: wrap; gap: 3px 14px; margin-top: 8px; font-size: 11.5px; color: var(--oot-muted); font-variant-numeric: tabular-nums; }

.timeline { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 10px 0 0; padding: 0; list-style: none; }
.timeline li { position: relative; min-width: 0; padding-top: 16px; font-size: 11px; color: var(--oot-muted); }
.timeline li::before { content: ""; position: absolute; top: 4px; left: 0; z-index: 1; width: 9px; height: 9px; border-radius: 50%; background: var(--oot-text); }
.timeline li::after { content: ""; position: absolute; top: 8px; left: 9px; right: 0; height: 1px; background: var(--oot-line-strong); }
.timeline li:last-child::after { display: none; }
.timeline li.next::before { background: transparent; border: 1.5px solid var(--oot-faint); }
.timeline .s { display: block; overflow: hidden; padding-right: 4px; color: var(--oot-text); font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.timeline .next .s { color: var(--oot-muted); font-weight: 500; }
.timeline .t { display: block; font-family: var(--oot-mono); font-size: 10.5px; line-height: 1.35; }
.window { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-top: 12px; font-size: 11.5px; color: var(--oot-muted); font-variant-numeric: tabular-nums; }
.bar { height: 4px; overflow: hidden; background: #24242a; border-radius: 2px; }
.bar i { display: block; width: 0; height: 100%; background: #9aa0aa; border-radius: 2px; transition: width .4s; }
.window[data-over="true"] .bar i { background: var(--oot-red); }

.findings { display: grid; gap: 6px; margin: 0; padding: 0 16px 12px 19px; list-style: none; }
.findings:empty { display: none; }
.findings li { padding: 7px 10px; font-size: 12.5px; background: rgba(var(--f-rgb), .07); border-left: 2px solid var(--f); border-radius: 0 6px 6px 0; }
.findings li[data-sev="CRITICAL"] { --f: var(--oot-red); --f-rgb: var(--oot-red-rgb); }
.findings li[data-sev="WARNING"] { --f: var(--oot-yellow); --f-rgb: var(--oot-yellow-rgb); }
.findings code { display: block; margin-top: 2px; font: 10.5px/1.4 var(--oot-mono); color: var(--oot-faint); }

.seal { margin: 0 16px 14px 19px; padding: 11px 12px; font-size: 12.5px; background: var(--oot-raised); border: 1px solid var(--oot-line); border-radius: 8px; }
.seal[data-kind="enterprise"] { border-color: rgba(var(--oot-green-rgb), .35); }
.seal[data-kind="sandbox"] { border-style: dashed; border-color: rgba(var(--oot-yellow-rgb), .55); }
.seal[data-kind="error"] { border-color: rgba(var(--oot-red-rgb), .5); }
.seal h3 { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; margin: 0 0 8px; font-size: 12.5px; font-weight: 650; }
.seal h3 small { font-weight: 500; color: var(--oot-muted); }
.seal p { margin: 0 0 6px; }
.seal p:last-child { margin-bottom: 0; }
.kv { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 4px 10px; margin: 0; }
.kv dt { color: var(--oot-muted); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.muted { color: var(--oot-muted); }
.warn { color: var(--oot-yellow); }
.disp[data-status="VERIFIED"] { color: var(--oot-green); }
.disp[data-status="WARNING"] { color: var(--oot-yellow); }
.disp[data-status="CRITICAL"] { color: var(--oot-red); }
.hash { padding: 0; font: 11.5px/1.4 var(--oot-mono); color: inherit; background: none; border: 0; border-bottom: 1px dotted var(--oot-faint); cursor: copy; }
.divergence { margin-top: 8px !important; color: var(--oot-yellow); }

.foot { display: grid; gap: 8px; padding: 0 16px 14px 19px; }
.btn, .c-btn { appearance: none; font: 650 13.5px/1 var(--oot-font); color: var(--oot-text); background: #1d1d22; border: 1px solid var(--oot-line-strong); border-radius: 7px; cursor: pointer; transition: border-color .15s, background-color .15s; }
.btn { width: 100%; padding: 12px 14px; }
.btn:hover:not(:disabled), .c-btn:hover:not(:disabled) { background: #232329; border-color: #4a4a55; }
.btn:disabled, .c-btn:disabled { color: var(--oot-muted); cursor: progress; }
.btn:focus-visible, .c-btn:focus-visible, .hash:focus-visible { outline: 2px solid var(--oot-cyan); outline-offset: 2px; }
.meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--oot-faint); }

/* variante compacta: uma linha para tabelas e listas do host */
.compact { display: none; }
:host([compact]) .full { display: none; }
:host([compact]) .compact { display: flex; align-items: center; gap: 10px; min-height: 54px; padding: 9px 10px 9px 15px; }
.c-text { flex: 1; min-width: 0; }
.c-title { overflow: hidden; font: 700 14px/1.2 var(--oot-display); letter-spacing: .03em; text-transform: uppercase; color: var(--c); white-space: nowrap; text-overflow: ellipsis; }
.card[data-status="IDLE"] .c-title { color: var(--oot-muted); }
.c-sub { overflow: hidden; font-size: 11.5px; color: var(--oot-muted); white-space: nowrap; text-overflow: ellipsis; }
.c-temp { font: 700 17px/1 var(--oot-display); font-variant-numeric: tabular-nums; color: var(--t, var(--oot-text)); white-space: nowrap; }
.c-btn { padding: 8px 11px; font-size: 12px; }
@media (max-width: 420px) { :host([compact]) .compact .chip { display: none; } }
@media (prefers-reduced-motion: reduce) {
  .led, .live i, .progress::after { animation: none !important; }
  .bar i { transition: none; }
}`;

  const BADGE_HTML = `
<div class="card" part="card" data-status="IDLE" data-mode="SANDBOX">
  <div class="progress" aria-hidden="true"></div>
  <div class="compact" part="compact">
    <span class="led" aria-hidden="true"></span>
    <div class="c-text" role="status" aria-live="polite">
      <div class="c-title" data-ref="cTitle">Aguardando amostra</div>
      <div class="c-sub" data-ref="cSub"></div>
    </div>
    <div class="c-temp" data-ref="cTemp">—</div>
    <span class="chip" data-ref="cChip"></span>
    <button type="button" class="c-btn" data-ref="cBtn">Validar</button>
  </div>
  <div class="full">
    <header class="head">
      <span class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="10.5" width="16" height="11" rx="5.5"/><rect x="13" y="10.5" width="16" height="11" rx="5.5"/></svg>OpenOnco-Trace</span>
      <span class="chip" data-ref="chip"></span>
    </header>
    <div class="tape" aria-hidden="true"><span>${SANDBOX_NOTICE}</span></div>
    <section class="status" part="status">
      <span class="led led-lg" aria-hidden="true"></span>
      <div role="status" aria-live="polite">
        <div class="title" data-ref="title">Aguardando amostra</div>
        <div class="sub" data-ref="sub"></div>
      </div>
    </section>
    <dl class="ids">
      <div><dt>Paciente</dt><dd><span class="mono" data-ref="patient">—</span><span class="coi" data-ref="coi"></span></dd></div>
      <div><dt>Ordem</dt><dd class="mono" data-ref="order">—</dd></div>
      <div><dt>Amostra</dt><dd class="mono" data-ref="sample">—</dd></div>
      <div><dt>Material</dt><dd data-ref="material">—</dd></div>
    </dl>
    <section class="thermal">
      <div class="row"><span class="lbl">Temperatura <span class="mono faint" data-ref="sensor"></span></span><span class="live" data-ref="live"><i></i><span data-ref="liveTxt">sem telemetria</span></span></div>
      <div class="t-mid">
        <div class="t-value"><span data-ref="temp">—</span><small>°C</small></div>
        <svg class="spark" viewBox="0 0 160 48" preserveAspectRatio="none" aria-hidden="true"><rect class="band" data-ref="band" x="0" y="0" width="160" height="0"/><polyline class="trace" data-ref="trace" points=""/></svg>
      </div>
      <div class="t-meta"><span data-ref="range"></span><span data-ref="minmax"></span><span data-ref="exc"></span></div>
    </section>
    <section class="custody">
      <div class="row"><span class="lbl">Cadeia de custódia</span><span class="lbl tabnum" data-ref="elapsed"></span></div>
      <ol class="timeline" data-ref="timeline"></ol>
      <div class="window" data-ref="window"><div class="bar"><i data-ref="bar"></i></div><span data-ref="windowTxt"></span></div>
    </section>
    <ul class="findings" data-ref="findings"></ul>
    <section class="seal" data-ref="seal" data-kind="none"></section>
    <footer class="foot">
      <button type="button" class="btn" data-ref="btn">Validar custódia</button>
      <div class="meta"><span>SDK ${VERSION}</span><span>Schema ${SCHEMA_VERSION}</span></div>
    </footer>
  </div>
</div>`;

  /* ── modelo de apresentação ── */
  function thermalTone(ev) {
    if (!ev.schemaValid) return '';
    if (ev.findings.some((f) => f.code === 'THERMAL_CRITICAL')) return 'red';
    if (ev.findings.some((f) => f.category === 'THERMAL')) return 'yellow';
    return 'green';
  }

  function headline(rec) {
    const ev = rec.evaluation;
    const res = rec.lastResult;
    if (rec.pending) return { title: 'Validando…', sub: 'Enviando a amostra para a API de validação.', short: 'Enviando para a API' };
    if (ev.status === 'VERIFIED') {
      const sealed = res && res.mode === 'ENTERPRISE' && res.ok && res.status === 'VERIFIED';
      const sandbox = res && res.mode === 'SANDBOX';
      return {
        title: 'Custódia verificada',
        sub: sealed ? 'Registro selado. Amostra apta para processamento.' : sandbox ? 'Verificação em sandbox, sem validade regulatória.' : 'Pré-validação local do SDK. Ainda sem selo.',
        short: sealed ? 'Selada, apta para processamento' : sandbox ? 'Sandbox, sem validade regulatória' : 'Pré-validação local'
      };
    }
    if (ev.status === 'WARNING') {
      const f = ev.findings[0];
      const short = { THERMAL_NEAR_LIMIT: 'Perto do limite da faixa', TELEMETRY_STALE: 'Telemetria atrasada' }[f.code] || 'Excursão registrada, revisão de QA';
      return { title: 'Atenção térmica', sub: f.message, short };
    }
    const critical = ev.findings.filter((f) => f.severity === 'CRITICAL');
    const first = (cat) => critical.find((f) => f.category === cat);
    if (first('SCHEMA')) return { title: 'Payload inválido', sub: `${critical.length} violação(ões) do JSON Schema. Nada foi enviado.`, short: 'Fora do schema, envio bloqueado' };
    if (first('PATIENT')) {
      const f = first('PATIENT');
      return { title: 'Erro de paciente', sub: f.message, short: f.code === 'COI_MISMATCH' ? 'Cadeia de identidade rompida' : 'Material incompatível com a terapia' };
    }
    if (first('CUSTODY')) return { title: 'Custódia inválida', sub: first('CUSTODY').message, short: 'Cadeia de custódia inconsistente' };
    const f = critical[0];
    const short = { THERMAL_CRITICAL: 'Excursão térmica crítica', STABILITY_WINDOW_EXCEEDED: 'Janela de estabilidade excedida' }[f.code] || 'Abaixo do mínimo de QC';
    return { title: 'Viabilidade comprometida', sub: f.message, short };
  }

  class OncoBadge extends HTMLElement {
    static get observedAttributes() { return ['sample-id']; }

    #sdk = null;
    #ref = {};
    #unsub = [];
    #clock = null;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${BADGE_CSS}</style>${BADGE_HTML}`;
      root.querySelectorAll('[data-ref]').forEach((el) => { this.#ref[el.dataset.ref] = el; });
      this.#ref.card = root.querySelector('.card');
      const run = () => { this.validate(); };
      this.#ref.btn.addEventListener('click', run);
      this.#ref.cBtn.addEventListener('click', run);
      this.#ref.seal.addEventListener('click', (e) => {
        const el = e.target.closest('[data-copy]');
        if (el) this.#copy(el);
      });
    }

    connectedCallback() {
      if (!this.#sdk) this.#bootstrapInline();
      if (!this.#clock) this.#clock = setInterval(() => this.#tick(), 1000);
      this.#render();
    }

    disconnectedCallback() {
      clearInterval(this.#clock);
      this.#clock = null;
      this.#unbind();
    }

    attributeChangedCallback() { this.#render(); }

    get sdk() { return this.#sdk; }
    set sdk(value) {
      this.#unbind();
      this.#sdk = value || null;
      const sdk = this.#sdk;
      if (sdk) {
        const on = (type, fn) => { sdk.addEventListener(type, fn); this.#unsub.push(() => sdk.removeEventListener(type, fn)); };
        on('oot:update', (e) => { if (e.detail.sampleId === this.sampleId) this.#render(); });
        on('oot:mode', () => this.#render());
      }
      this.#render();
    }

    get sampleId() { return this.getAttribute('sample-id'); }
    set sampleId(v) { if (v == null) this.removeAttribute('sample-id'); else this.setAttribute('sample-id', v); }

    /** Registro vivo no SDK (somente leitura). */
    get record() { return this.#sdk && this.sampleId ? this.#sdk.getRecord(this.sampleId) : null; }

    /** Envia a amostra vinculada para validação e emite `oot-validated` para o host. */
    async validate() {
      const rec = this.record;
      if (!rec || rec.pending) return null;
      const result = await this.#sdk.submit(rec.sampleId);
      this.dispatchEvent(new CustomEvent('oot-validated', { detail: result, bubbles: true, composed: true }));
      return result;
    }

    #bootstrapInline() {
      const script = this.querySelector('script[type="application/json"]');
      if (!script) return;
      try {
        const endpoint = this.getAttribute('endpoint') || undefined;
        this.sdk = global.OpenOncoSDK.shared(endpoint ? { endpoint } : undefined);
        this.sampleId = this.sdk.track(JSON.parse(script.textContent)).sampleId;
      } catch (err) {
        console.error('[onco-badge] JSON inline inválido:', err);
      }
    }

    #unbind() { this.#unsub.forEach((off) => off()); this.#unsub = []; }

    #render() {
      const r = this.#ref;
      if (!r.card) return;
      const mode = this.#sdk ? this.#sdk.mode : 'SANDBOX';
      const chip = MODE_CHIP[mode] || MODE_CHIP.SANDBOX;
      r.card.dataset.mode = mode;
      r.chip.textContent = chip.full; r.chip.dataset.tone = chip.tone;
      r.cChip.textContent = chip.compact; r.cChip.dataset.tone = chip.tone;
      if (this.#sdk) r.chip.title = `Modo ${mode} (${this.#sdk.modeReason})`;

      const rec = this.record;
      if (!rec) { this.#renderEmpty(); return; }
      const s = rec.sample;
      const ev = rec.evaluation;
      const head = headline(rec);
      r.card.dataset.status = rec.pending ? 'PENDING' : ev.status;
      r.title.textContent = head.title;
      r.sub.textContent = head.sub;
      r.cTitle.textContent = head.title;
      r.cSub.textContent = head.short;

      // Identidade. LGPD: um ID fora do padrão de pseudônimo pode ser PHI e não é exibido.
      const pidOk = typeof s.patientId === 'string' && PSEUDONYM.test(s.patientId);
      r.patient.textContent = pidOk ? s.patientId : 'oculto (fora do padrão)';
      const orderPid = s.therapyOrder && s.therapyOrder.patientId;
      if (pidOk && typeof orderPid === 'string') {
        const match = s.patientId === orderPid;
        r.coi.dataset.ok = String(match);
        r.coi.textContent = match ? 'COI ok' : `ordem: ${PSEUDONYM.test(orderPid) ? orderPid : 'inválida'}`;
      } else {
        r.coi.textContent = '';
        delete r.coi.dataset.ok;
      }
      r.order.textContent = text(s.therapyOrder && s.therapyOrder.orderId);
      r.sample.textContent = text(s.sampleId);
      const profile = THERMAL_PROFILES[s.biopsyType];
      r.material.textContent = profile ? profile.label : text(s.biopsyType);

      this.#renderThermal(rec, profile);
      this.#renderCustody(rec);
      setHTML(r.findings, ev.findings.map((f) => `<li data-sev="${f.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING'}">${esc(f.message)}<code>${esc(f.code)}</code></li>`).join(''));
      this.#renderSeal(rec);

      r.btn.disabled = r.cBtn.disabled = Boolean(rec.pending);
      r.btn.textContent = rec.pending ? 'Validando…' : 'Validar custódia';
      r.cBtn.textContent = rec.pending ? '…' : 'Validar';
      this.#tick();
    }

    #renderEmpty() {
      const r = this.#ref;
      r.card.dataset.status = 'IDLE';
      r.card.dataset.thermal = '';
      r.title.textContent = r.cTitle.textContent = 'Aguardando amostra';
      r.sub.textContent = 'Vincule uma amostra com sdk.track(amostra) e o atributo sample-id.';
      r.cSub.textContent = 'Nenhuma amostra vinculada';
      ['patient', 'order', 'sample', 'material', 'temp', 'cTemp'].forEach((k) => { r[k].textContent = '—'; });
      ['sensor', 'range', 'minmax', 'exc', 'elapsed', 'windowTxt', 'coi'].forEach((k) => { r[k].textContent = ''; });
      r.trace.setAttribute('points', '');
      r.band.setAttribute('height', '0');
      r.bar.style.width = '0';
      setHTML(r.timeline, '');
      setHTML(r.findings, '');
      r.seal.dataset.kind = 'none';
      setHTML(r.seal, '<p class="muted">Nenhuma amostra vinculada.</p>');
      r.btn.disabled = r.cBtn.disabled = true;
      r.btn.textContent = 'Validar custódia';
      r.cBtn.textContent = 'Validar';
    }

    #renderThermal(rec, profile) {
      const r = this.#ref;
      const t = rec.sample.sensorTemp || {};
      r.card.dataset.thermal = isNum(t.currentC) ? thermalTone(rec.evaluation) : '';
      r.sensor.textContent = text(t.sensorId, '');
      r.temp.textContent = isNum(t.currentC) ? num(t.currentC, 1) : '—';
      r.cTemp.textContent = isNum(t.currentC) ? `${num(t.currentC, 1)} °C` : '—';
      r.range.textContent = profile ? `Faixa ${num(profile.minC, 0)} a ${num(profile.maxC, 0)} °C` : 'Faixa desconhecida';
      r.minmax.textContent = isNum(t.minObservedC) && isNum(t.maxObservedC) ? `Mín. ${num(t.minObservedC, 1)} / máx. ${num(t.maxObservedC, 1)} °C` : '';
      r.exc.textContent = isNum(t.excursionMinutes) ? `Fora da faixa: ${num(t.excursionMinutes, 1)} min` : '';

      // Registrador gráfico: a leitura mais nova fica na borda direita; a faixa permitida é a área tracejada.
      const pts = rec.history.slice(-30);
      if (!profile || pts.length < 2) { r.trace.setAttribute('points', ''); r.band.setAttribute('height', '0'); return; }
      const W = 160, H = 48, PAD = 4, N = 30;
      const span = profile.maxC - profile.minC;
      const values = pts.map((p) => p.c);
      const lo = Math.min(profile.minC - span * 0.35, ...values);
      const hi = Math.max(profile.maxC + span * 0.35, ...values);
      const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - PAD * 2);
      const dx = W / (N - 1);
      r.trace.setAttribute('points', pts.map((p, i) => `${(W - (pts.length - 1 - i) * dx).toFixed(1)},${y(p.c).toFixed(1)}`).join(' '));
      r.band.setAttribute('y', y(profile.maxC).toFixed(1));
      r.band.setAttribute('height', Math.max(0, y(profile.minC) - y(profile.maxC)).toFixed(1));
    }

    #renderCustody(rec) {
      const events = Array.isArray(rec.sample.chainOfCustody) ? rec.sample.chainOfCustody : [];
      const items = events.map((e) => {
        const tip = [e && e.actor, e && e.location, e && e.timestamp].filter(Boolean).join(' | ');
        return `<li title="${esc(tip)}"><span class="s">${esc(STEP_LABEL[e && e.step] || text(e && e.step, '?'))}</span><span class="t">${clock(e && e.timestamp)}</span></li>`;
      });
      const received = events.some((e) => e && typeof e.step === 'string' && e.step.startsWith('RECEIVED_AT_'));
      if (events.length && !received) items.push('<li class="next"><span class="s">Destino</span><span class="t">em trânsito</span></li>');
      setHTML(this.#ref.timeline, items.join(''));
    }

    #renderSeal(rec) {
      const r = this.#ref;
      const res = rec.lastResult;
      const ev = rec.evaluation;
      let kind = 'none';
      let html;
      if (!res) {
        html = '<p class="muted">Nada enviado ao servidor ainda. Clique em Validar custódia para obter o selo.</p>';
      } else if (res.mode === 'ENTERPRISE' && res.receipt && res.receipt.complianceSeal) {
        const seal = res.receipt.complianceSeal;
        const sm = seal.signatureManifestation || {};
        const sigOk = res.verification ? res.verification.signature : null;
        const sigText = sigOk === true ? 'Assinatura ES256 conferida pelo SDK' : sigOk === false ? 'Assinatura inválida' : 'Assinatura não conferida neste contexto';
        kind = res.ok ? 'enterprise' : 'error';
        html = `<h3><span>Selo de conformidade</span><small>${esc(sigText)}</small></h3>
          <dl class="kv">
            <dt>Selo</dt><dd class="mono">${esc(seal.sealId)}</dd>
            <dt>SHA-256</dt><dd><button type="button" class="hash" data-copy="${esc(seal.payloadHash)}" title="Copiar o hash completo">${esc(shortHash(seal.payloadHash))}</button></dd>
            <dt>Assinante</dt><dd>${esc(text(sm.printedName))} (${esc(text(sm.userId))}), ${esc(text(sm.meaningLabel, '').toLowerCase())}</dd>
            <dt>Data e hora</dt><dd>${esc(dateTime(seal.issuedAt))} <span class="muted">(relógio do servidor)</span></dd>
            <dt>Decisão</dt><dd class="disp" data-status="${esc(seal.status)}">${esc(DISPOSITION_LABEL[seal.disposition] || text(seal.disposition))}</dd>
            <dt>Trilha</dt><dd class="mono">registro ${esc(seal.auditTrail ? seal.auditTrail.sequence : '?')}, cadeia ${esc(shortHash(seal.auditTrail && seal.auditTrail.chainHash))}</dd>
            <dt>Normas</dt><dd>${esc((seal.frameworks || []).map((f) => f.ref).join('; '))}</dd>
          </dl>`;
      } else if (res.mode === 'SANDBOX') {
        kind = 'sandbox';
        const q = res.quota ? ` Cota sandbox: ${res.quota.remaining} de ${res.quota.limit}.` : '';
        const why = res.alert && res.alert.reason === 'INVALID_API_KEY' ? 'A API Key foi recusada.' : 'Nenhuma API Key enviada.';
        html = `<h3><span>Selo regulatório indisponível</span><small>HTTP ${esc(res.http ? res.http.status : '402')}</small></h3>
          <p class="warn"><b>${esc(SANDBOX_NOTICE)}</b></p>
          <p class="muted">${esc(why)} ${esc(res.alert ? res.alert.title : 'Limitação de uso comercial')}: sem hash, assinatura, selo ou trilha de auditoria.${esc(q)}</p>`;
      } else if (res.stage === 'SCHEMA') {
        kind = 'error';
        html = '<h3><span>Envio bloqueado no cliente</span></h3><p class="muted">O payload viola o JSON Schema e não saiu do navegador. Corrija os campos apontados acima e valide de novo.</p>';
      } else {
        kind = 'error';
        html = `<h3><span>Falha na validação</span></h3><p class="muted">${esc(text(res.error, 'Erro desconhecido'))}. O status exibido é só a pré-validação local.</p>`;
      }
      if (res && res.status && !rec.pending && res.status !== ev.status) {
        html += `<p class="divergence">O estado atual (${esc(STATUS_LABEL[ev.status])}) difere do último resultado do servidor (${esc(STATUS_LABEL[res.status] || res.status)}). Valide de novo para registrar a mudança.</p>`;
      }
      r.seal.dataset.kind = kind;
      setHTML(r.seal, html);
    }

    /* Atualizações a cada segundo: tempo desde a coleta, janela de estabilidade e indicador ao vivo. */
    #tick() {
      const r = this.#ref;
      const rec = this.record;
      if (!rec) return;
      const events = Array.isArray(rec.sample.chainOfCustody) ? rec.sample.chainOfCustody : [];
      const col = events.find((e) => e && e.step === 'COLLECTION');
      const rcv = events.find((e) => e && typeof e.step === 'string' && e.step.startsWith('RECEIVED_AT_'));
      const profile = THERMAL_PROFILES[rec.sample.biopsyType];
      const t0 = col ? Date.parse(col.timestamp) : NaN;
      if (Number.isFinite(t0)) {
        const end = rcv ? Date.parse(rcv.timestamp) : Date.now();
        const ms = end - t0;
        r.elapsed.textContent = `${duration(ms)} ${rcv ? 'da coleta ao recebimento' : 'desde a coleta'}`;
        if (profile) {
          const limit = profile.maxTransitHours * 3.6e6;
          const over = ms > limit;
          r.bar.style.width = `${Math.min(100, (ms / limit) * 100).toFixed(1)}%`;
          r.window.dataset.over = String(over);
          r.windowTxt.textContent = over ? `Janela de ${profile.maxTransitHours} h excedida` : `${duration(limit - ms, false)} restantes de ${profile.maxTransitHours} h`;
        }
      } else {
        r.elapsed.textContent = '';
        r.bar.style.width = '0';
        r.windowTxt.textContent = '';
      }
      const age = rec.telemetryAt ? (Date.now() - rec.telemetryAt) / 1000 : Infinity;
      r.live.dataset.on = String(age < 4);
      r.liveTxt.textContent = age < 4 ? 'ao vivo' : rec.telemetryAt ? `última leitura há ${Math.round(age)} s` : 'sem telemetria';
    }

    async #copy(el) {
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        el.textContent = 'Hash copiado';
        // O cache de setHTML mantém a confirmação visível; depois o selo é redesenhado.
        setTimeout(() => { this.#ref.seal.__ootHTML = null; this.#render(); }, 1500);
      } catch {
        el.title = el.dataset.copy; // clipboard indisponível: o hash completo fica no tooltip
      }
    }
  }

  if (!customElements.get('onco-badge')) customElements.define('onco-badge', OncoBadge);
  global.OncoBadge = OncoBadge;
})(window);
