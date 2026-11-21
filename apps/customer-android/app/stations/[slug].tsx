/**
 * HB-277 — tờ giới thiệu ga (như `/stays/[slug]` của web, DESIGN.md "Station Sheet"): áp phích ga, tóm tắt,
 * bảng ga (độ cao, khí hậu, mùa đẹp), chuyện về ga, chặng đến ga, một ngày tại ga, lịch mùa, ảnh, các hạng
 * phòng ở ga. Không đoán giờ nhận/trả phòng: giờ thật ở bước tìm phòng.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { monthRange } from '@pinehill/i18n';
import { landingContent } from '@pinehill/content/landing-content';
import { propertyPageCopy, propertyPageKey } from '@pinehill/content/property-pages';
import { Board, BoardRow, Button, space } from '@pinehill/ui-native';
import { ct } from '../../src/content/text';
import { Paragraphs, ScreenHeader, Section, SlotPhoto } from '../../src/content/parts';
import { currentLocale } from '../../src/i18n/locale';
import { t } from '../../src/strings';
import { theme } from '../../src/theme';

export default function StationScreen(): ReactElement {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const locale = currentLocale();
  const page = propertyPageKey(slug ?? '');
  const copy = propertyPageCopy(slug ?? '', locale);
  const station = landingContent(locale).stations.find((item) => item.code === page?.stationCode);
  if (page === undefined || copy === undefined || station === undefined)
    return (
      <View style={theme.screen}>
        <Text style={theme.body}>{t('screen.notFound')}</Text>
      </View>
    );
  const cabins = landingContent(locale).cabinClasses.filter((cabin) =>
    page.featuredRoomCodes.some((code) => code === cabin.code),
  );
  const dayLabels = [
    ct('guest.station.day.morning'),
    ct('guest.station.day.midday'),
    ct('guest.station.day.evening'),
  ];
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <ScreenHeader title={ct('guest.station.title', { name: station.name })} />
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.station.title', { name: station.name })}
      </Text>
      <Text style={theme.muted}>{station.kind}</Text>
      <SlotPhoto id={page.posterPhotoId} ratio={3 / 4} />
      <Text style={theme.body}>{copy.summary}</Text>
      <Button
        role="accent"
        size="lg"
        label={ct('guest.station.cta')}
        onPress={() => router.push('/search')}
      />
      <Board title={ct('guest.station.timetable', { name: station.name })}>
        <BoardRow label={station.altitude} />
        <BoardRow label={station.climate} />
        <BoardRow label={station.bestMonths} />
      </Board>
      <Section title={ct('guest.station.storyTitle')}>
        <Paragraphs lines={copy.story} />
      </Section>
      <Section title={ct('guest.station.arrivalTitle')}>
        <View style={theme.ticket}>
          {copy.legs.map((leg) => (
            <View key={leg.route} style={{ gap: 2 }}>
              <Text style={theme.label}>{leg.time}</Text>
              <Text style={theme.body}>{leg.route}</Text>
            </View>
          ))}
        </View>
        <Text style={theme.muted}>{copy.arrivalNote}</Text>
      </Section>
      <Section title={ct('guest.station.dayTitle')}>
        {copy.day.map((line, index) => (
          <View key={line} style={{ gap: 2 }}>
            <Text style={theme.label}>{dayLabels[index]}</Text>
            <Text style={theme.body}>{line}</Text>
          </View>
        ))}
      </Section>
      <Section title={ct('guest.station.seasonsTitle', { name: station.name })}>
        {copy.seasons.map((season, index) => (
          <View key={season.name} style={[theme.card, { gap: space.s1 }]}>
            <Text style={theme.label}>{monthRange(page.seasonMonths[index] ?? [], locale)}</Text>
            <Text style={theme.sectionTitle}>{season.name}</Text>
            <Text style={theme.body}>{season.weather}</Text>
            <Text style={theme.muted}>{season.tip}</Text>
          </View>
        ))}
      </Section>
      <Section title={ct('guest.station.galleryTitle')}>
        {page.galleryIds.map((id) => (
          <SlotPhoto key={id} id={id} />
        ))}
      </Section>
      <Board title={ct('guest.station.roomsTitle', { name: station.name })}>
        {cabins.map((cabin) => (
          <BoardRow
            key={cabin.code}
            label={`${cabin.code} · ${cabin.name}`}
            value={cabin.capacity}
            onPress={() =>
              router.push({ pathname: '/cabins/[code]', params: { code: cabin.code } })
            }
          />
        ))}
      </Board>
    </ScrollView>
  );
}
