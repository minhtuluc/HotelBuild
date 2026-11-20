/**
 * HB-277 — Khám phá: cùng menu "Khám phá" của web khách. Ba bảng ga: ba ga trên tuyến, các hạng phòng, và
 * các trang chuyến đi (ăn uống, trải nghiệm, giá theo số đêm, đường đến, thư viện ảnh). Nội dung lấy từ
 * `@pinehill/content`, câu chữ dùng khoá của web.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { landingContent } from '@pinehill/content/landing-content';
import { Board, BoardRow } from '@pinehill/ui-native';
import { ct, type ContentKey } from '../../src/content/text';
import { stationSlug } from '../../src/content/photos';
import { currentLocale } from '../../src/i18n/locale';
import { theme } from '../../src/theme';

const PAGES: readonly { readonly key: ContentKey; readonly href: Href }[] = [
  { key: 'guest.nav.dining', href: '/dining' },
  { key: 'guest.nav.experiences', href: '/experiences' },
  { key: 'guest.nav.offers', href: '/offers' },
  { key: 'guest.nav.gettingHere', href: '/getting-here' },
  { key: 'guest.nav.gallery', href: '/gallery' },
];

export default function ExploreScreen(): ReactElement {
  const router = useRouter();
  const content = landingContent(currentLocale());
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.nav.exploreTitle')}
      </Text>
      <Board title={ct('guest.nav.stationsGroup')}>
        {content.stations.map((station) => {
          const slug = stationSlug(station.code);
          return (
            <BoardRow
              key={station.code}
              testID={`explore-station-${station.code}`}
              label={`${station.code} · ${station.name}`}
              value={station.altitude}
              {...(slug === null
                ? {}
                : {
                    onPress: () => router.push({ pathname: '/stations/[slug]', params: { slug } }),
                  })}
            />
          );
        })}
      </Board>
      <Board title={ct('guest.nav.classes')}>
        {content.cabinClasses.map((cabin) => (
          <BoardRow
            key={cabin.code}
            testID={`explore-cabin-${cabin.code}`}
            label={`${cabin.code} · ${cabin.name}`}
            value={cabin.capacity}
            onPress={() =>
              router.push({ pathname: '/cabins/[code]', params: { code: cabin.code } })
            }
          />
        ))}
      </Board>
      <Board title={ct('guest.nav.pagesGroup')}>
        {PAGES.map((page) => (
          <BoardRow
            key={page.key}
            testID={`explore-page-${page.key}`}
            label={ct(page.key)}
            onPress={() => router.push(page.href)}
          />
        ))}
      </Board>
    </ScrollView>
  );
}
