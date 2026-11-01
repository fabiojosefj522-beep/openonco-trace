// Compilado com `tsc -p test/types` (noEmit). Garante que os tipos públicos cobrem o uso real.
import OpenOncoSDKDefault, { OpenOncoSDK, Rules, type OpenOncoSample, type SubmitResult } from '@openonco/sdk';
import { OncoBadge } from '@openonco/badge';

const sample: OpenOncoSample = {
  schemaVersion: '1.0.0',
  sampleId: 'SMP-2026-TYP001',
  patientId: 'PT-BR-000001',
  therapyOrder: { orderId: 'ORD-TYPE0001', therapyType: 'CAR_T_AUTOLOGOUS', patientId: 'PT-BR-000001' },
  biopsyType: 'LEUKAPHERESIS_FRESH',
  sensorTemp: { sensorId: 'LOG-TYP-0001', currentC: 4.5, minObservedC: 4, maxObservedC: 5, excursionMinutes: 0, recordedAt: '2026-11-01T12:00:00Z' },
  qualityControl: { cellViabilityPct: 90 },
  chainOfCustody: [{ step: 'COLLECTION', timestamp: '2026-11-01T10:00:00Z', actor: 'enf.x', location: 'Centro X' }]
};

const sdk: OpenOncoSDK = new OpenOncoSDKDefault({ endpoint: 'https://bff.exemplo/openonco', operator: { userId: 'u1', printedName: 'Nome' } });
sdk.addEventListener('oot:mode', (e) => { const mode: 'SANDBOX' | 'PENDING' | 'ENTERPRISE' = e.detail.mode; void mode; });
sdk.addEventListener('oot:result', (e) => { const r: SubmitResult = e.detail.result; void r; });
const rec = sdk.track(sample);
const status: 'VERIFIED' | 'WARNING' | 'CRITICAL' = Rules.assess(rec.sample).status;
void status;

async function fluxo(): Promise<void> {
  const result = await sdk.submit(rec.sampleId, { signatureMeaning: 'REVIEW_APPROVAL' });
  if (result.mode === 'ENTERPRISE') {
    const seal: string = result.receipt.complianceSeal.sealId;
    const v = await sdk.verifyReceipt(result.sample, result.receipt);
    const ok: boolean = v.valid;
    void seal; void ok;
  } else if (result.mode === 'SANDBOX') {
    const reason: 'MISSING_API_KEY' | 'INVALID_API_KEY' = result.alert.reason;
    void reason;
  }
}
void fluxo;

const badge = document.querySelector('onco-badge');
if (badge) {
  const typed: OncoBadge = badge;
  typed.sdk = sdk;
  typed.sampleId = rec.sampleId;
  typed.addEventListener('oot-validated', (e) => { const mode: string = e.detail.mode; void mode; });
}

// @ts-expect-error biopsyType fora do enum gerado do schema
const invalido: OpenOncoSample['biopsyType'] = 'SALIVA';
void invalido;
