/**
 * SCR-62 — tra cứu booking & khách tại hiện trường (UC-BOOK-07, UC-CRM-01).
 * Gọi hai tuyến đọc có sẵn; che PII theo vai trò ở lớp `view`; trạng thái theo §8.1.
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { color, space } from '@pinehill/ui-native';
import type { Session } from '../session';
import { theme } from '../theme';
import { LookupReader, type LookupState } from './reader';
import { lookupPorts } from './ports';
import { lookupText as text } from './messages';
import { BookingCard, GuestCard } from './rows';
import type { LookupRow } from './view';

export interface LookupScreenProps {
  session: Session;
  onBack: () => void;
  /** Mở trình quay số; bơm được để test không cần thiết bị. */
  openPhone?: (phone: string) => void;
}

function defaultOpenPhone(phone: string): void {
  void Linking.openURL(`tel:${phone}`).catch(() => undefined);
}

export function LookupScreen({
  session,
  onBack,
  openPhone = defaultOpenPhone,
}: LookupScreenProps): ReactElement {
  const [reader, setReader] = useState<LookupReader | null>(null);
  const [state, setState] = useState<LookupState>({
    phase: 'idle',
    rows: [],
    query: null,
    truncated: false,
  });
  const [term, setTerm] = useState('');
  useEffect(() => {
    const active = new LookupReader(lookupPorts(session));
    setReader(active);
    setState(active.state);
    const unsubscribe = active.subscribe(() => setState(active.state));
    const sessionChanges = session.subscribe(() => active.invalidate());
    return () => {
      unsubscribe();
      sessionChanges();
      active.dispose();
    };
  }, [session]);
  const loading = state.phase === 'loading';
  function search(): void {
    if (reader === null) return;
    void reader.load(term, session.selectedProperty() ?? undefined);
  }
  return (
    <View style={theme.screen}>
      <Text accessibilityRole="header" style={theme.title}>
        {text('title')}
      </Text>
      <TextInput
        testID="lookup-query"
        accessibilityLabel={text('query')}
        placeholder={text('query')}
        value={term}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        editable={!loading}
        onChangeText={(value) => {
          reader?.invalidate();
          setTerm(value);
        }}
        onSubmitEditing={search}
        style={theme.field}
      />
      <Pressable
        testID="lookup-search"
        accessibilityRole="button"
        accessibilityLabel={text('search')}
        accessibilityState={{ disabled: loading }}
        disabled={loading}
        onPress={search}
        style={theme.buttonPrimary}
      >
        <Text style={theme.buttonPrimaryText}>{text('search')}</Text>
      </Pressable>
      {loading ? (
        <ActivityIndicator accessibilityLabel={text('loading')} color={color.primary} />
      ) : null}
      <Text accessibilityLiveRegion="polite" testID="lookup-state" style={theme.muted}>
        {text(state.phase)}
      </Text>
      {state.truncated ? (
        <Text accessibilityLiveRegion="polite" style={theme.muted}>
          {text('truncated')}
        </Text>
      ) : null}
      <FlatList<LookupRow>
        testID="lookup-results"
        accessibilityLabel={text('results')}
        data={state.rows}
        keyExtractor={(row) =>
          row.kind === 'booking' ? `b-${row.booking.id}` : `g-${row.guest.id}`
        }
        contentContainerStyle={{ gap: space.s3 }}
        renderItem={({ item }) =>
          item.kind === 'booking' ? (
            <BookingCard booking={item.booking} />
          ) : (
            <GuestCard guest={item.guest} onCall={openPhone} />
          )
        }
      />
      <Pressable
        testID="lookup-back"
        accessibilityRole="button"
        accessibilityLabel={text('back')}
        onPress={onBack}
        style={theme.buttonPlain}
      >
        <Text style={theme.buttonPlainText}>{text('back')}</Text>
      </Pressable>
    </View>
  );
}
