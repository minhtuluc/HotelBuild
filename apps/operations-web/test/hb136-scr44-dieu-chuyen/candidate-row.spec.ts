import { describe, expect, it } from 'vitest';
import type { RelocationPlan } from '@pinehill/contracts';
import { candidateRow } from '../../src/features/hb136-scr44-dieu-chuyen/candidates';
import { candidate } from './fixtures';

/**
 * HB-220 — SCR-44 hiển thị ứng viên từ hai nguồn: chi tiết ca (`keepScore` số + `keepScoreBreakdown`,
 * HB-126) và `relocation-plan` (`keepScore` bảng phân rã, HB-122). Bảng phải ra cùng một dòng với số
 * máy chủ trả nguyên vẹn — không tính lại, không lấy nhầm trường.
 */
describe('HB-220 · dòng ứng viên SCR-44', () => {
  it('case_and_plan_shapes_render_same_server_numbers', () => {
    const fromCase = candidate(1, 'N***', 24);
    const fromPlan: RelocationPlan['candidates'][number] = {
      ...fromCase,
      keepScore: {
        total: 24,
        loyaltyTier: fromCase.keepScoreBreakdown.loyalty,
        payment: fromCase.keepScoreBreakdown.payment,
        nights: fromCase.keepScoreBreakdown.nights,
        returningGuest: fromCase.keepScoreBreakdown.repeat,
        arrived: fromCase.keepScoreBreakdown.arrived,
      },
    };
    const caseRow = candidateRow(fromCase);
    expect(caseRow.score).toEqual([24, 10, 10, 4, 0, 0]);
    expect(candidateRow(fromPlan)).toEqual(caseRow);
  });
});
