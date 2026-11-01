/* =============================================================================
 * PARTE A, OPEN SOURCE: @openonco/sdk          SPDX-License-Identifier: Apache-2.0
 * Zero dependências. Roda em navegadores modernos e WebViews corporativas.
 * ===========================================================================*/
(function (global) {
  'use strict';

  const VERSION = '1.0.0';
  const SCHEMA_VERSION = '1.0.0';
  const RULES_VERSION = '2026.11.0';
  // Domínio reservado para documentação (RFC 2606): nunca resolve na internet real.
  const DEFAULT_ENDPOINT = 'https://api.openonco-trace.example/v1';
  const SANDBOX_NOTICE = 'MODO SANDBOX (SEM VALIDADE REGULATÓRIA)';

  const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const round2 = (n) => Math.round(n * 100) / 100;
  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

  /* ─────────────────────────── A.1 JSON SCHEMA ───────────────────────────────
   * Contrato de dados da amostra. É a fonte única da verdade: o SDK valida no
   * cliente, o servidor revalida, e a documentação da página é gerada daqui. */
  const PSEUDONYM = '^PT-[A-Z]{2}-[0-9]{6}$';
  const SAMPLE_SCHEMA = deepFreeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://schemas.openonco-trace.example/v1/sample.schema.json',
    title: 'OpenOncoSample',
    description: 'Amostra biológica rastreável para terapias personalizadas contra o câncer (CAR-T autólogo e vacinas de mRNA com neoantígenos).',
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'sampleId', 'patientId', 'therapyOrder', 'biopsyType', 'sensorTemp', 'chainOfCustody'],
    properties: {
      schemaVersion: { const: SCHEMA_VERSION, description: 'Versão do contrato de dados (SemVer).' },
      sampleId: { type: 'string', pattern: '^SMP-[0-9]{4}-[A-Z0-9]{6}$', description: 'ID único da amostra; em produção, mapeado da etiqueta ISBT 128 ou GS1.' },
      patientId: { type: 'string', pattern: PSEUDONYM, description: 'Pseudônimo do paciente lido na etiqueta (cadeia de identidade). Nunca nome, CPF ou prontuário (LGPD/HIPAA).' },
      therapyOrder: {
        type: 'object',
        additionalProperties: false,
        required: ['orderId', 'therapyType', 'patientId'],
        description: 'Ordem de manufatura à qual a amostra precisa pertencer.',
        properties: {
          orderId: { type: 'string', pattern: '^ORD-[A-Z0-9]{8}$' },
          therapyType: { enum: ['CAR_T_AUTOLOGOUS', 'MRNA_NEOANTIGEN_VACCINE'] },
          patientId: { type: 'string', pattern: PSEUDONYM, description: 'Pseudônimo na ordem; tem de coincidir com patientId (COI).' }
        }
      },
      biopsyType: {
        enum: ['LEUKAPHERESIS_FRESH', 'LEUKAPHERESIS_CRYO', 'TUMOR_FRESH_FROZEN', 'TUMOR_FFPE'],
        description: 'Material coletado: biópsia tumoral (pipeline de neoantígenos para mRNA) ou material de partida por aférese (CAR-T).'
      },
      sensorTemp: {
        type: 'object',
        additionalProperties: false,
        required: ['sensorId', 'currentC', 'minObservedC', 'maxObservedC', 'excursionMinutes', 'recordedAt'],
        description: 'Última leitura do data logger da embalagem.',
        properties: {
          sensorId: { type: 'string', pattern: '^LOG-[A-Z0-9-]{4,24}$' },
          currentC: { type: 'number', minimum: -200, maximum: 60 },
          minObservedC: { type: 'number', minimum: -200, maximum: 60 },
          maxObservedC: { type: 'number', minimum: -200, maximum: 60 },
          excursionMinutes: { type: 'number', minimum: 0, description: 'Minutos acumulados fora da faixa, calculados pelo logger.' },
          recordedAt: { type: 'string', format: 'date-time' }
        }
      },
      qualityControl: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cellViabilityPct: { type: 'number', minimum: 0, maximum: 100, description: 'Viabilidade celular (material de aférese).' },
          tumorContentPct: { type: 'number', minimum: 0, maximum: 100, description: 'Conteúdo tumoral estimado pela patologia (biópsias).' }
        }
      },
      chainOfCustody: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: { $ref: '#/$defs/custodyEvent' },
        description: 'Eventos de custódia em ordem cronológica, começando pela coleta.'
      }
    },
    allOf: [
      {
        if: { required: ['biopsyType'], properties: { biopsyType: { enum: ['LEUKAPHERESIS_FRESH', 'LEUKAPHERESIS_CRYO'] } } },
        then: { required: ['qualityControl'], properties: { qualityControl: { required: ['cellViabilityPct'] } } }
      },
      {
        if: { required: ['biopsyType'], properties: { biopsyType: { enum: ['TUMOR_FRESH_FROZEN', 'TUMOR_FFPE'] } } },
        then: { required: ['qualityControl'], properties: { qualityControl: { required: ['tumorContentPct'] } } }
      }
    ],
    $defs: {
      custodyEvent: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'timestamp', 'actor', 'location'],
        properties: {
          step: { enum: ['COLLECTION', 'PACKAGING', 'COURIER_PICKUP', 'IN_TRANSIT', 'HUB_HANDOFF', 'RECEIVED_AT_MANUFACTURING', 'RECEIVED_AT_SEQUENCING_LAB'] },
          timestamp: { type: 'string', format: 'date-time' },
          actor: { type: 'string', minLength: 3, maxLength: 80, description: 'Usuário ou sistema responsável (ALCOA+: atribuível).' },
          location: { type: 'string', minLength: 3, maxLength: 120 }
        }
      }
    }
  });

  /* ──────────────── A.2 VALIDADOR JSON SCHEMA MÍNIMO (sem dependências) ──────
   * Suporta o subconjunto usado acima: type, enum, const, required, properties,
   * additionalProperties:false, pattern, format:date-time, min/maxLength,
   * minimum/maximum, items, min/maxItems, $ref local, allOf, if/then/else.
   * Em projetos maiores, troque por Ajv mantendo a mesma interface. */
  const SchemaValidator = (() => {
    const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
    const TYPE_CHECKS = {
      string: (v) => typeof v === 'string',
      number: isNum,
      integer: (v) => Number.isInteger(v),
      boolean: (v) => typeof v === 'boolean',
      object: isObject,
      array: Array.isArray,
      null: (v) => v === null
    };

    function resolveRef(root, ref) {
      if (!ref.startsWith('#/')) throw new Error(`$ref externo não suportado: ${ref}`);
      const node = ref.slice(2).split('/').reduce((n, key) => (n == null ? n : n[key.replace(/~1/g, '/').replace(/~0/g, '~')]), root);
      if (!node) throw new Error(`$ref não encontrado: ${ref}`);
      return node;
    }

    function walk(schema, data, root, path, out) {
      const fail = (keyword, message, at = path) => out.push({ path: at, keyword, message });

      if (schema.$ref) walk(resolveRef(root, schema.$ref), data, root, path, out);
      if (schema.allOf) schema.allOf.forEach((sub) => walk(sub, data, root, path, out));
      if (schema.if) {
        const matches = walk(schema.if, data, root, path, []).length === 0;
        if (matches && schema.then) walk(schema.then, data, root, path, out);
        if (!matches && schema.else) walk(schema.else, data, root, path, out);
      }
      if (has(schema, 'const') && JSON.stringify(data) !== JSON.stringify(schema.const)) fail('const', `deve ser ${JSON.stringify(schema.const)}`);
      if (schema.enum && !schema.enum.includes(data)) fail('enum', `valor não permitido; use ${schema.enum.join(', ')}`);

      if (schema.type) {
        const types = [].concat(schema.type);
        if (!types.some((t) => TYPE_CHECKS[t](data))) {
          const commaDecimal = types.includes('number') && typeof data === 'string' && /^-?\d+,\d+$/.test(data.trim());
          fail('type', `esperado ${types.join(' ou ')}, recebido ${kindOf(data)}${commaDecimal ? ' (use ponto como separador decimal)' : ''}`);
          return out; // com o tipo errado, as demais palavras-chave não se aplicam
        }
      }
      if (typeof data === 'string') {
        if (schema.minLength != null && data.length < schema.minLength) fail('minLength', `mínimo de ${schema.minLength} caracteres`);
        if (schema.maxLength != null && data.length > schema.maxLength) fail('maxLength', `máximo de ${schema.maxLength} caracteres`);
        if (schema.pattern && !new RegExp(schema.pattern).test(data)) fail('pattern', `formato inválido (esperado ${schema.pattern})`);
        if (schema.format === 'date-time' && !(RFC3339.test(data) && !Number.isNaN(Date.parse(data)))) fail('format', 'use data e hora RFC 3339, por exemplo 2026-11-01T14:30:00Z');
      }
      if (isNum(data)) {
        if (schema.minimum != null && data < schema.minimum) fail('minimum', `mínimo ${schema.minimum}`);
        if (schema.maximum != null && data > schema.maximum) fail('maximum', `máximo ${schema.maximum}`);
      }
      if (Array.isArray(data)) {
        if (schema.minItems != null && data.length < schema.minItems) fail('minItems', `mínimo de ${schema.minItems} item(ns)`);
        if (schema.maxItems != null && data.length > schema.maxItems) fail('maxItems', `máximo de ${schema.maxItems} itens`);
        if (schema.items) data.forEach((item, i) => walk(schema.items, item, root, `${path}[${i}]`, out));
      }
      if (isObject(data)) {
        (schema.required || []).forEach((key) => { if (!has(data, key)) fail('required', 'campo obrigatório ausente', `${path}.${key}`); });
        const props = schema.properties || {};
        Object.keys(data).forEach((key) => {
          if (has(props, key)) walk(props[key], data[key], root, `${path}.${key}`, out);
          else if (schema.additionalProperties === false) fail('additionalProperties', 'campo fora do schema; rejeitado para evitar vazamento de dados', `${path}.${key}`);
        });
      }
      return out;
    }

    return Object.freeze({
      /** Valida `data` contra `schema` (padrão: SAMPLE_SCHEMA). Lista vazia = válido. */
      validate: (data, schema = SAMPLE_SCHEMA) => walk(schema, data, schema, '$', [])
    });
  })();

  /* ─────────────── A.3 INTEGRIDADE: CANONICALIZAÇÃO + SHA-256 ─────────────── */
  const Integrity = (() => {
    const subtle = (global.crypto && global.crypto.subtle) || null;
    const encoder = new TextEncoder();
    const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    /** OOT-C14N/1: serialização canônica inspirada no RFC 8785 (JCS). Chaves ordenadas,
     *  sem espaços, números no formato do ECMAScript. O mesmo dado lógico sempre gera
     *  os mesmos bytes, logo o mesmo hash, no cliente e no servidor. */
    function canonicalize(value) {
      if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Número não finito não pode ser canonicalizado.');
        return JSON.stringify(value);
      }
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
      return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
    }

    /* SHA-256 em JS puro (FIPS 180-4), usado quando a Web Crypto API não existe:
       por exemplo, página servida por HTTP sem TLS fora de localhost. */
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    function sha256HexSync(input) {
      const bytes = typeof input === 'string' ? encoder.encode(input) : input;
      const total = ((bytes.length + 9 + 63) >> 6) << 6;          // múltiplo de 64 bytes
      const buf = new Uint8Array(total);
      buf.set(bytes);
      buf[bytes.length] = 0x80;
      const view = new DataView(buf.buffer);
      const bits = bytes.length * 8;
      view.setUint32(total - 8, Math.floor(bits / 0x100000000));
      view.setUint32(total - 4, bits >>> 0);
      const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
      const W = new Uint32Array(64);
      for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
          const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
          const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
          h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
      }
      return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
    }

    async function sha256Hex(text) {
      const bytes = encoder.encode(text);
      if (subtle) return toHex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
      return sha256HexSync(bytes);
    }

    const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const b64urlDecode = (str) => {
      const s = str.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
      return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    };
    const randomBytes = (n) => global.crypto.getRandomValues(new Uint8Array(n));
    function uuid() {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
      const b = randomBytes(16);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = toHex(b);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }

    return Object.freeze({
      subtle, hasWebCrypto: !!subtle, canonicalize, sha256Hex, sha256HexSync,
      b64url, b64urlDecode, uuid, randomHex: (n) => toHex(randomBytes(n)), utf8: (s) => encoder.encode(s)
    });
  })();

  /* ──────────────────────────── A.4 MOTOR DE REGRAS ──────────────────────────
   * ATENÇÃO: valores ILUSTRATIVOS. Em produção, cada perfil vem do protocolo
   * validado do produto, versionado e aprovado pelo QA (controle de mudanças). */
  const THERMAL_PROFILES = deepFreeze({
    LEUKAPHERESIS_FRESH: { label: 'Leucaférese fresca (CAR-T)', therapy: 'CAR_T_AUTOLOGOUS', minC: 2, maxC: 8, warnMarginC: 0.5, criticalDeltaC: 2, maxExcursionMin: 30, maxTransitHours: 48, qc: { field: 'cellViabilityPct', min: 70, label: 'Viabilidade celular' } },
    LEUKAPHERESIS_CRYO: { label: 'Leucaférese criopreservada (CAR-T)', therapy: 'CAR_T_AUTOLOGOUS', minC: -196, maxC: -150, warnMarginC: 5, criticalDeltaC: 15, maxExcursionMin: 10, maxTransitHours: 240, qc: { field: 'cellViabilityPct', min: 70, label: 'Viabilidade celular' } },
    TUMOR_FRESH_FROZEN: { label: 'Biópsia tumoral congelada (mRNA)', therapy: 'MRNA_NEOANTIGEN_VACCINE', minC: -90, maxC: -60, warnMarginC: 5, criticalDeltaC: 10, maxExcursionMin: 15, maxTransitHours: 96, qc: { field: 'tumorContentPct', min: 20, label: 'Conteúdo tumoral' } },
    TUMOR_FFPE: { label: 'Biópsia tumoral FFPE (mRNA)', therapy: 'MRNA_NEOANTIGEN_VACCINE', minC: 15, maxC: 25, warnMarginC: 1, criticalDeltaC: 10, maxExcursionMin: 240, maxTransitHours: 336, qc: { field: 'tumorContentPct', min: 20, label: 'Conteúdo tumoral' } }
  });
  const STEP_LABEL = deepFreeze({ COLLECTION: 'Coleta', PACKAGING: 'Embalagem', COURIER_PICKUP: 'Retirada', IN_TRANSIT: 'Trânsito', HUB_HANDOFF: 'Hub', RECEIVED_AT_MANUFACTURING: 'Manufatura', RECEIVED_AT_SEQUENCING_LAB: 'Sequenciamento' });
  const STATUS_LABEL = deepFreeze({ VERIFIED: 'verificado', WARNING: 'atenção térmica', CRITICAL: 'crítico' });
  const DISPOSITION = deepFreeze({ VERIFIED: 'RELEASE_FOR_PROCESSING', WARNING: 'QUARANTINE_QA_REVIEW', CRITICAL: 'REJECT_DO_NOT_PROCESS' });
  const DISPOSITION_LABEL = deepFreeze({ RELEASE_FOR_PROCESSING: 'Apta para processamento', QUARANTINE_QA_REVIEW: 'Quarentena para revisão de QA', REJECT_DO_NOT_PROCESS: 'Rejeitada, não processar' });

  const Rules = (() => {
    const CLOCK_SKEW_MS = 5 * 60 * 1000;
    const STALE_TELEMETRY_MIN = 15;
    const fmt = (n) => String(round2(n)).replace('.', ',');

    /** Avalia uma amostra JÁ válida no schema. `now` é injetável para testes e para o servidor. */
    function evaluate(sample, now = Date.now()) {
      const findings = [];
      const add = (severity, category, code, message) => findings.push({ severity, category, code, message });
      const p = THERMAL_PROFILES[sample.biopsyType];
      const order = sample.therapyOrder;

      // 1) Cadeia de identidade (COI): a amostra pertence ao paciente da ordem?
      if (sample.patientId !== order.patientId) add('CRITICAL', 'PATIENT', 'COI_MISMATCH', `Cadeia de identidade rompida: a etiqueta traz ${sample.patientId}, mas a ordem ${order.orderId} é de ${order.patientId}.`);
      if (p.therapy !== order.therapyType) add('CRITICAL', 'PATIENT', 'MATERIAL_THERAPY_MISMATCH', `${p.label} não serve para a terapia ${order.therapyType}.`);

      // 2) Térmico: leitura atual + mínimo e máximo registrados pelo data logger
      const t = sample.sensorTemp;
      const range = `${fmt(p.minC)} a ${fmt(p.maxC)} °C`;
      const deviation = round2(Math.max(0, p.minC - Math.min(t.currentC, t.minObservedC), Math.max(t.currentC, t.maxObservedC) - p.maxC));
      if (deviation > p.criticalDeltaC || t.excursionMinutes > p.maxExcursionMin) {
        add('CRITICAL', 'VIABILITY', 'THERMAL_CRITICAL', `Excursão térmica crítica: ${fmt(deviation)} °C além da faixa de ${range}, com ${fmt(t.excursionMinutes)} min acumulados. Viabilidade comprometida.`);
      } else if (deviation > 0 || t.excursionMinutes > 0) {
        add('WARNING', 'THERMAL', 'THERMAL_EXCURSION', `Excursão térmica registrada: pico de ${fmt(deviation)} °C além da faixa de ${range}, por ${fmt(t.excursionMinutes)} min. Requer avaliação de QA.`);
      } else if (t.currentC - p.minC < p.warnMarginC || p.maxC - t.currentC < p.warnMarginC) {
        add('WARNING', 'THERMAL', 'THERMAL_NEAR_LIMIT', `Temperatura de ${fmt(t.currentC)} °C perto do limite da faixa de ${range}.`);
      }
      const staleMin = (now - Date.parse(t.recordedAt)) / 60000;
      if (staleMin > STALE_TELEMETRY_MIN) add('WARNING', 'THERMAL', 'TELEMETRY_STALE', `Sem leitura do data logger há ${Math.round(staleMin)} min: temperatura atual desconhecida.`);

      // 3) Viabilidade e QC do material
      const qcValue = sample.qualityControl && sample.qualityControl[p.qc.field];
      if (isNum(qcValue) && qcValue < p.qc.min) add('CRITICAL', 'VIABILITY', 'QC_BELOW_MIN', `${p.qc.label} de ${fmt(qcValue)}% abaixo do mínimo de ${p.qc.min}%.`);

      // 4) Cadeia de custódia (COC): começa na coleta, é cronológica e não tem carimbo no futuro
      const events = sample.chainOfCustody;
      if (events[0].step !== 'COLLECTION') add('CRITICAL', 'CUSTODY', 'CUSTODY_START_INVALID', 'A cadeia de custódia precisa começar pelo evento COLLECTION.');
      let latest = -Infinity;
      events.forEach((ev, i) => {
        const ts = Date.parse(ev.timestamp);
        if (ts > now + CLOCK_SKEW_MS) add('CRITICAL', 'CUSTODY', 'CUSTODY_FUTURE_TIMESTAMP', `Evento ${i + 1} (${ev.step}) tem carimbo de tempo no futuro.`);
        if (ts < latest) add('CRITICAL', 'CUSTODY', 'CUSTODY_OUT_OF_ORDER', `Evento ${i + 1} (${ev.step}) está fora de ordem cronológica.`);
        latest = Math.max(latest, ts);
      });

      // 5) Janela de estabilidade: da coleta ao recebimento (ou até agora, se em trânsito)
      const collected = events.find((ev) => ev.step === 'COLLECTION');
      const received = events.find((ev) => ev.step.startsWith('RECEIVED_AT_'));
      const elapsedHours = collected ? ((received ? Date.parse(received.timestamp) : now) - Date.parse(collected.timestamp)) / 3.6e6 : null;
      if (elapsedHours != null && elapsedHours > p.maxTransitHours) add('CRITICAL', 'VIABILITY', 'STABILITY_WINDOW_EXCEEDED', `Janela de estabilidade excedida: ${fmt(elapsedHours)} h desde a coleta (máximo de ${p.maxTransitHours} h).`);

      const status = findings.some((f) => f.severity === 'CRITICAL') ? 'CRITICAL' : findings.length ? 'WARNING' : 'VERIFIED';
      return {
        status, disposition: DISPOSITION[status], schemaValid: true, findings,
        metrics: { deviationC: deviation, elapsedHours: elapsedHours == null ? null : round2(elapsedHours), windowHours: p.maxTransitHours },
        evaluatedAt: new Date(now).toISOString(), rulesVersion: RULES_VERSION
      };
    }

    function fromSchemaErrors(errors, now = Date.now()) {
      return {
        status: 'CRITICAL', disposition: DISPOSITION.CRITICAL, schemaValid: false,
        findings: errors.map((e) => ({ severity: 'CRITICAL', category: 'SCHEMA', code: `SCHEMA_${e.keyword.toUpperCase()}`, message: `${e.path}: ${e.message}` })),
        metrics: null, evaluatedAt: new Date(now).toISOString(), rulesVersion: RULES_VERSION
      };
    }

    /** Avaliação segura: schema primeiro, regras só se o schema passar. */
    function assess(sample, now = Date.now()) {
      const errors = SchemaValidator.validate(sample);
      return errors.length ? fromSchemaErrors(errors, now) : evaluate(sample, now);
    }

    return Object.freeze({ evaluate, assess, fromSchemaErrors });
  })();

  /* ──────────────────────────── A.5 OpenOncoSDK ──────────────────────────────
   * Fluxo: capture() → validação local de schema → regras locais → fetch → contrato.
   * Também é o "store" em tempo real: cada amostra rastreada vira um registro que
   * recebe telemetria e notifica as views (<onco-badge>) por eventos.
   *
   * Eventos (CustomEvent, detail entre chaves):
   *   oot:update  {sampleId, source}   registro mudou (track, telemetry, request, result)
   *   oot:result  {sampleId, result}   resposta interpretada de um envio
   *   oot:mode    {mode, reason}       SANDBOX | PENDING | ENTERPRISE
   *   oot:sandbox {reason, notice}     aviso de envio sem validade regulatória
   *   oot:log     {at, level, message} trilha legível para o host */
  const sampleKey = (s) => (s && typeof s.sampleId === 'string' && s.sampleId) || 'SEM-ID';
  const maskKey = (k) => (k.length <= 6 ? '***' : `${k.slice(0, 4)}…${k.slice(-2)}`);
  const deepTrim = (v) => {
    if (typeof v === 'string') return v.trim();
    if (Array.isArray(v)) return v.map(deepTrim);
    if (v && typeof v === 'object') return Object.keys(v).reduce((o, k) => { o[k] = deepTrim(v[k]); return o; }, {});
    return v;
  };
  const levelFor = (status) => (status === 'VERIFIED' ? 'ok' : status === 'WARNING' ? 'warn' : 'error');

  class OpenOncoSDK extends EventTarget {
    static VERSION = VERSION;
    static SANDBOX_NOTICE = SANDBOX_NOTICE;
    static #shared = null;

    /** Instância compartilhada em modo sandbox, usada pelo <onco-badge> declarativo. */
    static shared(options) {
      if (!OpenOncoSDK.#shared) OpenOncoSDK.#shared = new OpenOncoSDK(options);
      return OpenOncoSDK.#shared;
    }

    #endpoint; #apiKey = null; #operator; #sourceSystem; #timeoutMs; #debug;
    #mode = 'SANDBOX'; #modeReason = 'MISSING_API_KEY';
    #records = new Map();
    #logBuffer = [];
    #jwks = null;

    /**
     * @param {object}  [o]
     * @param {string}  [o.endpoint]     URL base da API ou do BFF/proxy do host
     * @param {string}  [o.apiKey]       chave Enterprise; ausente = modo sandbox
     * @param {{userId:string, printedName:string}} [o.operator] usuário logado no host (21 CFR 11.50)
     * @param {string}  [o.sourceSystem] SAP | VEEVA | WMS | WEB
     * @param {number}  [o.timeoutMs]
     * @param {boolean} [o.debug]        espelha todo o log no console
     */
    constructor({ endpoint = DEFAULT_ENDPOINT, apiKey = null, operator = null, sourceSystem = 'WEB', timeoutMs = 8000, debug = false } = {}) {
      super();
      this.#endpoint = String(endpoint).replace(/\/+$/, '');
      this.#operator = operator;
      this.#sourceSystem = sourceSystem;
      this.#timeoutMs = timeoutMs;
      this.#debug = debug;
      this.setApiKey(apiKey, { silent: true });
      this.#log('info', `SDK ${VERSION} pronto. Endpoint ${this.#endpoint}, modo ${this.#mode === 'SANDBOX' ? 'sandbox' : 'Enterprise com chave a verificar'}.`);
    }

    get mode() { return this.#mode; }
    get modeReason() { return this.#modeReason; }
    get endpoint() { return this.#endpoint; }
    /** Últimas entradas de log (para hosts que se inscrevem depois da criação). */
    get logs() { return this.#logBuffer.slice(); }

    setApiKey(key, { silent = false } = {}) {
      this.#apiKey = typeof key === 'string' && key.trim() ? key.trim() : null;
      this.#setMode(this.#apiKey ? 'PENDING' : 'SANDBOX', this.#apiKey ? 'KEY_NOT_VERIFIED' : 'MISSING_API_KEY');
      if (!silent) {
        this.#log('info', this.#apiKey
          ? `API Key definida (${maskKey(this.#apiKey)}). Ela será verificada no próximo envio.`
          : `API Key removida. Os próximos envios seguem em ${SANDBOX_NOTICE}.`);
      }
    }

    /** Captura: clona a entrada, apara espaços e completa a versão do schema. Nunca
     *  converte tipos em silêncio (ALCOA+: o dado registrado é o dado original). */
    capture(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('capture(): a amostra precisa ser um objeto JSON.');
      const sample = deepTrim(input);
      if (sample.schemaVersion === undefined) sample.schemaVersion = SCHEMA_VERSION;
      return sample;
    }

    validateSchema(sample) {
      const errors = SchemaValidator.validate(sample);
      return { valid: errors.length === 0, errors };
    }

    /** Pré-validação local e offline: schema + regras abertas. */
    evaluate(sample, now = Date.now()) { return Rules.assess(sample, now); }

    /** Passa a rastrear uma amostra. Devolve o registro vivo (trate como somente leitura). */
    track(input) {
      const sample = this.capture(input);
      const sampleId = sampleKey(sample);
      const previous = this.#records.get(sampleId);
      if (previous && previous.stopTelemetry) previous.stopTelemetry();
      const rec = { sampleId, sample, evaluation: null, history: [], telemetryAt: null, lastResult: null, pending: false, stopTelemetry: null };
      rec.evaluation = this.evaluate(sample);
      if (sample.sensorTemp && isNum(sample.sensorTemp.currentC)) rec.history.push({ t: Date.now(), c: sample.sensorTemp.currentC });
      this.#records.set(sampleId, rec);
      const ev = rec.evaluation;
      this.#log(levelFor(ev.status), ev.schemaValid
        ? `Amostra ${sampleId} capturada. Schema válido; pré-validação local: ${STATUS_LABEL[ev.status]}.`
        : `Amostra ${sampleId} capturada com ${ev.findings.length} violação(ões) de schema. Ela não será enviada.`);
      this.#emit('oot:update', { sampleId, source: 'track' });
      return rec;
    }

    untrack(sampleId) {
      const rec = this.#records.get(sampleId);
      if (!rec) return false;
      if (rec.stopTelemetry) rec.stopTelemetry();
      this.#records.delete(sampleId);
      this.#emit('oot:update', { sampleId, source: 'untrack' });
      return true;
    }

    getRecord(sampleId) { return this.#records.get(sampleId) || null; }

    /** Recebe uma leitura do data logger, revalida e reavalia o registro em tempo real. */
    ingestTelemetry(sampleId, reading) {
      const rec = this.#records.get(sampleId);
      if (!rec) return null;
      const errors = SchemaValidator.validate(reading, SAMPLE_SCHEMA.properties.sensorTemp);
      if (errors.length) {
        this.#log('error', `Leitura de telemetria descartada (${errors[0].path}: ${errors[0].message}).`);
        return null;
      }
      const before = rec.evaluation.status;
      rec.sample.sensorTemp = clone(reading);
      rec.telemetryAt = Date.now();
      rec.history.push({ t: rec.telemetryAt, c: reading.currentC });
      if (rec.history.length > 120) rec.history.splice(0, rec.history.length - 120);
      rec.evaluation = this.evaluate(rec.sample);
      const after = rec.evaluation.status;
      if (after !== before) {
        this.#log(levelFor(after), `Status de ${sampleId} mudou de ${STATUS_LABEL[before]} para ${STATUS_LABEL[after]} com a leitura de ${String(reading.currentC).replace('.', ',')} °C.`);
      }
      this.#emit('oot:update', { sampleId, source: 'telemetry' });
      return rec;
    }

    /** Conecta uma fonte de telemetria: `source(emit)` passa a chamar emit(leitura) e
     *  devolve a função que encerra a assinatura. Em produção: SSE, WebSocket ou MQTT. */
    connectTelemetry(sampleId, source) {
      const rec = this.#records.get(sampleId);
      if (!rec) throw new Error(`connectTelemetry(): a amostra ${sampleId} não está sendo rastreada.`);
      if (rec.stopTelemetry) rec.stopTelemetry();
      const stop = source((reading) => this.ingestTelemetry(sampleId, reading));
      rec.stopTelemetry = () => {
        if (typeof stop === 'function') stop();
        rec.stopTelemetry = null;
        this.#log('info', `Telemetria de ${sampleId} desconectada.`);
      };
      this.#log('info', `Telemetria de ${sampleId} conectada.`);
      return rec.stopTelemetry;
    }

    /**
     * Envia a amostra para validação. `target` = sampleId rastreado ou objeto de amostra.
     * Nunca lança por erro de negócio: o resultado sempre diz o modo e o estágio.
     *   mode:  ENTERPRISE | SANDBOX | LOCAL | OFFLINE
     *   stage: SEALED | SEAL_INVALID | SANDBOX | SCHEMA | NETWORK | HTTP_ERROR
     */
    async submit(target, { signatureMeaning = 'REVIEW_APPROVAL' } = {}) {
      const rec = typeof target === 'string' ? this.#records.get(target) : null;
      if (typeof target === 'string' && !rec) throw new Error(`submit(): a amostra ${target} não está sendo rastreada.`);
      const sample = rec ? clone(rec.sample) : this.capture(target);
      const sampleId = sampleKey(sample);
      const local = this.evaluate(sample);
      const url = `${this.#endpoint}/custody/validate`;

      const finish = (result) => {
        if (rec) { rec.pending = false; rec.lastResult = result; }
        this.#emit('oot:result', { sampleId, result });
        if (rec) this.#emit('oot:update', { sampleId, source: 'result' });
        return result;
      };

      // 1) Fail-fast: payload fora do schema não sai do navegador.
      if (!local.schemaValid) {
        this.#log('error', `Envio de ${sampleId} bloqueado: ${local.findings.length} violação(ões) de schema.`);
        return finish({ ok: false, mode: 'LOCAL', stage: 'SCHEMA', regulatoryValidity: false, status: local.status, findings: local.findings, evaluation: local, sample, http: null });
      }

      // 2) Sem chave: avisa ANTES de enviar que o envio é sandbox.
      if (!this.#apiKey) this.#warnSandbox('MISSING_API_KEY');

      if (rec) { rec.pending = true; this.#emit('oot:update', { sampleId, source: 'request' }); }
      const idempotencyKey = Integrity.uuid();
      this.#log('info', `POST /custody/validate para ${sampleId} (Idempotency-Key ${idempotencyKey.slice(0, 8)}…).`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      const started = performance.now();
      let res;
      let body = null;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-OOT-SDK': `openonco-sdk-js/${VERSION}`,
            ...(this.#apiKey ? { 'X-API-Key': this.#apiKey } : {})
          },
          body: JSON.stringify({
            sample,
            context: { operator: this.#operator, sourceSystem: this.#sourceSystem, signatureMeaning, clientEvaluation: { status: local.status, rulesVersion: RULES_VERSION } }
          }),
          signal: controller.signal
        });
        body = await res.json().catch(() => null);
      } catch (err) {
        const reason = err && err.name === 'AbortError' ? `tempo limite de ${this.#timeoutMs} ms` : (err && err.message) || String(err);
        this.#log('error', `Sem resposta da API (${reason}). Resultado apenas local, sem validade regulatória.`);
        return finish({ ok: false, mode: 'OFFLINE', stage: 'NETWORK', regulatoryValidity: false, status: local.status, findings: local.findings, evaluation: local, error: reason, sample, http: null });
      } finally {
        clearTimeout(timer);
      }

      const http = {
        method: 'POST', url, status: res.status, statusText: res.statusText,
        latencyMs: Math.round(performance.now() - started), headers: Object.fromEntries(res.headers.entries())
      };

      // 3) Interpretação do contrato (ver API_CONTRACT na Parte Z).
      if (res.status === 200 && body && body.tier === 'ENTERPRISE') {
        this.#setMode('ENTERPRISE', 'LICENSE_VALID');
        const receipt = { integrity: body.integrity, complianceSeal: body.complianceSeal, signature: body.signature };
        // Defesa em profundidade: o SDK confere o selo antes de confiar nele.
        const verification = await this.verifyReceipt(sample, receipt, { quiet: true });
        const sealOk = verification.valid;
        const decision = DISPOSITION_LABEL[body.evaluation.disposition] || body.evaluation.disposition;
        this.#log(sealOk ? 'ok' : 'error', sealOk
          ? `HTTP 200 Enterprise. Selo ${receipt.complianceSeal.sealId}, SHA-256 ${receipt.integrity.payloadHash.slice(0, 12)}…, decisão: ${decision.toLowerCase()}. Selo conferido pelo SDK.`
          : `HTTP 200, mas o selo ${receipt.complianceSeal.sealId} NÃO passou na verificação do SDK. Trate o resultado como não confiável.`);
        return finish({
          ok: sealOk, mode: 'ENTERPRISE', stage: sealOk ? 'SEALED' : 'SEAL_INVALID', regulatoryValidity: sealOk,
          status: body.evaluation.status, disposition: body.evaluation.disposition, findings: body.evaluation.findings,
          evaluation: body.evaluation, receipt, verification, response: body, sample, http,
          error: sealOk ? null : 'O selo recebido não confere'
        });
      }

      if (res.status === 402) {
        const alert = (body && body.alert) || { code: 'OOT-402-COMMERCIAL_USE_LIMITATION', reason: this.#apiKey ? 'INVALID_API_KEY' : 'MISSING_API_KEY', title: 'Limitação de uso comercial' };
        this.#setMode('SANDBOX', alert.reason);
        if (alert.reason !== 'MISSING_API_KEY') this.#warnSandbox(alert.reason); // ausência de chave já foi avisada antes do envio
        const quota = (body && body.quota) || null;
        this.#log('warn', `HTTP 402 ${alert.code}: ${alert.title}.${quota ? ` Cota sandbox: ${quota.remaining} de ${quota.limit} restantes.` : ''}`);
        const ev = (body && body.evaluation) || local;
        return finish({
          ok: true, mode: 'SANDBOX', stage: 'SANDBOX', regulatoryValidity: false, notice: SANDBOX_NOTICE,
          status: ev.status, findings: ev.findings, evaluation: ev, alert, quota, response: body, sample, http
        });
      }

      const code = (body && body.error && body.error.code) || `HTTP_${res.status}`;
      const message = (body && body.error && body.error.message) || res.statusText;
      this.#log('error', `HTTP ${res.status} ${code}: ${message}`);
      return finish({ ok: false, mode: this.#mode, stage: 'HTTP_ERROR', regulatoryValidity: false, status: local.status, findings: local.findings, evaluation: local, error: `${code}: ${message}`, response: body, sample, http });
    }

    /**
     * Verificação ABERTA de um recibo Enterprise; não consome licença.
     * 1) recalcula o SHA-256 do payload  2) confere o vínculo selo/hash (21 CFR 11.70)
     * 3) confere a assinatura ES256 do selo com a chave pública publicada no JWKS.
     */
    async verifyReceipt(sampleInput, receipt, { quiet = false } = {}) {
      if (!receipt || !receipt.integrity || !receipt.complianceSeal) throw new TypeError('verifyReceipt(): informe o recibo Enterprise (integrity, complianceSeal, signature).');
      const sample = this.capture(sampleInput);
      const localHash = await Integrity.sha256Hex(Integrity.canonicalize(sample));
      const checks = [
        { id: 'PAYLOAD_HASH', label: 'Hash SHA-256 do payload, recalculado localmente', ok: localHash === receipt.integrity.payloadHash, expected: receipt.integrity.payloadHash, actual: localHash },
        { id: 'SEAL_BINDING', label: 'Selo vinculado ao mesmo hash (21 CFR 11.70)', ok: receipt.complianceSeal.payloadHash === receipt.integrity.payloadHash },
        await this.#verifySignature(receipt)
      ];
      const failed = checks.filter((c) => c.ok === false).map((c) => c.id);
      const result = { valid: failed.length === 0, checks, signature: checks[2].ok, verifiedAt: new Date().toISOString() };
      if (!quiet) {
        const sealId = receipt.complianceSeal.sealId;
        const why = failed.includes('PAYLOAD_HASH') ? 'o payload foi alterado depois do selo' : 'a assinatura do selo não confere';
        this.#log(result.valid ? 'ok' : 'error', result.valid ? `Recibo ${sealId} íntegro: hash e assinatura conferem.` : `Recibo ${sealId} não confere: ${why}.`);
      }
      return result;
    }

    /* ── internos ── */
    async #verifySignature(receipt) {
      const sig = receipt.signature;
      const check = { id: 'SIGNATURE', label: 'Assinatura ES256 do selo, com a chave pública do JWKS' };
      if (!sig || sig.algorithm !== 'ES256' || !sig.value) return { ...check, ok: null, note: 'O recibo não traz assinatura assimétrica.' };
      if (!Integrity.subtle) return { ...check, ok: null, note: 'Web Crypto indisponível nesta página (contexto não seguro).' };
      try {
        const jwk = await this.#publicKey(sig.keyId);
        if (!jwk) return { ...check, ok: false, note: `Chave ${sig.keyId} ausente do JWKS.` };
        const key = await Integrity.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const ok = await Integrity.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Integrity.b64urlDecode(sig.value), Integrity.utf8(Integrity.canonicalize(receipt.complianceSeal)));
        return { ...check, ok, note: `kid ${sig.keyId}` };
      } catch (err) {
        return { ...check, ok: false, note: `Falha ao verificar: ${err.message}` };
      }
    }

    async #publicKey(kid) {
      if (!this.#jwks) {
        const res = await fetch(`${this.#endpoint}/.well-known/jwks.json`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`JWKS respondeu HTTP ${res.status}`);
        this.#jwks = await res.json();
      }
      return (this.#jwks.keys || []).find((k) => k.kid === kid) || null;
    }

    #setMode(mode, reason) {
      if (mode === this.#mode && reason === this.#modeReason) return;
      this.#mode = mode;
      this.#modeReason = reason;
      this.#emit('oot:mode', { mode, reason });
    }

    #warnSandbox(reason) {
      const why = reason === 'INVALID_API_KEY' ? 'a API Key foi recusada pelo servidor' : 'nenhuma API Key Enterprise foi configurada';
      console.warn(
        `%c OpenOnco-Trace %c ${SANDBOX_NOTICE} `,
        'background:#FFD60A;color:#121214;font-weight:700;padding:2px 6px',
        'background:#121214;color:#FFD60A;font-weight:700;padding:2px 6px;border:1px solid #FFD60A',
        `\nO envio segue em sandbox porque ${why}. O resultado serve para desenvolvimento e integração; não pode embasar liberação de material nem decisões GxP.`
      );
      this.#log('warn', `${SANDBOX_NOTICE}: ${why}.`);
      this.#emit('oot:sandbox', { reason, notice: SANDBOX_NOTICE });
    }

    #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

    #log(level, message) {
      const entry = { at: new Date().toISOString(), level, message };
      this.#logBuffer.push(entry);
      if (this.#logBuffer.length > 200) this.#logBuffer.shift();
      this.#emit('oot:log', entry);
      if (this.#debug) console.debug(`[OpenOnco] ${message}`);
      else if (level === 'error') console.warn(`[OpenOnco] ${message}`);
    }
  }

  global.OpenOnco = Object.freeze({
    VERSION, SCHEMA_VERSION, RULES_VERSION, DEFAULT_ENDPOINT, SANDBOX_NOTICE,
    SAMPLE_SCHEMA, THERMAL_PROFILES, STEP_LABEL, STATUS_LABEL, DISPOSITION_LABEL,
    SchemaValidator, Integrity, Rules
  });
  global.OpenOncoSDK = OpenOncoSDK;
})(window);
