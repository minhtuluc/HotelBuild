'use client';
import type { ReactElement } from 'react';
import { formatDateTimeVn } from '@pinehill/ui-web';
import type { OverbookingCaseDetail } from '@pinehill/contracts';
import { text } from './messages';
import { box } from './parts';

type Candidate = OverbookingCaseDetail['candidates'][number];

/** Bảng đầy đủ đúng thứ tự máy chủ đặt: không tính lại điểm, không sắp lại, không lược top-N. */
export function CandidatesTable({ rows }: { rows: readonly Candidate[] }): ReactElement {
  return (
    <section style={box} aria-labelledby="hb136-cand-title" data-testid="hb136-candidates">
      <h2 id="hb136-cand-title">{text('candidatesTitle')}</h2>
      <p>{text('candidatesNote')}</p>
      {rows.length === 0 ? (
        <p>{text('noCandidates')}</p>
      ) : (
        <div
          role="region"
          aria-label={text('candidatesTitle')}
          tabIndex={0}
          style={{ overflowX: 'auto', maxWidth: '100%' }}
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
                  <td>{row.keepScore.total}</td>
                  <td>{row.keepScore.loyaltyTier}</td>
                  <td>{row.keepScore.payment}</td>
                  <td>{row.keepScore.nights}</td>
                  <td>{row.keepScore.returningGuest}</td>
                  <td>{row.keepScore.arrived}</td>
                  <td>{formatDateTimeVn(row.createdAt)}</td>
                  <td>{row.bookingSeq}</td>
                  <td>{row.paidAmount}</td>
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
      <h2 id="hb136-ladder-title">{text('ladderTitle')}</h2>
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
