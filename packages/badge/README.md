# @openonco/badge

Web Component `<onco-badge>` (Apache-2.0): status de custódia em tempo real para SAP, Veeva Vault, WMS e apps web. Depende de `@openonco/sdk`.

## Instalação

```bash
npm install @openonco/sdk @openonco/badge
```

Sem npm, via jsDelivr (o SDK precisa ser carregado antes):

```html
<script src="https://cdn.jsdelivr.net/gh/fabiojosefj522-beep/openonco-trace@v1.0.0/packages/sdk/openonco-sdk.js"></script>
<script src="https://cdn.jsdelivr.net/gh/fabiojosefj522-beep/openonco-trace@v1.0.0/packages/badge/onco-badge.js"></script>
```

## Uso

```js
import { OpenOncoSDK } from '@openonco/sdk';
import '@openonco/badge';                    // registra <onco-badge>; em SSR apenas carrega, sem erro

const badge = document.querySelector('onco-badge');
badge.sdk = sdk;
badge.sampleId = sdk.track(amostra).sampleId;
badge.addEventListener('oot-validated', (e) => console.log(e.detail.mode, e.detail.status));
```

```html
<onco-badge></onco-badge>
<onco-badge compact></onco-badge>          <!-- uma linha, para tabelas -->
```

Uso declarativo, em modo sandbox:

```html
<onco-badge><script type="application/json">{ ...amostra... }</script></onco-badge>
```

Atributos: `sample-id`, `compact`, `endpoint`. Tema: propriedades CSS `--oot-*` e `::part(card | status | compact)`.
