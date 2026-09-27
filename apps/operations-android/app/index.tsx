/**
 * Khung F0 của Operations Android: token, hợp đồng trạng thái và smoke gọi API qua client dùng chung.
 * Màn hình nghiệp vụ (SCR-56…SCR-68) thuộc các pha F1–F7.
 */
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStateSurface, color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { createAppApiClient } from '../src/api';
import { probeHealth, type ProbeOutcome } from '../src/probe';
import { t, stateSlugs, fixtureFor } from '../src/demo';

type ProbeStatus = 'idle' | 'loading' | ProbeOutcome;

export default function OperationsHomeScreen(): ReactElement {
  const [slug, setSlug] = useState<(typeof stateSlugs)[number]>('loading');
  const [probe, setProbe] = useState<ProbeStatus>('idle');

  async function runProbe(): Promise<void> {
    setProbe('loading');
    try {
      setProbe(await probeHealth(createAppApiClient({ maxAttempts: 1 })));
    } catch {
      setProbe({ kind: 'failed', code: 'CONFIG_OR_RUNTIME', reference: undefined });
    }
  }

  function probeText(): string {
    if (probe === 'idle') return '';
    if (probe === 'loading') return t('state.loading');
    if (probe.kind === 'ok') return t('api.probe.ok');
    if (probe.kind === 'forbidden') return t('state.forbidden');
    return t('api.probe.failed', { code: probe.code });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('demo.title')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.s2, alignItems: 'center' }}>
        <Pressable
          testID="check-api"
          accessibilityRole="button"
          accessibilityLabel={t('demo.checkApi')}
          onPress={() => void runProbe()}
          style={{
            minHeight: touchTargetDp,
            justifyContent: 'center',
            paddingHorizontal: space.s3,
            backgroundColor: color.primary,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: color.surface, fontWeight: '600' }}>{t('demo.checkApi')}</Text>
        </Pressable>
        <Text testID="api-probe" style={{ color: color.textMuted, fontSize: typography.sm.sp }}>
          {probeText()}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
        {stateSlugs.map((candidate) => (
          <Pressable
            key={candidate}
            testID={`state-${candidate}`}
            accessibilityRole="button"
            accessibilityLabel={`${t('demo.openState')} ${candidate}`}
            onPress={() => setSlug(candidate)}
            style={{
              minHeight: touchTargetDp,
              justifyContent: 'center',
              paddingHorizontal: space.s3,
              backgroundColor: candidate === slug ? color.primary : color.surface,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: candidate === slug ? color.surface : color.text }}>
              {candidate}
            </Text>
          </Pressable>
        ))}
      </View>
      <NativeStateSurface state={fixtureFor(slug)} t={t}>
        <Text testID="state-content" style={{ color: color.textMuted, fontSize: typography.sm.sp }}>
          {t('demo.sampleContent')}
        </Text>
      </NativeStateSurface>
    </ScrollView>
  );
}
