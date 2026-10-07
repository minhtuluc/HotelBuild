/** HB-009 minimal contract. Authentication/scope enrichment belongs to HB-014. */
export interface ActorContext {
  readonly id: string | null;
  readonly role: string;
  readonly ip: string | null;
  readonly correlationId: string;
}
