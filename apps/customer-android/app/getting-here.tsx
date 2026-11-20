/**
 * HB-277 — đường đến ba ga (như `/getting-here` của web): chặng đến từng ga (thời gian ước lượng, không mã
 * chuyến hay giờ chạy), khối khách quốc tế và liên kết cổng thị thực điện tử chính thức.
 */
import type { ReactElement } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EVISA_URL, chainPagesCopy } from '@pinehill/content/chain-pages';
import { landingContent } from '@pinehill/content/landing-content';
import { propertyPageByStation, propertyPageCopy } from '@pinehill/content/property-pages';
import { Button } from '@pinehill/ui-native';
import { ct } from '../src/content/text';
import { Paragraphs, Section } from '../src/content/parts';
import { currentLocale } from '../src/i18n/locale';
import { theme } from '../src/theme';

export default function GettingHereScreen(): ReactElement {
  const router = useRouter();
  const locale = currentLocale();
  const copy = chainPagesCopy(locale).gettingHere;
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.chain.gettingHere.title')}
      </Text>
      <Text style={theme.body}>{copy.summary}</Text>
      {landingContent(locale).stations.map((station) => {
        const page = propertyPageByStation(station.code);
        const legs = page === undefined ? [] : (propertyPageCopy(page.slug, locale)?.legs ?? []);
        return (
          <Section
            key={station.code}
            title={ct('guest.chain.gettingHere.station', { name: station.name })}
          >
            <View style={theme.ticket}>
              {legs.map((leg) => (
                <View key={leg.route} style={{ gap: 2 }}>
                  <Text style={theme.label}>{leg.time}</Text>
                  <Text style={theme.body}>{leg.route}</Text>
                </View>
              ))}
            </View>
            {page === undefined ? null : (
              <Button
                role="outline"
                label={ct('guest.chain.gettingHere.stationLink', { name: station.name })}
                onPress={() =>
                  router.push({ pathname: '/stations/[slug]', params: { slug: page.slug } })
                }
              />
            )}
          </Section>
        );
      })}
      <Section title={ct('guest.chain.gettingHere.international')}>
        <Paragraphs lines={copy.international} />
        <Button
          role="outline"
          label={ct('guest.chain.gettingHere.eVisa')}
          onPress={() => void Linking.openURL(EVISA_URL)}
        />
      </Section>
    </ScrollView>
  );
}
