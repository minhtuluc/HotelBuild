import { describe, expect, it } from 'vitest';
import { errorCatalogue, isErrorCode } from '../src/errors.js';
import { buildDocument } from '../src/openapi/generate.js';

describe('HB035 additive allotment concurrency contract', () => {
  it('declares the existing database quota error as a 409 business error', () => {
    expect(isErrorCode('E_INV_ALLOTMENT_EXCEEDS_ROOMS')).toBe(true);
    expect(errorCatalogue).toHaveProperty('E_INV_ALLOTMENT_EXCEEDS_ROOMS', {
      httpStatus: 409,
      module: 'INV',
    });
    expect(buildDocument().paths?.['/api/v1/channel-allotments']).toHaveProperty(
      'put.responses.409.description',
      'E_INV_LOCK_TIMEOUT, E_INV_ALLOTMENT_EXCEEDS_ROOMS',
    );
  });
  it('documents a returned scope ETag for GET and successful batch PUT', () => {
    const path = buildDocument().paths?.['/api/v1/channel-allotments'];
    for (const response of [path?.get?.responses?.['200'], path?.put?.responses?.['204']]) {
      expect(response).toHaveProperty('headers.ETag.schema.type', 'string');
      expect(response).toHaveProperty(
        'headers.ETag.description',
        expect.stringContaining('channelId'),
      );
    }
  });
});
