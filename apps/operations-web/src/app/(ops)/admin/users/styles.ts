import { color, radius, space, touchTargetPx } from '@pinehill/ui-web';

export const CONTROL = {
  minHeight: touchTargetPx,
  border: `1px solid ${color.borderStrong}`,
  borderRadius: radius.sm,
  padding: space.s2,
  background: color.surface,
  color: color.text,
  maxWidth: '100%',
} as const;

export const FIELD = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 4,
  minWidth: 0,
  maxWidth: '100%',
} as const;

export const PANEL = {
  display: 'grid',
  gap: space.s3,
  padding: space.s4,
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: color.surface,
} as const;
