/* =============================================================================
 * PARTE Z, ENTERPRISE: SIMULAÇÃO DO CONTRATO DA API (ferramenta de desenvolvimento)
 * Este arquivo NÃO é o servidor Enterprise. É um mock público do contrato, como um
 * "sandbox local", para que integradores testem o SDK sem rede e sem licença.
 * A implementação real (licenciamento, HSM/KMS, banco append-only/WORM da trilha,
 * carimbo de tempo RFC 3161) é proprietária e vive fora deste repositório.
 *
 * Funciona ligando-se à página por um interceptador de fetch: só o tráfego do
 * domínio da API simulada é desviado; todo o resto segue para a rede normal.
 * Não carregue este arquivo em produção.
 * ===========================================================================*/
(function (global) {
  'use strict';
  const { SchemaValidator, Rules, Integrity, SAMPLE_SCHEMA, DEFAULT_ENDPOINT } = global.OpenOnco;
  const BASE_URL = DEFAULT_ENDPOINT;
  const ORIGIN = new URL(BASE_URL).origin;

  /* ── Contrato da API: fonte única da documentação exibida na página ── */
  const API_CONTRACT = {
    api: 'OpenOnco-Trace Enterprise Validation API',
    version: 'v1 (2026-11-01)',
    baseUrl: BASE_URL,
    authentication: {
      header: 'X-API-Key',
      rule: 'Sem chave ou com chave inválida: HTTP 402 e modo sandbox. Com chave Enterprise válida: HTTP 200 com hash, assinatura, selo e trilha de auditoria.',
      production: 'A chave nunca vai para o navegador. O host chama a API pelo próprio backend (BFF/proxy) ou entrega ao front um token OAuth2 de curta duração.'
    },
    endpoints: {
      'POST /custody/validate': {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'opcional',
          'Idempotency-Key': 'UUID v4; reenvios com a mesma chave devolvem o mesmo selo',
          'X-OOT-SDK': 'openonco-sdk-js/1.0.0'
        },
        body: {
          sample: 'OpenOncoSample 1.0.0 (ver JSON Schema)',
          context: {
            operator: { userId: 'string', printedName: 'string' },
            sourceSystem: 'SAP | VEEVA | WMS | WEB',
            signatureMeaning: 'REVIEW_APPROVAL | RESPONSIBILITY | AUTHORSHIP'
          }
        },
        responses: {
          200: 'ENTERPRISE: evaluation, integrity (SHA-256), signature (ES256), complianceSeal com auditTrail encadeado',
          402: 'SANDBOX: evaluation sem validade regulatória, alert OOT-402-COMMERCIAL_USE_LIMITATION, quota',
          400: 'OOT-400-MALFORMED_JSON',
          422: 'OOT-422-SCHEMA_VIOLATION ou OOT-422-SIGNER_REQUIRED',
          429: 'OOT-429-SANDBOX_QUOTA_EXCEEDED'
        }
      },
      'GET /.well-known/jwks.json': { auth: 'pública', responses: { 200: 'Chaves públicas ES256 para verificar selos com o SDK aberto' } },
      'GET /audit/ledger': { auth: 'X-API-Key Enterprise', responses: { 200: 'Trilha de auditoria encadeada por hash', 402: 'Recurso exclusivo Enterprise' } }
    }
  };

  /* ── Licenças. No produto real: serviço de billing; guarde só o hash da chave. ── */
  const LICENSES = new Map([
    ['ENTERPRISE_VALID_KEY', { tenant: 'BioPharma Demo S.A.', licenseId: 'LIC-ENT-2026-0042', plan: 'ENTERPRISE' }]
  ]);
  const SANDBOX_QUOTA = 100;
  const SIGNATURE_MEANINGS = { REVIEW_APPROVAL: 'Revisão e aprovação', RESPONSIBILITY: 'Responsabilidade', AUTHORSHIP: 'Autoria' };
  const FRAMEWORKS = [
    { ref: 'FDA 21 CFR Part 11', scope: '11.10(e) trilha de auditoria; 11.50 manifestação da assinatura; 11.70 vínculo assinatura/registro' },
    { ref: 'Anvisa RDC 658/2022 e IN 134/2022', scope: 'BPF de medicamentos; sistemas computadorizados, incluindo trilha de auditoria (art. 33)' },
    { ref: 'Anvisa IN 270/2023', scope: 'BPF de produtos de terapias avançadas, quando aplicável' },
    { ref: 'ALCOA+', scope: 'Integridade de dados: atribuível, legível, contemporâneo, original e exato' }
  ];
  const STATUS_TEXT = { 200: 'OK', 400: 'Bad Request', 402: 'Payment Required', 404: 'Not Found', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error' };

  const state = { sandboxUsed: 0, ledger: [], idempotency: new Map(), keyId: 'oot-hsm-2026-11', keyPair: null, publicJwk: null };

  /* "HSM" simulado: par ECDSA P-256 gerado no boot, com chave privada NÃO extraível. */
  const ready = (async () => {
    if (!Integrity.subtle) return;
    state.keyPair = await Integrity.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    state.publicJwk = await Integrity.subtle.exportKey('jwk', state.keyPair.publicKey);
  })().catch((err) => console.error('[mock] falha ao gerar chaves:', err));

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
    status,
    statusText: STATUS_TEXT[status] || '',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-OOT-API-Version': '2026-11-01', ...headers }
  });
  const licenseOf = (request) => {
    const key = request.headers.get('X-API-Key');
    return { key, license: key ? LICENSES.get(key) || null : null };
  };

  async function handle(request) {
    await ready;
    await sleep(220 + Math.random() * 480); // latência de rede simulada
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace(/^\/v1(?=\/)/, '')}`;
    try {
      if (route === 'POST /custody/validate') return await validateCustody(request);
      if (route === 'GET /.well-known/jwks.json') return jwks();
      if (route === 'GET /audit/ledger') return ledger(request);
      return json(404, { error: { code: 'OOT-404-NOT_FOUND', message: `Rota inexistente: ${request.method} ${url.pathname}` } });
    } catch (err) {
      console.error('[mock] erro interno:', err);
      return json(500, { error: { code: 'OOT-500-INTERNAL', message: 'Erro interno no servidor simulado.' } });
    }
  }

  async function validateCustody(request) {
    const requestId = `req_${Integrity.randomHex(8)}`;
    const base = { 'X-Request-Id': requestId };
    let payload;
    try { payload = await request.json(); } catch {
      return json(400, { requestId, error: { code: 'OOT-400-MALFORMED_JSON', message: 'O corpo da requisição não é um JSON válido.' } }, base);
    }

    const { key, license } = licenseOf(request);
    const idemKey = request.headers.get('Idempotency-Key');
    if (license && idemKey && state.idempotency.has(idemKey)) {
      return json(200, state.idempotency.get(idemKey), { ...base, 'X-OOT-Tier': 'ENTERPRISE', 'Idempotent-Replayed': 'true' });
    }

    // 1) Revalidação no servidor: nunca confie no cliente (o SDK pode ser contornado).
    const sample = payload && payload.sample;
    const schemaErrors = SchemaValidator.validate(sample);
    if (schemaErrors.length) {
      return json(422, { requestId, error: { code: 'OOT-422-SCHEMA_VIOLATION', message: `${schemaErrors.length} violação(ões) do schema OpenOncoSample ${SAMPLE_SCHEMA.properties.schemaVersion.const}.`, details: schemaErrors } }, base);
    }

    // 2) O mesmo motor de regras ABERTO do SDK, agora com o relógio do SERVIDOR.
    const full = Rules.evaluate(sample, Date.now());
    const evaluation = { status: full.status, disposition: full.disposition, findings: full.findings, metrics: full.metrics, rulesVersion: full.rulesVersion, evaluatedAt: full.evaluatedAt };

    // 3) Paywall: sem licença válida, só a avaliação de sandbox, sem nada assinado.
    if (!license) {
      if (state.sandboxUsed >= SANDBOX_QUOTA) {
        return json(429, { requestId, error: { code: 'OOT-429-SANDBOX_QUOTA_EXCEEDED', message: `Cota sandbox de ${SANDBOX_QUOTA} validações por 24 h esgotada.` } }, { ...base, 'Retry-After': '86400' });
      }
      state.sandboxUsed += 1;
      const remaining = SANDBOX_QUOTA - state.sandboxUsed;
      return json(402, {
        requestId,
        tier: 'SANDBOX',
        regulatoryValidity: false,
        alert: {
          code: 'OOT-402-COMMERCIAL_USE_LIMITATION',
          reason: key ? 'INVALID_API_KEY' : 'MISSING_API_KEY',
          title: 'Limitação de uso comercial',
          message: 'MODO SANDBOX (SEM VALIDADE REGULATÓRIA). Avaliação apenas para desenvolvimento e integração: sem hash criptográfico, sem assinatura eletrônica, sem selo de conformidade e sem registro na trilha de auditoria. Não use para liberar material nem para decisões GxP.',
          upgradeUrl: 'https://openonco-trace.example/enterprise'
        },
        evaluation,
        quota: { limit: SANDBOX_QUOTA, used: state.sandboxUsed, remaining, window: '24h' },
        integrity: null,
        signature: null,
        complianceSeal: null
      }, { ...base, 'X-OOT-Tier': 'SANDBOX', 'X-RateLimit-Limit': String(SANDBOX_QUOTA), 'X-RateLimit-Remaining': String(remaining) });
    }

    // 4) Enterprise: a manifestação da assinatura exige signatário identificado (21 CFR 11.50).
    const ctx = payload.context || {};
    const op = ctx.operator || {};
    if (!op.userId || !op.printedName) {
      return json(422, { requestId, error: { code: 'OOT-422-SIGNER_REQUIRED', message: '21 CFR 11.50: o selo exige nome impresso e identificação do signatário (context.operator).' } }, base);
    }

    const issuedAt = new Date().toISOString(); // fonte de tempo confiável: o servidor, nunca o cliente
    const payloadHash = await Integrity.sha256Hex(Integrity.canonicalize(sample));
    const sequence = state.ledger.length + 1;
    const previousHash = sequence > 1 ? state.ledger[sequence - 2].chainHash : '0'.repeat(64);
    const sealId = `OOT-SEAL-${issuedAt.slice(0, 10).replace(/-/g, '')}-${String(sequence).padStart(6, '0')}`;
    // Cadeia de hashes: alterar ou apagar qualquer registro anterior quebra todos os seguintes.
    const chainHash = await Integrity.sha256Hex(`${previousHash}|${payloadHash}|${sealId}|${issuedAt}`);
    const meaning = SIGNATURE_MEANINGS[ctx.signatureMeaning] ? ctx.signatureMeaning : 'REVIEW_APPROVAL';

    const complianceSeal = {
      sealId,
      issuedAt,
      sampleId: sample.sampleId,
      payloadHash,
      status: evaluation.status,
      disposition: evaluation.disposition,
      tenant: license.tenant,
      licenseId: license.licenseId,
      frameworks: FRAMEWORKS,
      signatureManifestation: { printedName: op.printedName, userId: op.userId, meaning, meaningLabel: SIGNATURE_MEANINGS[meaning], signedAt: issuedAt },
      auditTrail: { sequence, previousHash, chainHash, sourceSystem: ctx.sourceSystem || 'UNKNOWN', requestId },
      timeSource: 'Relógio do servidor (em produção: NTP + carimbo de tempo RFC 3161)'
    };
    const signature = await sign(complianceSeal);
    state.ledger.push({ sequence, sealId, issuedAt, sampleId: sample.sampleId, status: evaluation.status, disposition: evaluation.disposition, payloadHash, previousHash, chainHash, signer: op.userId });

    const body = {
      requestId,
      tier: 'ENTERPRISE',
      regulatoryValidity: true,
      evaluation,
      integrity: { algorithm: 'SHA-256', canonicalization: 'OOT-C14N/1 (inspirada no RFC 8785)', payloadHash },
      signature,
      complianceSeal
    };
    if (idemKey) state.idempotency.set(idemKey, body);
    return json(200, body, { ...base, 'X-OOT-Tier': 'ENTERPRISE' });
  }

  async function sign(seal) {
    if (!state.keyPair) {
      return { algorithm: 'NONE', keyId: null, value: null, note: 'Web Crypto indisponível nesta página; em produção a assinatura ES256 é feita em HSM/KMS.' };
    }
    const raw = await Integrity.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, state.keyPair.privateKey, Integrity.utf8(Integrity.canonicalize(seal)));
    return { algorithm: 'ES256', keyId: state.keyId, signedPayload: 'complianceSeal canonicalizado (OOT-C14N/1)', value: Integrity.b64url(new Uint8Array(raw)), jwksUrl: `${BASE_URL}/.well-known/jwks.json` };
  }

  function jwks() {
    const k = state.publicJwk;
    const keys = k ? [{ kty: k.kty, crv: k.crv, x: k.x, y: k.y, kid: state.keyId, use: 'sig', alg: 'ES256' }] : [];
    return json(200, { keys }, { 'Cache-Control': 'public, max-age=3600' });
  }

  function ledger(request) {
    const { license } = licenseOf(request);
    if (!license) return json(402, { error: { code: 'OOT-402-COMMERCIAL_USE_LIMITATION', message: 'A trilha de auditoria é um recurso Enterprise.' } }, { 'X-OOT-Tier': 'SANDBOX' });
    return json(200, { tenant: license.tenant, entries: state.ledger }, { 'X-OOT-Tier': 'ENTERPRISE' });
  }

  /* ── Interceptador de fetch: desvia SOMENTE o tráfego do domínio da API simulada. ── */
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Requisição abortada', 'AbortError'));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
  const nativeFetch = global.fetch.bind(global);
  global.fetch = function ootMockFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof url !== 'string' || !url.startsWith(`${ORIGIN}/`)) return nativeFetch(input, init);
    const request = new Request(input, init);
    return abortable(handle(request), request.signal);
  };

  global.OpenOncoMockServer = Object.freeze({
    BASE_URL,
    API_CONTRACT,
    ledger: () => state.ledger.map((entry) => ({ ...entry }))
  });
})(window);
