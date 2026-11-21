/**
 * HB-277 — hạng khoang (như `/room-types/[code]` của web, DESIGN.md "Cabin Class"): ảnh hạng, tóm tắt, "mặt
 * sau vé" in thông số có nguồn (mã, khoang, sức chứa, chỗ ngủ, phù hợp, giá in theo đêm, trả vé theo gói),
 * bố cục khoang, các ga có hạng này. Không in diện tích, view hay giá khi chưa có dữ liệu thật.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { landingContent } from '@pinehill/content/landing-content';
import { isRoomTypeCode } from '@pinehill/content/room-type-codes';
import { roomTypePageCopy, roomTypePageKey } from '@pinehill/content/room-type-pages';
import { Board, BoardRow, Button, Ticket } from '@pinehill/ui-native';
import { ct } from '../../src/content/text';
import { stationSlug } from '../../src/content/photos';
import { Paragraphs, ScreenHeader, Section, SlotPhoto, SpecRow } from '../../src/content/parts';
import { currentLocale } from '../../src/i18n/locale';
import { t } from '../../src/strings';
import { theme } from '../../src/theme';

export default function CabinScreen(): ReactElement {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const locale = currentLocale();
  const content = landingContent(locale);
  const key = roomTypePageKey(code ?? '');
  const cabin = content.cabinClasses.find((item) => item.code === code);
  const copy =
    code !== undefined && isRoomTypeCode(code) ? roomTypePageCopy(code, locale) : undefined;
  if (key === undefined || cabin === undefined || copy === undefined)
    return (
      <View style={theme.screen}>
        <Text style={theme.body}>{t('screen.notFound')}</Text>
      </View>
    );
  const title = ct('guest.cabin.title', { name: cabin.name });
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <ScreenHeader title={title} />
      <Text accessibilityRole="header" style={theme.title}>
        {title}
      </Text>
      <Text style={theme.muted}>{cabin.cabin}</Text>
      <SlotPhoto id={key.photoId} />
      <Text style={theme.body}>{copy.summary}</Text>
      <Ticket testID="cabin-spec">
        <Text accessibilityRole="header" style={theme.sectionTitle}>
          {ct('guest.cabin.specTitle')}
        </Text>
        <SpecRow label={ct('guest.cabin.spec.code')} value={cabin.code} />
        <SpecRow label={ct('guest.cabin.spec.cabin')} value={cabin.cabin} />
        <SpecRow label={ct('guest.cabin.spec.capacity')} value={cabin.capacity} />
        <SpecRow
          label={ct('guest.cabin.spec.sleeps')}
          value={ct('guest.cabin.spec.sleepsValue', { n: key.sleeps })}
        />
        <SpecRow label={ct('guest.cabin.spec.suits')} value={copy.suits} />
        <SpecRow label={ct('guest.cabin.spec.price')} value={ct('guest.cabin.spec.priceValue')} />
        <SpecRow label={ct('guest.cabin.spec.refund')} value={ct('guest.cabin.spec.refundValue')} />
      </Ticket>
      <Section title={ct('guest.cabin.layoutTitle')}>
        <Text style={theme.body}>{copy.layout}</Text>
        <Paragraphs lines={copy.description} />
      </Section>
      {key.code === 'DOR' ? <Text style={theme.muted}>{ct('guest.cabin.honest.dorm')}</Text> : null}
      <Board title={ct('guest.cabin.stationsTitle')}>
        {content.stations
          .filter((station) => key.stationCodes.includes(station.code))
          .map((station) => {
            const slug = stationSlug(station.code);
            return (
              <BoardRow
                key={station.code}
                label={`${station.code} · ${station.name}`}
                {...(slug === null
                  ? {}
                  : {
                      onPress: () =>
                        router.push({ pathname: '/stations/[slug]', params: { slug } }),
                    })}
              />
            );
          })}
      </Board>
      {key.galleryIds.map((id) => (
        <SlotPhoto key={id} id={id} />
      ))}
      <Button
        role="accent"
        size="lg"
        label={ct('guest.cabin.cta')}
        onPress={() => router.push('/search')}
      />
    </ScrollView>
  );
}
