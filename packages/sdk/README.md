# @openonco/sdk

SDK open source (Apache-2.0) do OpenOnco-Trace, sem dependências.

```html
<script src="openonco-sdk.js"></script>
<script>
  const sdk = new OpenOncoSDK({
    endpoint: 'https://seu-backend/openonco',          // BFF/proxy do host: a API Key fica lá
    operator: { userId: 'qa.asouza', printedName: 'Ana Souza' }
  });
  const rec = sdk.track(amostra);                       // captura + schema + regras locais
  const result = await sdk.submit(rec.sampleId);        // ENTERPRISE | SANDBOX | LOCAL | OFFLINE
  const check = await sdk.verifyReceipt(amostra, result.receipt); // verificação aberta do selo
</script>
```

Exporta `window.OpenOncoSDK` e `window.OpenOnco` (schema, validador, integridade, regras).
Eventos: `oot:update`, `oot:result`, `oot:mode`, `oot:sandbox`, `oot:log`.
