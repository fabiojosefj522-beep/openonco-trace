# OpenOnco-Trace

[![CI](https://github.com/fabiojosefj522-beep/openonco-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/fabiojosefj522-beep/openonco-trace/actions/workflows/ci.yml)

**Demo online:** https://fabiojosefj522-beep.github.io/openonco-trace/ · [versão em arquivo único](https://fabiojosefj522-beep.github.io/openonco-trace/dist/openonco-trace-standalone.html)

Rastreabilidade de custódia e validação de amostras biológicas para terapias personalizadas contra o câncer (CAR-T autólogo e vacinas de mRNA com neoantígenos), no modelo open-core.

## Instalação

```bash
npm install @openonco/sdk @openonco/badge
```

Enquanto os pacotes não estão no npm, use o jsDelivr direto do GitHub:

```html
<script src="https://cdn.jsdelivr.net/gh/fabiojosefj522-beep/openonco-trace@v1.0.0/packages/sdk/openonco-sdk.js"></script>
<script src="https://cdn.jsdelivr.net/gh/fabiojosefj522-beep/openonco-trace@v1.0.0/packages/badge/onco-badge.js"></script>
```

Cada pacote tem seu README: [`@openonco/sdk`](packages/sdk/README.md) e [`@openonco/badge`](packages/badge/README.md). Os dois funcionam como ES module, CommonJS (só o SDK) e `<script>`, com tipos TypeScript.

## Como rodar a demo

Abra `index.html` no navegador. Não há build, dependências nem chamadas de rede: a API Enterprise é simulada em memória. Siga o roteiro de 6 passos no topo da página.

`npm run build` regenera as saídas dos pacotes (`packages/*/dist`, tipos e schema exportado) e a demo em arquivo único, em `dist/openonco-trace-standalone.html`.

## Estrutura

```
openonco-trace/
├── index.html                      demo (carrega os arquivos abaixo)
├── packages/
│   ├── sdk/openonco-sdk.js         PARTE A · @openonco/sdk (Apache-2.0); dist/ e types/ são gerados
│   │                               JSON Schema, validador, SHA-256, regras, OpenOncoSDK
│   └── badge/onco-badge.js         PARTE A · @openonco/badge (Apache-2.0)
│                                   Web Component <onco-badge>
├── openapi/
│   ├── openonco-trace.v1.yaml      contrato normativo da API (OpenAPI 3.1)
│   └── schemas/OpenOncoSample.json gerado do SDK (npm run schema)
├── mock/enterprise-mock.js         PARTE Z · simulação pública do contrato da API Enterprise
├── demo/demo.js                    harness da demo (cenários, editor, painéis)
├── scripts/build-packages.js       gera ESM, CommonJS e tipos da amostra dos pacotes
├── scripts/build-standalone.js     gera a demo em arquivo único em dist/
├── scripts/export-schema.js        exporta o JSON Schema do SDK para o OpenAPI
└── test/                           testes ponta a ponta (Playwright)
```

Os pacotes são scripts clássicos (expõem `window.OpenOncoSDK`, `window.OpenOnco` e o elemento `<onco-badge>`), por isso a demo funciona direto de `file://`.

**Sobre a Parte Z:** este repositório traz só uma simulação do contrato, para integradores testarem sem rede e sem licença. O servidor Enterprise real (licenciamento, chave de assinatura em HSM/KMS, trilha de auditoria append-only, carimbo de tempo RFC 3161) é proprietário e fica fora daqui.

Modelo de confiança: verificar é aberto, emitir é pago. O SDK livre confere o selo (hash + chave pública via JWKS); só o servidor licenciado o emite.

## Contrato da API

A fonte normativa é [`openapi/openonco-trace.v1.yaml`](openapi/openonco-trace.v1.yaml), em OpenAPI 3.1. O schema da amostra é gerado do SDK com `npm run schema`, então não existem duas versões dele. Para visualizar o contrato, abra o arquivo no [Swagger Editor](https://editor.swagger.io) ou gere clientes com o OpenAPI Generator.

- `POST /custody/validate`
  - `X-API-Key` válida → **200** com `integrity.payloadHash` (SHA-256), `signature` (ES256), `complianceSeal` e `auditTrail`
  - sem chave ou chave inválida → **402** `OOT-402-COMMERCIAL_USE_LIMITATION`, modo sandbox, sem validade regulatória
  - **400** JSON malformado · **422** schema ou signatário ausente · **429** cota sandbox
- `GET /.well-known/jwks.json` (público): chave para verificar selos sem licença
- `GET /audit/ledger` (Enterprise): trilha de auditoria encadeada por hash

## Testes

Requer Node com Playwright (Chromium) e Python 3 com `pyyaml` e `jsonschema`.

```bash
npm test               # tudo
npm run test:contract  # só o contrato
```

Confere que os arquivos gerados estão em dia, testa os pacotes (ESM, CommonJS, SSR, import map no navegador e tipos com `tsc`) e roda quatro suítes da demo. A primeira testa o fluxo de A a Z em `index.html`. A segunda repete o fluxo no build em arquivo único. A terceira abre a página num contexto não seguro e confere o fallback de SHA-256 em JS puro. A quarta é o teste de contrato: ela checa a estrutura do OpenAPI e confere cada resposta do mock e cada requisição do SDK contra os schemas, em todos os status documentados (200, 400, 402, 422, 429). Também confere que o schema exportado está em dia com o SDK.

O fluxo de A a Z cobre:

- sandbox sem chave e com chave inválida;
- chave Enterprise;
- detecção de adulteração;
- excursão térmica;
- os seis cenários.

## CI e publicação

- `.github/workflows/ci.yml` roda `npm test` em todo pull request e em todo push na `main`.
- `.github/workflows/release.yml` publica os pacotes no npm, com proveniência, quando uma tag `vX.Y.Z` é enviada. Requer o segredo `NPM_TOKEN`; sem ele, apenas testa.
- `.github/workflows/pages.yml` publica a demo no GitHub Pages a cada push na `main`. Para funcionar, é preciso ligar uma vez em **Settings > Pages > Source = GitHub Actions**.

## Comunidade

[Como contribuir](CONTRIBUTING.md) · [Política de segurança](SECURITY.md) · [Código de Conduta](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

## Licença

Apache-2.0 (ver `LICENSE` e `NOTICE`).

## Avisos para produção

1. A API Key nunca deve ficar no navegador: use um BFF/proxy no backend do host (SAP, Veeva Vault, WMS) ou tokens OAuth2 de curta duração.
2. Conformidade com 21 CFR Part 11 e Anvisa (RDC 658/2022, IN 134/2022, IN 270/2023) exige validação do sistema computadorizado, SOPs e auditoria, não só software.
3. Perfis térmicos, janelas de estabilidade e limiares de QC são ilustrativos.
4. Apenas IDs pseudonimizados de paciente (LGPD/HIPAA).
