/**
 * HB-277 — ăn uống ở ga (như `/dining` của web, HB-318): ba khung giờ trên bảng ga kèm trạng thái bằng chữ,
 * khối "Giá đã gồm" trên giấy vé (đã gồm / thêm cho Dorm / chưa gồm), gợi ý quanh từng ga, báo trước cho ga.
 */
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DINING_SERVICES, diningPageCopy, includedCopy } from '@pinehill/content/dining-page';
import { landingContent } from '@pinehill/content/landing-content';
import { Board, BoardRow, FieldLabel, Ticket, space } from '@pinehill/ui-native';
import { ct } from '../src/content/text';
import { Paragraphs, Section, SlotPhoto } from '../src/content/parts';
import { currentLocale } from '../src/i18n/locale';
import { theme } from '../src/theme';

export default function DiningScreen(): ReactElement {
  const locale = currentLocale();
  const copy = diningPageCopy(locale);
  const includes = includedCopy(locale);
  const stations = landingContent(locale).stations;
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.dining.title')}
      </Text>
      <Text style={theme.body}>{copy.summary}</Text>
      <Board title={ct('guest.dining.servicesTitle')}>
        {DINING_SERVICES.map((service) => (
          <BoardRow
            key={service.id}
            label={`${service.hours} · ${copy.services[service.id].name}`}
            value={ct(`guest.dining.status.${service.status}`)}
          />
        ))}
      </Board>
      {DINING_SERVICES.map((service) => (
        <View key={service.id} style={theme.card}>
          <SlotPhoto id={`an-${service.id}`} />
          <Text style={theme.sectionTitle}>{copy.services[service.id].name}</Text>
          <Text style={theme.body}>{copy.services[service.id].body}</Text>
        </View>
      ))}
      <Ticket testID="price-includes">
        <Text accessibilityRole="header" style={theme.sectionTitle}>
          {ct('guest.includes.title')}
        </Text>
        <FieldLabel onTicket>{ct('guest.includes.all')}</FieldLabel>
        <Paragraphs lines={includes.included.map((line) => `– ${line}`)} />
        <FieldLabel onTicket>{ct('guest.includes.dorm')}</FieldLabel>
        <Paragraphs lines={includes.dorm.map((line) => `– ${line}`)} />
        <FieldLabel onTicket>{ct('guest.includes.excluded')}</FieldLabel>
        <Paragraphs lines={includes.excluded.map((line) => `– ${line}`)} />
      </Ticket>
      <Section title={ct('guest.dining.nearbyTitle')}>
        <Text style={theme.muted}>{copy.nearbyLede}</Text>
        {stations.map((station) => (
          <View key={station.code} style={{ gap: space.s1 }}>
            <Text style={theme.label}>{station.name}</Text>
            <Paragraphs lines={copy.nearby[station.code] ?? []} />
          </View>
        ))}
      </Section>
      <Section title={ct('guest.dining.notesTitle')}>
        <Paragraphs lines={copy.notes} />
      </Section>
    </ScrollView>
  );
}
