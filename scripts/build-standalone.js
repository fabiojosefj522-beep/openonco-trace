#!/usr/bin/env node
// Gera dist/openonco-trace-standalone.html: a demo inteira em um único arquivo,
// com todos os <script src> embutidos. Útil para enviar por e-mail ou abrir offline.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const out = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  // Dentro de <script> inline, a sequência "</script" encerraria o bloco antes da hora.
  const code = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script data-src="${src}">\n${code}</script>`;
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const target = path.join(root, 'dist', 'openonco-trace-standalone.html');
fs.writeFileSync(target, out);
console.log(`Gerado ${path.relative(root, target)} (${(out.length / 1024).toFixed(0)} KB)`);
