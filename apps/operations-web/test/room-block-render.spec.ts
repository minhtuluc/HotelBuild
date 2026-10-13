import { expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoomBlocksScreen } from '../src/app/(ops)/room-blocks/room-blocks-screen';
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
test('initial unverified staff render exposes no write form or private removal editor', () => {
  const html = renderToStaticMarkup(createElement(RoomBlocksScreen));
  expect(html).not.toContain('data-testid="room-block-form"');
  expect(html).not.toContain('data-testid="room-block-remove"');
});
