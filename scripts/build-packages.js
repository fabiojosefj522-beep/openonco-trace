#!/usr/bin/env node
/*
 * Gera as saídas publicáveis dos pacotes a partir dos scripts de navegador (fonte única):
 *
 *   packages/sdk/dist/index.mjs      ES module (import)         → named exports
 *   packages/sdk/dist/index.cjs      CommonJS (require, Node 18+)
 *   packages/sdk/types/sample.d.ts   tipos TypeScript gerados do JSON Schema da amostra
 *   packages/badge/dist/index.mjs    ES module; importa @openonco/sdk; seguro em SSR
 *
 * Os scripts originais (openonco-sdk.js, onco-badge.js) continuam funcionando com
 * <script src> e file://. Os arquivos gerados são versionados no git para que o
 * jsDelivr sirva qualquer tag; `--check` falha se estiverem desatualizados.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const HEADER = '// GERADO por scripts/build-packages.js. Não edite: altere o script de origem e rode `npm run build`.\n';

/* ── SDK ── */
const sdkSource = read('packages/sdk/openonco-sdk.js');
if (!/\}\)\(window\);\s*$/.test(sdkSource)) throw new Error('openonco-sdk.js deve terminar com "})(window);"');
const sdkBody = sdkSource.replace(/\}\)\(window\);\s*$/, '})(__oot);\n');
const SDK_EXPORTS = ['VERSION', 'SCHEMA_VERSION', 'RULES_VERSION', 'DEFAULT_ENDPOINT', 'SANDBOX_NOTICE', 'SAMPLE_SCHEMA', 'THERMAL_PROFILES', 'STEP_LABEL', 'STATUS_LABEL', 'DISPOSITION_LABEL', 'SchemaValidator', 'Integrity', 'Rules'];
// O SDK roda num objeto privado (sem poluir window); só usa crypto do ambiente.
const sdkPrelude = 'const __oot = { crypto: globalThis.crypto };\n';

const sdkMjs = `${HEADER}${sdkPrelude}${sdkBody}
export const OpenOncoSDK = __oot.OpenOncoSDK;
export const OpenOnco = __oot.OpenOnco;
export const { ${SDK_EXPORTS.join(', ')} } = __oot.OpenOnco;
export default OpenOncoSDK;
`;
const sdkCjs = `${HEADER}'use strict';
${sdkPrelude}${sdkBody}
module.exports = { OpenOncoSDK: __oot.OpenOncoSDK, OpenOnco: __oot.OpenOnco, ...__oot.OpenOnco, default: __oot.OpenOncoSDK };
`;

/* ── Badge ── */
const badgeSource = read('packages/badge/onco-badge.js');
if (!/\}\)\(window\);\s*$/.test(badgeSource)) throw new Error('onco-badge.js deve terminar com "})(window);"');
const badgeBody = badgeSource.replace(/\}\)\(window\);\s*$/, '})(__oot);\n');
const badgeMjs = `${HEADER}import { OpenOncoSDK, OpenOnco } from '@openonco/sdk';

const __oot = { OpenOncoSDK, OpenOnco };
// Em SSR (Next.js, Nuxt, Angular Universal) não há DOM: o módulo carrega, mas não define o elemento.
if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined') {
${badgeBody}}

export const OncoBadge = __oot.OncoBadge;
export default OncoBadge;
`;

/* ── Tipos da amostra, gerados do JSON Schema ── */
function sampleTypes(schema) {
  const NAMES = {
    '#': 'OpenOncoSample',
    '#/therapyOrder': 'TherapyOrder',
    '#/therapyOrder/therapyType': 'TherapyType',
    '#/biopsyType': 'BiopsyType',
    '#/sensorTemp': 'SensorReading',
    '#/qualityControl': 'QualityControl',
    '#/$defs/custodyEvent': 'CustodyEvent',
    '#/$defs/custodyEvent/step': 'CustodyStep'
  };
  const decls = [];
  const doc = (s, indent = '') => {
    const lines = [s.description, s.pattern && `Formato: \`${s.pattern}\``, s.format && `Formato: ${s.format}`,
      s.minimum != null && `Mínimo: ${s.minimum}`, s.maximum != null && `Máximo: ${s.maximum}`].filter(Boolean);
    return lines.length ? `${indent}/** ${lines.join(' · ')} */\n` : '';
  };
  function typeOf(s, at) {
    if (s.$ref) return NAMES[s.$ref.replace('#/$defs', '#/$defs')] || 'unknown';
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.enum) return named(at, s.enum.map((v) => JSON.stringify(v)).join(' | '), s, 'type');
    if (s.type === 'array') return `${typeOf(s.items, `${at}/items`)}[]`;
    if (s.type === 'object') {
      const req = new Set(s.required || []);
      const body = Object.entries(s.properties || {}).map(([k, v]) =>
        `${doc(v, '  ')}  ${k}${req.has(k) ? '' : '?'}: ${typeOf(v, `${at}/${k}`)};`).join('\n');
      return named(at, `{\n${body}\n}`, s, 'interface');
    }
    return { string: 'string', number: 'number', integer: 'number', boolean: 'boolean' }[s.type] || 'unknown';
  }
  function named(at, shape, s, kind) {
    const name = NAMES[at];
    if (!name) return shape;
    decls.push(kind === 'interface' ? `${doc(s)}export interface ${name} ${shape}` : `${doc(s)}export type ${name} = ${shape};`);
    return name;
  }
  Object.entries(schema.$defs || {}).forEach(([k, v]) => typeOf(v, `#/$defs/${k}`));
  typeOf(schema, '#');
  return `${HEADER.replace('//', '//')}// Origem: SAMPLE_SCHEMA em packages/sdk/openonco-sdk.js (JSON Schema ${schema.properties.schemaVersion.const}).
// Regra condicional não expressa no tipo: qualityControl.cellViabilityPct é obrigatório para
// LEUKAPHERESIS_*, e qualityControl.tumorContentPct para TUMOR_*. O validador de schema cobre isso.

${decls.join('\n\n')}
`;
}
const win = { crypto: globalThis.crypto };
new Function('window', sdkSource)(win);
const sampleDts = sampleTypes(win.OpenOnco.SAMPLE_SCHEMA);

/* ── Escrita ou checagem ── */
const outputs = {
  'packages/sdk/dist/index.mjs': sdkMjs,
  'packages/sdk/dist/index.cjs': sdkCjs,
  'packages/sdk/types/sample.d.ts': sampleDts,
  'packages/badge/dist/index.mjs': badgeMjs
};
const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, content] of Object.entries(outputs)) {
  const file = path.join(root, rel);
  if (check) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) { console.error(`Desatualizado: ${rel}`); stale++; }
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`Gerado ${rel}`);
  }
}
if (check) {
  if (stale) { console.error('Rode: npm run build'); process.exit(1); }
  console.log('Saídas dos pacotes em dia com os scripts de origem.');
}
