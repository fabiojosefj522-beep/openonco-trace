# OpenOnco-Trace

Rastreabilidade de custódia e validação de amostras biológicas para terapias personalizadas contra o câncer (CAR-T autólogo e vacinas de mRNA com neoantígenos), no modelo open-core.

## Como rodar

Abra `index.html` no navegador. Não há build, dependências nem chamadas de rede: a API Enterprise é simulada em memória. Siga o roteiro de 6 passos no topo da página.

## Estrutura

Tudo está em `index.html`. Cada bloco `<script>` corresponde a um futuro pacote:

| Bloco | Parte | Conteúdo |
|---|---|---|
| `#oot-sdk` | A, open source | JSON Schema da amostra, validador, canonicalização + SHA-256, motor de regras, classe `OpenOncoSDK` |
| `#oot-badge` | A, open source | Web Component `<onco-badge>` (Shadow DOM, modo `compact`, evento `oot-validated`) |
| `#oot-enterprise-mock` | Z, Enterprise | Contrato da API e servidor simulado: licença por `X-API-Key`, hash SHA-256, assinatura ES256, selo de conformidade, trilha de auditoria encadeada |
| `#oot-demo` | — | Harness da demonstração |

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
node test/flow.test.js       # fluxo A→Z: sandbox, chave inválida, Enterprise, adulteração, excursão térmica, cenários
node test/insecure.test.js   # contexto não seguro: fallback de SHA-256 em JS puro
```

## Avisos para produção

1. A API Key nunca deve ficar no navegador: use um BFF/proxy no backend do host (SAP, Veeva Vault, WMS) ou tokens OAuth2 de curta duração.
2. Conformidade com 21 CFR Part 11 e Anvisa (RDC 658/2022, IN 134/2022, IN 270/2023) exige validação do sistema computadorizado, SOPs e auditoria, não só software.
3. Perfis térmicos, janelas de estabilidade e limiares de QC são ilustrativos.
4. Apenas IDs pseudonimizados de paciente (LGPD/HIPAA).
