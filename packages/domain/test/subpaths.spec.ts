import { expect, test } from 'vitest';

// Khung subpath do lead dựng (HB-032/HB-052/HB-053 sở hữu nội dung): phải nạp được độc lập.
test.each(['inventory', 'pricing', 'cancellation'] as const)(
  'subpath %s nạp được',
  async (name) => {
    const loaded: unknown = await import(`../src/${name}/index.ts`);
    expect(loaded).toBeTypeOf('object');
  },
);
