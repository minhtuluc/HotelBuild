import { useEffect, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import type { BookingSummary } from '@pinehill/contracts';
import { createSession } from '../session-factory';
import { secureStorage } from '../storage.native';
import { netInfoSource } from '../netinfo.native';
import { loadChange, loadFailure } from './load';
import type { ChangeController } from './controller';
import type { ChangeDraft, ChangeKind, ChangeState } from './types';

export function useChangeScreen(code: string, kind: ChangeKind) {
  const [session] = useState(createSession),
    [net] = useState(netInfoSource),
    [storage] = useState(secureStorage);
  const [generation, setGeneration] = useState(0),
    [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<BookingSummary | null>(null),
    [controller, setController] = useState<ChangeController | null>(null);
  const [view, setView] = useState<ChangeState | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChangeDraft>({
    reason: 'GUEST_REQUEST',
    note: '',
    evidenceRefs: [],
    checkIn: '',
    checkOut: '',
  });
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    setBooking(null);
    setController(null);
    setView(null);
    setFailure(null);
    void loadChange({ session, net, storage, createId: randomUUID, now: Date.now }, code, kind)
      .then((loaded) => {
        if (!alive) return;
        unsubscribe = loaded.controller.subscribe(() => {
          if (alive) {
            setView(loaded.controller.state);
            if (loaded.controller.state.phase === 'denied') {
              setBooking(null);
              setDraft({
                reason: 'GUEST_REQUEST',
                note: '',
                evidenceRefs: [],
                checkIn: '',
                checkOut: '',
              });
            }
          }
        });
        setDraft(loaded.draft);
        setBooking(loaded.booking);
        setController(loaded.controller);
        setView(loaded.controller.state);
      })
      .catch((error) => {
        if (alive) setFailure(loadFailure(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [code, generation, kind, net, session, storage]);
  return {
    booking,
    controller,
    view,
    failure,
    loading,
    draft,
    setDraft,
    reload: () => setGeneration((v) => v + 1),
  };
}
