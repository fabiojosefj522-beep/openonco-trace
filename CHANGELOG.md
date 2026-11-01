# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). O projeto segue [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

## [1.0.0] - 2026-11-01

Primeira versão pública.

### Adicionado
- **`@openonco/sdk`:**
  - JSON Schema da amostra (`OpenOncoSample` 1.0.0) e validador sem dependências;
  - canonicalização OOT-C14N/1 e SHA-256, com fallback em JS puro;
  - motor de regras: cadeia de identidade, térmico, viabilidade/QC, cadeia de custódia e janela de estabilidade;
  - `OpenOncoSDK` com telemetria em tempo real, envio com idempotência, modo sandbox e verificação aberta de selos (`verifyReceipt`);
  - distribuído como ES module, CommonJS e script de navegador, com tipos TypeScript.
- **`@openonco/badge`:** Web Component `<onco-badge>` com status em tempo real, modo `compact`, uso declarativo e evento `oot-validated`. É seguro em SSR.
- **Contrato OpenAPI 3.1** da API Enterprise, com teste de contrato contra o mock.
- **Mock do contrato** e demo publicada no GitHub Pages.

### Observações
- Em erros HTTP inesperados, `submit()` retorna `mode: 'ERROR'`, para que `mode` sirva sempre como discriminador.

[Não lançado]: https://github.com/fabiojosefj522-beep/openonco-trace/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/fabiojosefj522-beep/openonco-trace/releases/tag/v1.0.0
