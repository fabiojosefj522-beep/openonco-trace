# Como contribuir

Obrigado pelo interesse. Este é um projeto open-core: os pacotes `@openonco/sdk` e `@openonco/badge`, o contrato OpenAPI e o mock são abertos (Apache-2.0). O servidor Enterprise não faz parte deste repositório.

## Ambiente

Requisitos: Node 18+ (recomendado 22) e Python 3 com `pyyaml` e `jsonschema`.

```bash
npm install
npx playwright install chromium
python -m pip install pyyaml jsonschema
npm test
```

## Onde mexer

| Quero mudar... | Edite | Depois rode |
|---|---|---|
| Regras, schema ou SDK | `packages/sdk/openonco-sdk.js` | `npm run build` |
| O componente | `packages/badge/onco-badge.js` | `npm run build` |
| Tipos públicos | `packages/*/index.d.ts` | `npm test` |
| Contrato da API | `openapi/openonco-trace.v1.yaml` e `mock/enterprise-mock.js` | `npm run test:contract` |

Não edite os arquivos gerados (`packages/*/dist/`, `packages/sdk/types/sample.d.ts`, `openapi/schemas/`). O `npm test` falha se eles estiverem defasados em relação à origem.

## Regras do projeto

- **Zero dependências em runtime** nos pacotes.
- **Nada de PHI** em exemplos, testes ou issues: só pseudônimos no formato `PT-XX-000000`.
- **Mudanças de regra clínica ou térmica** precisam citar a fonte (protocolo, norma, IFU) no PR. Os valores atuais são ilustrativos.
- **Mudanças no contrato** seguem SemVer. Campo novo opcional é *minor*; remover ou mudar o significado de um campo é *major*.
- Toda mudança visível entra no `CHANGELOG.md`, na seção "Não lançado".

## Pull requests

1. Faça um branch a partir da `main`.
2. Inclua testes para o comportamento novo.
3. Garanta que `npm test` passa. O CI roda a mesma suíte.
4. Descreva o que muda e por quê.

Ao contribuir, você concorda em licenciar sua contribuição sob Apache-2.0 e em seguir o [Código de Conduta](CODE_OF_CONDUCT.md).
