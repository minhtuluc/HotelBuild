'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { color, radius, space, touchTargetPx } from '@pinehill/ui-web';
import { ALERT_BANNER, AuthCard, PRIMARY, SECONDARY } from '../../../session/form-parts';
import { authText as text } from '../../../session/messages';
import { safeNextPath } from '../../../session/next-path';
import { useStaffSession } from '../../../session/staff-session';

export function SelectPropertyForm(): ReactElement {
  const { properties, selectProperty, logout } = useStaffSession();
  const router = useRouter();
  const rawNext = useSearchParams().get('next');
  const [choice, setChoice] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (choice === null) {
      setMissing(true);
      return;
    }
    selectProperty(choice);
    router.replace(safeNextPath(rawNext));
  };

  return (
    <AuthCard titleId="property-title" title={text('propertyTitle')} intro={text('propertyIntro')}>
      {properties.length === 0 ? (
        <p role="alert" data-testid="property-none" style={ALERT_BANNER}>
          {text('propertyNone')}
        </p>
      ) : (
        <form noValidate onSubmit={submit} style={{ display: 'grid', gap: space.s4 }}>
          <fieldset style={{ display: 'grid', gap: space.s2, border: 0, padding: 0, margin: 0 }}>
            <legend style={{ padding: 0, marginBottom: space.s2, fontSize: 14, fontWeight: 500 }}>
              {text('propertyLegend')}
            </legend>
            {properties.map((property) => {
              const selected = choice === property.id;
              return (
                <label
                  key={property.id}
                  style={{
                    display: 'flex',
                    gap: space.s3,
                    alignItems: 'center',
                    minHeight: touchTargetPx,
                    padding: `${space.s2}px ${space.s3}px`,
                    border: `1px solid ${selected ? color.primary : color.border}`,
                    borderRadius: radius.sm,
                    background: selected ? '#E7F3EE' : color.surface,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="property"
                    value={property.id}
                    checked={selected}
                    aria-describedby={missing ? 'property-missing' : undefined}
                    onChange={() => {
                      setChoice(property.id);
                      setMissing(false);
                    }}
                  />
                  <span>{property.name}</span>
                </label>
              );
            })}
          </fieldset>
          {missing ? (
            <p
              id="property-missing"
              role="alert"
              data-testid="property-missing"
              style={ALERT_BANNER}
            >
              {text('propertyRequired')}
            </p>
          ) : null}
          <button
            type="submit"
            data-testid="property-continue"
            className="ph-btn-primary"
            style={PRIMARY}
          >
            {text('propertyContinue')}
          </button>
        </form>
      )}
      <button
        type="button"
        data-testid="property-logout"
        onClick={() => {
          void logout();
        }}
        className="ph-btn"
        style={SECONDARY}
      >
        {text('signOut')}
      </button>
    </AuthCard>
  );
}
