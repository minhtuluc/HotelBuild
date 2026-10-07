export interface FakeRequest {
  method: string;
  url: URL;
  body: unknown;
  authorization: string | undefined;
}
export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export type FakeHandler = (
  request: FakeRequest,
) => FakeResponse | undefined | Promise<FakeResponse | undefined>;
