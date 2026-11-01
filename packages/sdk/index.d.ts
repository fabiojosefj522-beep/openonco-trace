// Tipos públicos do @openonco/sdk. Os tipos da amostra são gerados do JSON Schema (types/sample.d.ts).
import type { OpenOncoSample, SensorReading, BiopsyType, TherapyType, CustodyStep } from './types/sample';

export type { OpenOncoSample, SensorReading, BiopsyType, TherapyType, CustodyStep, CustodyEvent, TherapyOrder, QualityControl } from './types/sample';

/** VERIFIED = verde · WARNING = atenção térmica (amarelo) · CRITICAL = paciente, viabilidade, custódia ou schema (vermelho). */
export type Status = 'VERIFIED' | 'WARNING' | 'CRITICAL';
export type Disposition = 'RELEASE_FOR_PROCESSING' | 'QUARANTINE_QA_REVIEW' | 'REJECT_DO_NOT_PROCESS';
/** SANDBOX: sem chave ou chave recusada · PENDING: chave definida, ainda não confirmada · ENTERPRISE: licença confirmada. */
export type LicenseMode = 'SANDBOX' | 'PENDING' | 'ENTERPRISE';
export type ModeReason = 'MISSING_API_KEY' | 'INVALID_API_KEY' | 'KEY_NOT_VERIFIED' | 'LICENSE_VALID';
export type SignatureMeaning = 'REVIEW_APPROVAL' | 'RESPONSIBILITY' | 'AUTHORSHIP';
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface Finding {
  severity: 'CRITICAL' | 'WARNING';
  category: 'PATIENT' | 'THERMAL' | 'VIABILITY' | 'CUSTODY' | 'SCHEMA';
  code: string;
  message: string;
}

export interface Evaluation {
  status: Status;
  disposition: Disposition;
  /** Presente nas avaliações locais; false quando o payload viola o schema. */
  schemaValid?: boolean;
  findings: Finding[];
  metrics: { deviationC: number; elapsedHours: number | null; windowHours: number } | null;
  evaluatedAt: string;
  rulesVersion: string;
}

export interface SchemaError {
  /** Caminho JSON, por exemplo `$.sensorTemp.currentC`. */
  path: string;
  keyword: string;
  message: string;
}

export interface Operator {
  userId: string;
  printedName: string;
}

export interface ComplianceSeal {
  sealId: string;
  issuedAt: string;
  sampleId: string;
  payloadHash: string;
  status: Status;
  disposition: Disposition;
  tenant: string;
  licenseId: string;
  frameworks: { ref: string; scope: string }[];
  signatureManifestation: { printedName: string; userId: string; meaning: SignatureMeaning; meaningLabel: string; signedAt: string };
  auditTrail: { sequence: number; previousHash: string; chainHash: string; sourceSystem: string; requestId: string };
  timeSource: string;
}

export type Signature =
  | { algorithm: 'ES256'; keyId: string; signedPayload: string; value: string; jwksUrl: string }
  | { algorithm: 'NONE'; keyId: null; value: null; note: string };

export interface Receipt {
  integrity: { algorithm: 'SHA-256'; canonicalization: string; payloadHash: string };
  complianceSeal: ComplianceSeal;
  signature: Signature;
}

export interface VerificationCheck {
  id: 'PAYLOAD_HASH' | 'SEAL_BINDING' | 'SIGNATURE';
  label: string;
  /** null = não verificado (por exemplo, sem Web Crypto). */
  ok: boolean | null;
  note?: string;
  expected?: string;
  actual?: string;
}

export interface VerificationResult {
  valid: boolean;
  checks: VerificationCheck[];
  signature: boolean | null;
  verifiedAt: string;
}

export interface HttpInfo {
  method: 'POST';
  url: string;
  status: number;
  statusText: string;
  latencyMs: number;
  headers: Record<string, string>;
}

interface ResultBase {
  status: Status;
  findings: Finding[];
  evaluation: Evaluation;
  /** Payload exatamente como foi enviado (ou bloqueado). */
  sample: OpenOncoSample;
  regulatoryValidity: boolean;
}

