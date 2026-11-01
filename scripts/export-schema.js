#!/usr/bin/env node
// Exporta o JSON Schema da amostra a partir do SDK (fonte única da verdade) para
// openapi/schemas/OpenOncoSample.json, que o contrato OpenAPI referencia.
//   node scripts/export-schema.js          grava o arquivo
//   node scripts/export-schema.js --check  falha se o arquivo estiver desatualizado
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'openapi', 'schemas', 'OpenOncoSample.json');

// O SDK é um script de navegador: basta um "window" mínimo para carregá-lo no Node.
const window = { crypto: globalThis.crypto };
new Function('window', fs.readFileSync(path.join(root, 'packages/sdk/openonco-sdk.js'), 'utf8'))(window);
const json = `${JSON.stringify(window.OpenOnco.SAMPLE_SCHEMA, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== json) {
    console.error(`${path.relative(root, target)} está desatualizado em relação ao SDK. Rode: node scripts/export-schema.js`);
    process.exit(1);
  }
  console.log(`${path.relative(root, target)} está em dia com o SDK.`);
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json);
  console.log(`Gerado ${path.relative(root, target)}`);
}
