/** Browser test entry: the same production transport/factories used by all four frontends. */
export { createSessionClient } from '../../../../packages/web-session/src/client.js';
export {
  ApiClient,
  createQuoteApi,
  createBookingApi,
  createPaymentApi,
  createRefundApi,
} from '../../../../packages/api-client/src/index.js';
