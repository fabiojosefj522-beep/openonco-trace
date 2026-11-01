# @openonco/sdk

SDK open source (Apache-2.0) do OpenOnco-Trace, sem dependências. Faz quatro coisas:
- captura a amostra;
- valida o JSON Schema localmente;
- aplica as regras de custódia (paciente, temperatura, viabilidade, cadeia de custódia);
- envia para a API de validação e verifica os selos recebidos.

## Instalação

```bash
npm install @openonco/sdk
```

Sem npm, direto do GitHub via jsDelivr:

```html
<script src="https://cdn.jsdelivr.net/gh/fabiojosefj522-beep/openonco-trace@v1.0.0/packages/sdk/openonco-sdk.js"></script>
```

## Uso

```js
import { OpenOncoSDK } from '@openonco/sdk';          // ESM; também funciona com require()

const sdk = new OpenOncoSDK({
  endpoint: 'https://seu-backend/openonco',            // BFF/proxy do host: a API Key fica lá
  operator: { userId: 'qa.asouza', printedName: 'Ana Souza' }
});

const rec = sdk.track(amostra);                         // captura + schema + regras locais (offline)
const result = await sdk.submit(rec.sampleId);          // mode: ENTERPRISE | SANDBOX | LOCAL | OFFLINE | ERROR

if (result.mode === 'ENTERPRISE') {
  const check = await sdk.verifyReceipt(amostra, result.receipt);  // verificação aberta do selo
}
```

Eventos: `oot:update`, `oot:result`, `oot:mode`, `oot:sandbox`, `oot:log`. Tipos TypeScript incluídos; o tipo `OpenOncoSample` é gerado do JSON Schema.

Pela tag `<script>`, o SDK expõe `window.OpenOncoSDK` e `window.OpenOnco`. Pelos módulos ESM e CommonJS, não cria globais.

Contrato da API: [`openapi/openonco-trace.v1.yaml`](../../openapi/openonco-trace.v1.yaml).
