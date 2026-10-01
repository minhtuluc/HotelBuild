export class DomainError extends Error {
  constructor(
    readonly code: `E_${string}`,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
