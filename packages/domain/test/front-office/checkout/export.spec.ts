import { expect, test } from 'vitest';
import * as frontOffice from '@pinehill/domain/front-office';

test('front-office package exposes the checkout fee decision', () => {
  expect(frontOffice).toHaveProperty('checkOutFee', expect.any(Function));
});
