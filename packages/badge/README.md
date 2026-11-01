# @openonco/badge

Web Component `<onco-badge>` (Apache-2.0). Requer `@openonco/sdk` carregado antes.

```html
<onco-badge id="b"></onco-badge>
<onco-badge id="mini" compact></onco-badge>
<script>
  b.sdk = sdk; b.sampleId = rec.sampleId;
  document.addEventListener('oot-validated', (e) => console.log(e.detail));
</script>
```

Uso declarativo, em modo sandbox:

```html
<onco-badge><script type="application/json">{ ...amostra... }</script></onco-badge>
```

Atributos: `sample-id`, `compact`, `endpoint`. Tema: propriedades `--oot-*` e `::part(card | status | compact)`.
