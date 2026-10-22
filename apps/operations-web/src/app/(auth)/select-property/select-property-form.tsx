'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { color, space, touchTargetPx } from '@pinehill/ui-web';
import { PAGE, PRIMARY } from '../../../session/form-parts';
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
    <section style={PAGE} aria-labelledby="property-title">
      <h1 id="property-title" style={{ margin: 0, fontSize: 24 }}>
        {text('propertyTitle')}
      </h1>
      <p style={{ margin: 0, color: color.textMuted }}>{text('propertyIntro')}</p>
      {properties.length === 0 ? (
        <p role="alert" data-testid="property-none" style={{ margin: 0, color: color.danger }}>
          {text('propertyNone')}
        </p>
      ) : (
        <form noValidate onSubmit={submit} style={{ display: 'grid', gap: space.s4 }}>
          <fieldset style={{ display: 'grid', gap: space.s2, border: 0, padding: 0, margin: 0 }}>
            <legend style={{ padding: 0, marginBottom: space.s2 }}>{text('propertyLegend')}</legend>
            {properties.map((property) => (
              <label
                key={property.id}
                style={{
                  display: 'flex',
                  gap: space.s2,
                  alignItems: 'center',
                  minHeight: touchTargetPx,
                }}
              >
                <input
                  type="radio"
                  name="property"
                  value={property.id}
                  checked={choice === property.id}
                  aria-describedby={missing ? 'property-missing' : undefined}
                  onChange={() => {
                    setChoice(property.id);
                    setMissing(false);
                  }}
                />
                {property.name}
              </label>
            ))}
          </fieldset>
          {missing ? (
            <p
              id="property-missing"
              role="alert"
              data-testid="property-missing"
              style={{ margin: 0, color: color.danger }}
            >
              {text('propertyRequired')}
            </p>
          ) : null}
          <button type="submit" data-testid="property-continue" style={PRIMARY}>
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
        style={{ justifySelf: 'start', minHeight: 44 }}
      >
        {text('signOut')}
      </button>
    </section>
  );
}
