'use client';
import type { ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { OverbookingCaseDetail, RelocationPlan } from '@pinehill/contracts';
import { OPS_TABULAR_STYLE, OPS_TABLE_WRAP_STYLE } from '../../components/editorial-styles';
import { text } from './messages';
import { box } from './parts';

type CaseCandidate = OverbookingCaseDetail['candidates'][number];
type PlanCandidate = RelocationPlan['candidates'][number];

/** Một dòng hiển thị; điểm lấy nguyên từ máy chủ, chỉ đổi tên trường giữa hai nguồn (HB-220). */
interface Row {
  readonly rank: number;
  readonly bookingId: string;
  readonly bookingRoomId: string;
  readonly guestNameMasked: string;
  readonly priorityGroup: string;
  readonly score: readonly [number, number, number, number, number, number];
  readonly createdAt: string;
  readonly bookingSeq: string;
  readonly paidAmount: number;
}

const isCaseCandidate = (row: CaseCandidate | PlanCandidate): row is CaseCandidate =>
  typeof row.keepScore === 'number';

/** `relocation-plan` trả bảng phân rã của planner; chi tiết ca trả số + `keepScoreBreakdown`. */
export function candidateRow(row: CaseCandidate | PlanCandidate): Row {
  const score = isCaseCandidate(row)
    ? ([
        row.keepScore,
        row.keepScoreBreakdown.loyalty,
        row.keepScoreBreakdown.payment,
        row.keepScoreBreakdown.nights,
        row.keepScoreBreakdown.repeat,
        row.keepScoreBreakdown.arrived,
      ] as const)
    : ([
        row.keepScore.total,
        row.keepScore.loyaltyTier,
        row.keepScore.payment,
        row.keepScore.nights,
        row.keepScore.returningGuest,
        row.keepScore.arrived,
      ] as const);
  return {
    rank: row.rank,
    bookingId: row.bookingId,
    bookingRoomId: row.bookingRoomId,
    guestNameMasked: row.guestNameMasked,
    priorityGroup: row.priorityGroup,
    score,
    createdAt: row.createdAt,
    bookingSeq: row.bookingSeq,
    paidAmount: row.paidAmount,
  };
}

/** Bảng đầy đủ đúng thứ tự máy chủ đặt: không tính lại điểm, không sắp lại, không lược top-N. */
export function CandidatesTable({
  rows: source,
}: {
  rows: readonly (CaseCandidate | PlanCandidate)[];
}): ReactElement {
  const rows = source.map(candidateRow);
  return (
    <section
      className="ph-card"
      style={box}
      aria-labelledby="hb136-cand-title"
      data-testid="hb136-candidates"
    >
      <h2 id="hb136-cand-title" style={{ margin: 0 }}>
        {text('candidatesTitle')}
      </h2>
      <p style={{ margin: 0 }}>{text('candidatesNote')}</p>
      {rows.length === 0 ? (
        <p style={{ margin: 0 }}>{text('noCandidates')}</p>
      ) : (
        <div
          role="region"
          aria-label={text('candidatesTitle')}
          tabIndex={0}
          style={OPS_TABLE_WRAP_STYLE}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{text('colRank')}</th>
                <th scope="col">{text('colBooking')}</th>
                <th scope="col">{text('colGuest')}</th>
                <th scope="col">{text('colGroup')}</th>
                <th scope="col">{text('colTotal')}</th>
                <th scope="col">{text('colLoyalty')}</th>
                <th scope="col">{text('colPayment')}</th>
                <th scope="col">{text('colNights')}</th>
                <th scope="col">{text('colReturning')}</th>
                <th scope="col">{text('colArrived')}</th>
                <th scope="col">{text('colCreated')}</th>
                <th scope="col">{text('colSeq')}</th>
                <th scope="col">{text('colPaid')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.bookingRoomId} data-testid={`hb136-cand-${row.bookingRoomId}`}>
                  <th scope="row">{row.rank}</th>
                  <td>{row.bookingId}</td>
                  <td>{row.guestNameMasked}</td>
                  <td>{row.priorityGroup}</td>
                  {row.score.map((value, index) => (
                    <td key={index} style={OPS_TABULAR_STYLE}>
                      {value}
                    </td>
                  ))}
                  <td>{formatDateTimeVn(row.createdAt)}</td>
                  <td style={OPS_TABULAR_STYLE}>{row.bookingSeq}</td>
                  <td style={OPS_TABULAR_STYLE}>{row.paidAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Step = OverbookingCaseDetail['ladderPreview'][number];

/** Thang bốn bậc đúng như máy chủ trả; bậc không khả dụng nêu lý do, không giả khả dụng. */
export function Ladder({ steps }: { steps: readonly Step[] }): ReactElement {
  return (
    <section style={box} aria-labelledby="hb136-ladder-title" data-testid="hb136-ladder">
      <h2 id="hb136-ladder-title" style={{ margin: 0 }}>
        {text('ladderTitle')}
      </h2>
      <ol style={{ margin: 0, paddingLeft: 20 }}>
        {steps.map((step) => (
          <li key={step.step} data-testid={`hb136-step-${step.step}`}>
            <strong>{text('ladderStep', { step: step.step, type: step.moveType })}</strong>{' '}
            {step.feasible
              ? text('feasible', { count: step.candidateCount })
              : text('unavailable', { note: step.note ?? '' })}
          </li>
        ))}
      </ol>
    </section>
  );
}
