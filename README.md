# OpenOnco-Trace

Rastreabilidade de custódia e validação de amostras biológicas para terapias personalizadas contra o câncer (CAR-T autólogo e vacinas de mRNA com neoantígenos), no modelo open-core.

## Como rodar

Abra `index.html` no navegador. Não há build, dependências nem chamadas de rede: a API Enterprise é simulada em memória. Siga o roteiro de 6 passos no topo da página.

Para uma versão em arquivo único (para enviar por e-mail ou abrir offline): `npm run build`, que gera `dist/openonco-trace-standalone.html`.

## Estrutura

```
openonco-trace/
├── index.html                      demo (carrega os arquivos abaixo)
├── packages/
│   ├── sdk/openonco-sdk.js         PARTE A · @openonco/sdk (Apache-2.0)
│   │                               JSON Schema, validador, SHA-256, regras, OpenOncoSDK
│   └── badge/onco-badge.js         PARTE A · @openonco/badge (Apache-2.0)
│                                   Web Component <onco-badge>
├── mock/enterprise-mock.js         PARTE Z · simulação pública do contrato da API Enterprise
├── demo/demo.js                    harness da demo (cenários, editor, painéis)
├── scripts/build-standalone.js     gera a demo em arquivo único em dist/
└── test/                           testes ponta a ponta (Playwright)
```

Os pacotes são scripts clássicos (expõem `window.OpenOncoSDK`, `window.OpenOnco` e o elemento `<onco-badge>`), por isso a demo funciona direto de `file://`.

**Sobre a Parte Z:** este repositório traz só uma simulação do contrato, para integradores testarem sem rede e sem licença. O servidor Enterprise real (licenciamento, chave de assinatura em HSM/KMS, trilha de auditoria append-only, carimbo de tempo RFC 3161) é proprietário e fica fora daqui.

Modelo de confiança: verificar é aberto, emitir é pago. O SDK livre confere o selo (hash + chave pública via JWKS); só o servidor licenciado o emite.

## Contrato da API (resumo)

- `POST /v1/custody/validate`
  - `X-API-Key: ENTERPRISE_VALID_KEY` → **200** com `integrity.payloadHash` (SHA-256), `signature` (ES256) e `complianceSeal`
  - sem chave ou chave inválida → **402** `OOT-402-COMMERCIAL_USE_LIMITATION`, modo sandbox, sem validade regulatória
  - 400, 422 e 429 para JSON malformado, violação de schema e cota sandbox
- `GET /v1/.well-known/jwks.json` (público)
- `GET /v1/audit/ledger` (Enterprise)

## Testes

Requer Node e Playwright com Chromium.

```bash
npm test
```

Roda o build em arquivo único e depois três suítes. A primeira testa o fluxo de A a Z em `index.html`. A segunda repete o fluxo no build em arquivo único. A terceira abre a página num contexto não seguro e confere o fallback de SHA-256 em JS puro.

O fluxo de A a Z cobre:

- sandbox sem chave e com chave inválida;
- chave Enterprise;
- detecção de adulteração;
- excursão térmica;
- os seis cenários.

## Licença

Apache-2.0 (ver `LICENSE` e `NOTICE`).

## Avisos para produção

1. A API Key nunca deve ficar no navegador: use um BFF/proxy no backend do host (SAP, Veeva Vault, WMS) ou tokens OAuth2 de curta duração.
2. Conformidade com 21 CFR Part 11 e Anvisa (RDC 658/2022, IN 134/2022, IN 270/2023) exige validação do sistema computadorizado, SOPs e auditoria, não só software.
3. Perfis térmicos, janelas de estabilidade e limiares de QC são ilustrativos.
4. Apenas IDs pseudonimizados de paciente (LGPD/HIPAA).
