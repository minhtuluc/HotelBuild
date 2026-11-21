/**
 * HB-277 — thư viện ảnh (như `/gallery` của web): lọc theo nhóm (áp phích ga, phòng ở ga, cảnh quanh ga,
 * hạng phòng); mỗi ảnh có văn bản thay thế theo ngôn ngữ. Ảnh tải từ web, ô chưa có file thì tự ẩn.
 */
import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { chainPagesCopy } from '@pinehill/content/chain-pages';
import {
  GALLERY_GROUPS,
  galleryEntries,
  type GalleryGroup,
} from '@pinehill/content/gallery-entries';
import { color, space } from '@pinehill/ui-native';
import { ct } from '../src/content/text';
import { SlotPhoto } from '../src/content/parts';
import { currentLocale } from '../src/i18n/locale';
import { theme } from '../src/theme';

type Filter = GalleryGroup | 'all';

export default function GalleryScreen(): ReactElement {
  const [filter, setFilter] = useState<Filter>('all');
  const entries = galleryEntries().filter((entry) => filter === 'all' || entry.group === filter);
  const filters: readonly Filter[] = ['all', ...GALLERY_GROUPS];
  return (
    <ScrollView style={theme.scroll} contentContainerStyle={theme.scrollContent}>
      <Text accessibilityRole="header" style={theme.title}>
        {ct('guest.chain.gallery.title')}
      </Text>
      <Text style={theme.body}>{chainPagesCopy(currentLocale()).gallery.summary}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={ct('guest.chain.gallery.byGroup')}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}
      >
        {filters.map((value) => (
          <Pressable
            key={value}
            testID={`gallery-filter-${value}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: filter === value }}
            onPress={() => setFilter(value)}
            style={[
              theme.buttonSecondary,
              filter === value ? { borderColor: color.primary, borderWidth: 2 } : null,
            ]}
          >
            <Text style={theme.buttonSecondaryText}>
              {value === 'all'
                ? ct('guest.chain.gallery.all')
                : ct(`guest.chain.gallery.group.${value}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={theme.muted}>{ct('guest.chain.gallery.count', { n: entries.length })}</Text>
      {entries.length === 0 ? (
        <Text style={theme.body}>{ct('guest.chain.gallery.empty')}</Text>
      ) : (
        entries.map((entry) => (
          <SlotPhoto key={entry.id} id={entry.id} ratio={entry.shape === 'tall' ? 3 / 4 : 4 / 3} />
        ))
      )}
    </ScrollView>
  );
}
