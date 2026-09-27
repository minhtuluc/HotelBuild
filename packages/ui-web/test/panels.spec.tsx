import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { AccessDeniedPanel, ErrorPanel } from '../src/panels.js';
import { viCatalog } from '../src/messages.js';

afterEach(cleanup);

describe('khung biên lỗi (F0-04)', () => {
  it('hiện tiêu đề, hướng dẫn và gọi reset khi bấm thử lại', () => {
    const reset = vi.fn();
    render(<ErrorPanel reset={reset} />);
    expect(screen.getByRole('alert').textContent).toContain(viCatalog['error.boundary.title']);
    expect(screen.getByRole('alert').textContent).toContain(viCatalog['error.boundary.body']);
    screen.getByRole('button', { name: viCatalog['error.boundary.retry'] }).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('chỉ hiện mã tham chiếu, không lộ chi tiết kỹ thuật', () => {
    render(<ErrorPanel reset={() => undefined} reference="trace-abc-123" />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain('trace-abc-123');
    expect(text).not.toMatch(/at\s+\w+\s+\(|\.tsx?:\d+:\d+|stack/i);
  });

  it('không có tham chiếu thì không render khối mã', () => {
    render(<ErrorPanel />);
    expect(screen.queryByRole('code')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('axe không phát hiện vi phạm ở khung biên lỗi', async () => {
    const { container } = render(<ErrorPanel reset={() => undefined} reference="trace-1" />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('khung thiếu quyền (F0-04)', () => {
  it('nêu rõ không đủ quyền và có đường quay lại', () => {
    render(<AccessDeniedPanel backHref="/ops" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(viCatalog['access.denied.title']);
    expect(screen.getByRole('link', { name: viCatalog['access.denied.back'] })).toHaveProperty(
      'href',
      expect.stringContaining('/ops'),
    );
  });

  it('axe không phát hiện vi phạm ở khung thiếu quyền', async () => {
    const { container } = render(<AccessDeniedPanel />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
