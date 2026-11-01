// GERADO por scripts/build-packages.js. Não edite: altere o script de origem e rode `npm run build`.
// Origem: SAMPLE_SCHEMA em packages/sdk/openonco-sdk.js (JSON Schema 1.0.0).
// Regra condicional não expressa no tipo: qualityControl.cellViabilityPct é obrigatório para
// LEUKAPHERESIS_*, e qualityControl.tumorContentPct para TUMOR_*. O validador de schema cobre isso.

export type CustodyStep = "COLLECTION" | "PACKAGING" | "COURIER_PICKUP" | "IN_TRANSIT" | "HUB_HANDOFF" | "RECEIVED_AT_MANUFACTURING" | "RECEIVED_AT_SEQUENCING_LAB";

export interface CustodyEvent {
  step: CustodyStep;
  /** Formato: date-time */
  timestamp: string;
  /** Usuário ou sistema responsável (ALCOA+: atribuível). */
  actor: string;
  location: string;
}

export type TherapyType = "CAR_T_AUTOLOGOUS" | "MRNA_NEOANTIGEN_VACCINE";

/** Ordem de manufatura à qual a amostra precisa pertencer. */
export interface TherapyOrder {
  /** Formato: `^ORD-[A-Z0-9]{8}$` */
  orderId: string;
  therapyType: TherapyType;
  /** Pseudônimo na ordem; tem de coincidir com patientId (COI). · Formato: `^PT-[A-Z]{2}-[0-9]{6}$` */
  patientId: string;
}

/** Material coletado: biópsia tumoral (pipeline de neoantígenos para mRNA) ou material de partida por aférese (CAR-T). */
export type BiopsyType = "LEUKAPHERESIS_FRESH" | "LEUKAPHERESIS_CRYO" | "TUMOR_FRESH_FROZEN" | "TUMOR_FFPE";

/** Última leitura do data logger da embalagem. */
export interface SensorReading {
  /** Formato: `^LOG-[A-Z0-9-]{4,24}$` */
  sensorId: string;
  /** Mínimo: -200 · Máximo: 60 */
  currentC: number;
  /** Mínimo: -200 · Máximo: 60 */
  minObservedC: number;
  /** Mínimo: -200 · Máximo: 60 */
  maxObservedC: number;
  /** Minutos acumulados fora da faixa, calculados pelo logger. · Mínimo: 0 */
  excursionMinutes: number;
  /** Formato: date-time */
  recordedAt: string;
}

export interface QualityControl {
  /** Viabilidade celular (material de aférese). · Mínimo: 0 · Máximo: 100 */
  cellViabilityPct?: number;
  /** Conteúdo tumoral estimado pela patologia (biópsias). · Mínimo: 0 · Máximo: 100 */
  tumorContentPct?: number;
}

/** Amostra biológica rastreável para terapias personalizadas contra o câncer (CAR-T autólogo e vacinas de mRNA com neoantígenos). */
export interface OpenOncoSample {
  /** Versão do contrato de dados (SemVer). */
  schemaVersion: "1.0.0";
  /** ID único da amostra; em produção, mapeado da etiqueta ISBT 128 ou GS1. · Formato: `^SMP-[0-9]{4}-[A-Z0-9]{6}$` */
  sampleId: string;
  /** Pseudônimo do paciente lido na etiqueta (cadeia de identidade). Nunca nome, CPF ou prontuário (LGPD/HIPAA). · Formato: `^PT-[A-Z]{2}-[0-9]{6}$` */
  patientId: string;
  /** Ordem de manufatura à qual a amostra precisa pertencer. */
  therapyOrder: TherapyOrder;
  /** Material coletado: biópsia tumoral (pipeline de neoantígenos para mRNA) ou material de partida por aférese (CAR-T). */
  biopsyType: BiopsyType;
  /** Última leitura do data logger da embalagem. */
  sensorTemp: SensorReading;
  qualityControl?: QualityControl;
  /** Eventos de custódia em ordem cronológica, começando pela coleta. */
  chainOfCustody: CustodyEvent[];
}
