/**
 * HB-277 — trải nghiệm quanh ga (như `/experiences` của web): nhóm theo ga, mỗi mục có ảnh, tháng đẹp nhất
 * (hoặc "quanh năm") và nút xem phòng trống ở ga đó.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { monthRange } from '@pinehill/i18n';
import { EXPERIENCES, chainPagesCopy } from '@pinehill/content/chain-pages';
import { landingContent } from '@pinehill/content/landing-content';
import { Button } from '@pinehill/ui-native';
import { ct } from '../src/content/text';
import { Section, SlotPhoto } from '../src/content/parts';
import { currentLocale } from '../src/i18n/locale';
import { theme } from '../src/theme';

export default function ExperiencesScreen(): ReactElement {
  const router = useRouter();
  const locale = currentLocale();
  const copy = chainPagesCopy(locale).experiences;
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.chain.experiences.title')}
      </Text>
      <Text style={theme.body}>{copy.summary}</Text>
      {landingContent(locale).stations.map((station) => (
        <Section
          key={station.code}
          title={ct('guest.chain.gettingHere.station', { name: station.name })}
        >
          {EXPERIENCES.filter((item) => item.stationCode === station.code).map((item) => (
            <View key={item.id} style={theme.card}>
              <SlotPhoto id={`tn-${item.id}`} />
              <Text style={theme.label}>
                {item.months === null
                  ? ct('guest.chain.experiences.yearRound')
                  : monthRange(item.months, locale)}
              </Text>
              <Text style={theme.sectionTitle}>{copy.items[item.id]?.name ?? item.id}</Text>
              <Text style={theme.body}>{copy.items[item.id]?.body ?? ''}</Text>
            </View>
          ))}
          <Button
            role="outline"
            label={ct('guest.chain.experiences.searchCta', { name: station.name })}
            onPress={() => router.push('/search')}
          />
        </Section>
      ))}
    </ScrollView>
  );
}
