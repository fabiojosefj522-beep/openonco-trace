// Tipos públicos do @openonco/badge.
import type { OpenOncoSDK, SubmitResult, TrackedRecord } from '@openonco/sdk';

/**
 * <onco-badge>: status de custódia em tempo real.
 * Atributos: `sample-id`, `compact`, `endpoint` (só no modo declarativo).
 * Evento DOM: `oot-validated` (bubbles + composed).
 */
export declare class OncoBadge extends HTMLElement {
  static readonly observedAttributes: string[];
  sdk: OpenOncoSDK | null;
  sampleId: string | null;
  readonly record: TrackedRecord | null;
  /** Envia a amostra vinculada e emite `oot-validated`. Retorna null se não houver amostra ou já houver envio em curso. */
  validate(): Promise<SubmitResult | null>;
}

export default OncoBadge;

declare global {
  interface HTMLElementTagNameMap {
    'onco-badge': OncoBadge;
  }
  interface HTMLElementEventMap {
    'oot-validated': CustomEvent<SubmitResult>;
  }
  interface Window {
    OncoBadge: typeof OncoBadge;
  }
}