/** Resultado de submit(). Nunca lança por erro de negócio: `mode` distingue os casos (ENTERPRISE, SANDBOX, LOCAL, OFFLINE, ERROR). */
export type SubmitResult =
  | (ResultBase & { ok: boolean; mode: 'ENTERPRISE'; stage: 'SEALED' | 'SEAL_INVALID'; disposition: Disposition; receipt: Receipt; verification: VerificationResult; response: unknown; http: HttpInfo; error: string | null })
  | (ResultBase & { ok: true; mode: 'SANDBOX'; stage: 'SANDBOX'; regulatoryValidity: false; notice: string; alert: { code: string; reason: 'MISSING_API_KEY' | 'INVALID_API_KEY'; title: string; message?: string; upgradeUrl?: string }; quota: { limit: number; used: number; remaining: number; window: string } | null; response: unknown; http: HttpInfo })
  | (ResultBase & { ok: false; mode: 'LOCAL'; stage: 'SCHEMA'; regulatoryValidity: false; http: null })
  | (ResultBase & { ok: false; mode: 'OFFLINE'; stage: 'NETWORK'; regulatoryValidity: false; error: string; http: null })
  | (ResultBase & { ok: false; mode: 'ERROR'; stage: 'HTTP_ERROR'; regulatoryValidity: false; error: string; response: unknown; http: HttpInfo });

/** Registro vivo de uma amostra rastreada. Trate como somente leitura. */
export interface TrackedRecord {
  readonly sampleId: string;
  readonly sample: OpenOncoSample;
  readonly evaluation: Evaluation;
  readonly history: ReadonlyArray<{ t: number; c: number }>;
  readonly telemetryAt: number | null;
  readonly lastResult: SubmitResult | null;
  readonly pending: boolean;
  readonly stopTelemetry: (() => void) | null;
}

export interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
}

export interface OpenOncoEventMap {
  'oot:update': CustomEvent<{ sampleId: string; source: 'track' | 'untrack' | 'telemetry' | 'request' | 'result' }>;
  'oot:result': CustomEvent<{ sampleId: string; result: SubmitResult }>;
  'oot:mode': CustomEvent<{ mode: LicenseMode; reason: ModeReason }>;
  'oot:sandbox': CustomEvent<{ reason: 'MISSING_API_KEY' | 'INVALID_API_KEY'; notice: string }>;
  'oot:log': CustomEvent<LogEntry>;
}

/** Fonte de telemetria: começa a chamar `emit` e devolve a função que encerra a assinatura. */
export type TelemetrySource = (emit: (reading: SensorReading) => void) => (() => void) | void;

export interface OpenOncoSDKOptions {
  /** URL base da API ou, em produção, do BFF/proxy do sistema hospedeiro. */
  endpoint?: string;
  /** Chave Enterprise. Não use no navegador em produção. Ausente = modo sandbox. */
  apiKey?: string | null;
  /** Usuário autenticado no host (21 CFR 11.50). Obrigatório para obter selo. */
  operator?: Operator | null;
  /** Por exemplo SAP, VEEVA, WMS, WEB. */
  sourceSystem?: string;
  timeoutMs?: number;
  /** Espelha todo o log no console. */
  debug?: boolean;
}

export declare class OpenOncoSDK extends EventTarget {
  static readonly VERSION: string;
  static readonly SANDBOX_NOTICE: string;
  /** Instância compartilhada em modo sandbox, usada pelo <onco-badge> declarativo. */
  static shared(options?: OpenOncoSDKOptions): OpenOncoSDK;

  constructor(options?: OpenOncoSDKOptions);

  readonly mode: LicenseMode;
  readonly modeReason: ModeReason;
  readonly endpoint: string;
  readonly logs: LogEntry[];

  setApiKey(key: string | null, options?: { silent?: boolean }): void;
  /** Clona, apara espaços e completa schemaVersion. Nunca converte tipos. */
  capture(input: object): OpenOncoSample;
  validateSchema(sample: unknown): { valid: boolean; errors: SchemaError[] };
  /** Pré-validação local e offline: schema + regras abertas. */
  evaluate(sample: unknown, now?: number): Evaluation;

