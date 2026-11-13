import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { PineHillBrand } from '../src/brand.js';

afterEach(cleanup);

describe('PineHillBrand', () => {
  it('hiển thị wordmark PINE HILL và phụ đề tuỳ chọn ở hai tông màu', () => {
    const { rerender } = render(<PineHillBrand subtitle="Ninh Thuận" />);
    expect(screen.getByText('PINE HILL')).toBeDefined();
    expect(screen.getByText('Ninh Thuận')).toBeDefined();

    rerender(<PineHillBrand tone="dark" compact />);
    expect(screen.getByText('PINE HILL')).toBeDefined();
  });

  it('axe không phát hiện vi phạm accessibility', async () => {
    const { container } = render(<PineHillBrand subtitle="Vận hành cơ sở" />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
