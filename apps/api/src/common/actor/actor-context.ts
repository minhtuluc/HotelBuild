/** HB-009 minimal contract. Authentication/scope enrichment belongs to HB-014. */
export interface ActorContext {
  readonly id: string | null;
  readonly role: string;
  readonly ip: string | null;
  readonly correlationId: string;
}

/**
 * Actor đã xác thực (HB-013) — dùng cho guard, audit và use case nghiệp vụ.
 * HB-014 mở rộng thêm phần quyền/phạm vi chi tiết; ở đây chỉ những gì guard đã kiểm.
 */
export interface AuthenticatedActor extends ActorContext {
  readonly id: string;
  readonly sessionId: string;
  readonly surface: string;
  readonly mustChangePassword: boolean;
}