  track(input: object): TrackedRecord;
  untrack(sampleId: string): boolean;
  getRecord(sampleId: string): TrackedRecord | null;
  ingestTelemetry(sampleId: string, reading: SensorReading): TrackedRecord | null;
  connectTelemetry(sampleId: string, source: TelemetrySource): () => void;

  /** Envia para validação um sampleId rastreado ou um objeto de amostra. */
  submit(target: string | object, options?: { signatureMeaning?: SignatureMeaning }): Promise<SubmitResult>;
  /** Verificação aberta de um recibo Enterprise; não consome licença. */
  verifyReceipt(sample: object, receipt: Receipt, options?: { quiet?: boolean }): Promise<VerificationResult>;

  addEventListener<K extends keyof OpenOncoEventMap>(type: K, listener: (event: OpenOncoEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof OpenOncoEventMap>(type: K, listener: (event: OpenOncoEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
}

export interface ThermalProfile {
  label: string;
  therapy: TherapyType;
  minC: number;
  maxC: number;
  warnMarginC: number;
  criticalDeltaC: number;
  maxExcursionMin: number;
  maxTransitHours: number;
  qc: { field: 'cellViabilityPct' | 'tumorContentPct'; min: number; label: string };
}

export declare const VERSION: string;
export declare const SCHEMA_VERSION: string;
export declare const RULES_VERSION: string;
export declare const DEFAULT_ENDPOINT: string;
export declare const SANDBOX_NOTICE: string;
export declare const SAMPLE_SCHEMA: Readonly<Record<string, unknown>>;
/** Valores ilustrativos: em produção vêm do protocolo validado de cada produto. */
export declare const THERMAL_PROFILES: Readonly<Record<BiopsyType, ThermalProfile>>;
export declare const STEP_LABEL: Readonly<Record<CustodyStep, string>>;
export declare const STATUS_LABEL: Readonly<Record<Status, string>>;
export declare const DISPOSITION_LABEL: Readonly<Record<Disposition, string>>;

export declare const SchemaValidator: {
  validate(data: unknown, schema?: object): SchemaError[];
};

export declare const Integrity: {
  readonly subtle: SubtleCrypto | null;
  readonly hasWebCrypto: boolean;
  /** OOT-C14N/1, inspirada no RFC 8785. */
  canonicalize(value: unknown): string;
  sha256Hex(text: string): Promise<string>;
  sha256HexSync(input: string | Uint8Array): string;
  b64url(bytes: Uint8Array): string;
  b64urlDecode(text: string): Uint8Array;
  uuid(): string;
  randomHex(bytes: number): string;
  utf8(text: string): Uint8Array;
};

export declare const Rules: {
  /** Avalia uma amostra já válida no schema. */
  evaluate(sample: OpenOncoSample, now?: number): Evaluation;
  /** Schema primeiro; regras só se o schema passar. */
  assess(sample: unknown, now?: number): Evaluation;
  fromSchemaErrors(errors: SchemaError[], now?: number): Evaluation;
};

export declare const OpenOnco: {
  readonly VERSION: typeof VERSION;
  readonly SCHEMA_VERSION: typeof SCHEMA_VERSION;
  readonly RULES_VERSION: typeof RULES_VERSION;
  readonly DEFAULT_ENDPOINT: typeof DEFAULT_ENDPOINT;
  readonly SANDBOX_NOTICE: typeof SANDBOX_NOTICE;
  readonly SAMPLE_SCHEMA: typeof SAMPLE_SCHEMA;
  readonly THERMAL_PROFILES: typeof THERMAL_PROFILES;
  readonly STEP_LABEL: typeof STEP_LABEL;
  readonly STATUS_LABEL: typeof STATUS_LABEL;
  readonly DISPOSITION_LABEL: typeof DISPOSITION_LABEL;
  readonly SchemaValidator: typeof SchemaValidator;
  readonly Integrity: typeof Integrity;
  readonly Rules: typeof Rules;
};

export default OpenOncoSDK;

declare global {
  /** Disponíveis quando o SDK é carregado via <script src="openonco-sdk.js">. */
  interface Window {
    OpenOncoSDK: typeof OpenOncoSDK;
    OpenOnco: typeof OpenOnco;
  }
}
