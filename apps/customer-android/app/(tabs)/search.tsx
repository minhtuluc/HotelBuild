/**
 * SCR-72 + SCR-73 (HB-085) — tìm phòng & kết quả trên Android.
 *
 * Màn hình chỉ hiển thị kết quả của lớp thuần `src/search.ts` (kiểm tiêu chí, chặn offline, gọi
 * `availability` công khai). Không có access token, không tự tính tồn/giá (ADR-018); mọi nhãn lấy từ danh
 * mục `src/strings.ts` và mọi phần tử tương tác đều có nhãn trợ năng.
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { color, space } from '@pinehill/ui-native';
import { createAppApiClient } from '../../src/api';
import { createPublicJourneyApi } from '../../src/public-client';
import { netInfoSource } from '../../src/netinfo.native';
import { t } from '../../src/strings';
import { theme } from '../../src/theme';
import {
  EMPTY_CRITERIA,
  formatVnd,
  runSearch,
  searchIssue,
  searchRows,
  type SearchCriteria,
  type SearchIssue,
  type SearchOutcome,
  type SearchRow,
} from '../../src/search';

const ISSUE_KEYS: Readonly<
  Record<
    SearchIssue,
    | 'search.issue.PROPERTY'
    | 'search.issue.CHECK_IN'
    | 'search.issue.CHECK_OUT'
    | 'search.issue.ORDER'
    | 'search.issue.GUESTS'
  >
> = {
  PROPERTY: 'search.issue.PROPERTY',
  CHECK_IN: 'search.issue.CHECK_IN',
  CHECK_OUT: 'search.issue.CHECK_OUT',
  ORDER: 'search.issue.ORDER',
  GUESTS: 'search.issue.GUESTS',
};

function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}): ReactElement {
  return (
    <View style={{ gap: space.s1 }}>
      <Text style={{ color: color.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize="none"
        style={theme.field}
      />
    </View>
  );
}

function ResultRow({ row, onOpen }: { row: SearchRow; onOpen: () => void }): ReactElement {
  const availability = row.soldOut
    ? t('search.row.soldOut')
    : t('search.row.available', { count: row.availableCount });
  const nightly = t('search.row.nightlyFrom', {
    amount: t('search.money', { amount: formatVnd(row.nightlyFrom) }),
  });
  const total = t('search.row.totalFrom', {
    amount: t('search.money', { amount: formatVnd(row.totalFrom) }),
  });
  return (
    <View
      accessible
      accessibilityLabel={`${row.name}. ${availability}. ${nightly}. ${total}`}
      style={theme.card}
    >
      <Text style={{ color: color.text, fontWeight: '600' }}>{row.name}</Text>
      <Text style={{ color: color.text }}>{availability}</Text>
      <Text style={[theme.muted, theme.tabular]}>{nightly}</Text>
      <Text style={[theme.muted, theme.tabular]}>{total}</Text>
      <Text style={theme.muted}>
        {t('search.row.nights', { min: row.minNights, max: row.maxNights })} ·{' '}
        {t('search.row.capacity', { count: row.capacityAdults })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('room.open')} ${row.name}`}
        onPress={onOpen}
        style={theme.buttonPlain}
      >
        <Text style={theme.buttonPlainText}>{t('room.open')}</Text>
      </Pressable>
    </View>
  );
}

export default function SearchScreen(): ReactElement {
  const router = useRouter();
  const api = useMemo(() => createPublicJourneyApi(createAppApiClient()), []);
  const net = useMemo(() => netInfoSource(), []);
  const [criteria, setCriteria] = useState<SearchCriteria>(EMPTY_CRITERIA);
  const [issue, setIssue] = useState<SearchIssue | null>(null);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    const found = searchIssue(criteria);
    setIssue(found);
    if (found !== null) return;
    setBusy(true);
    const result = await runSearch({ api, net }, criteria);
    setOutcome(result);
    setBusy(false);
  }, [api, criteria, net]);

  const change = useCallback((patch: Partial<SearchCriteria>): void => {
    setCriteria((previous) => ({ ...previous, ...patch }));
  }, []);

  const number = (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {t('journey.search.title')}
      </Text>

      <Field
        label={t('search.form.property')}
        value={criteria.propertyId}
        onChange={(value) => {
          change({ propertyId: value });
        }}
      />
      <Field
        label={t('search.form.checkIn')}
        value={criteria.checkIn}
        onChange={(value) => {
          change({ checkIn: value });
        }}
      />
      <Field
        label={t('search.form.checkOut')}
        value={criteria.checkOut}
        onChange={(value) => {
          change({ checkOut: value });
        }}
      />
      <Field
        label={t('search.form.adults')}
        value={String(criteria.adults)}
        numeric
        onChange={(value) => {
          change({ adults: number(value) });
        }}
      />
      <Field
        label={t('search.form.children')}
        value={String(criteria.children)}
        numeric
        onChange={(value) => {
          change({ children: number(value) });
        }}
      />
      <Field
        label={t('search.form.roomCount')}
        value={String(criteria.roomCount)}
        numeric
        onChange={(value) => {
          change({ roomCount: number(value) });
        }}
      />

      {issue === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: color.danger }}
        >
          {t(ISSUE_KEYS[issue])}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('search.form.submit')}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={() => {
          void submit();
        }}
        style={theme.buttonPrimary}
      >
        {busy ? (
          <ActivityIndicator
            accessibilityLabel={t('state.loading')}
            color={color.primaryContrast}
          />
        ) : (
          <Text style={theme.buttonPrimaryText}>{t('search.form.submit')}</Text>
        )}
      </Pressable>

      {outcome === null ? null : outcome.kind === 'offline' ? (
        <View style={{ gap: space.s2 }}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={theme.alertDanger}
          >
            {t('guest.offline')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.form.retry')}
            onPress={() => {
              void submit();
            }}
            style={theme.buttonPlain}
          >
            <Text style={theme.buttonPlainText}>{t('search.form.retry')}</Text>
          </Pressable>
        </View>
      ) : outcome.kind === 'failed' ? (
        <View style={{ gap: space.s2 }}>
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={theme.alertDanger}
          >
            {t('search.failed', { code: outcome.code ?? 'UNKNOWN' })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.form.retry')}
            onPress={() => {
              void submit();
            }}
            style={theme.buttonPlain}
          >
            <Text style={theme.buttonPlainText}>{t('search.form.retry')}</Text>
          </Pressable>
        </View>
      ) : outcome.kind === 'empty' ? (
        <Text accessibilityRole="alert" style={theme.muted}>
          {t('search.empty')}
        </Text>
      ) : (
        <View style={{ gap: space.s2 }}>
          <Text style={theme.muted}>
            {t('search.results.criteria', {
              from: outcome.availability.checkIn,
              to: outcome.availability.checkOut,
              nights: outcome.availability.nights,
            })}
          </Text>
          <Text accessibilityRole="header" style={theme.sectionTitle}>
            {t('search.results.title')}
          </Text>
          {searchRows(outcome.availability).map((row) => (
            <ResultRow
              key={row.roomTypeId}
              row={row}
              onOpen={() => {
                router.push({
                  pathname: '/room/[roomTypeId]',
                  params: {
                    roomTypeId: row.roomTypeId,
                    name: row.name,
                    propertyId: criteria.propertyId,
                    checkIn: criteria.checkIn,
                    checkOut: criteria.checkOut,
                    adults: String(criteria.adults),
                    children: String(criteria.children),
                    roomCount: String(criteria.roomCount),
                  },
                });
              }}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
