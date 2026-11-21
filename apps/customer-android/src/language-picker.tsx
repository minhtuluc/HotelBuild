/**
 * HB-275 — chọn ngôn ngữ ở tab Tài khoản: 6 ngôn ngữ như web khách, mỗi tên viết bằng chính ngôn ngữ đó (không
 * dùng cờ). Chọn xong đổi ngay; layout gốc vẽ lại cả cây theo ngôn ngữ mới và lựa chọn được lưu.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LOCALES, LOCALE_META, type Locale } from '@pinehill/i18n';
import { color, fontFamily, radius, space } from '@pinehill/ui-native';
import { t } from './strings';
import { theme } from './theme';

export function LanguagePicker({
  current,
  onChoose,
}: {
  current: Locale;
  onChoose: (locale: Locale) => void;
}): ReactElement {
  return (
    <View style={theme.card} testID="language-picker" accessibilityRole="radiogroup">
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('language.title')}
      </Text>
      <Text style={theme.muted}>{t('language.hint')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
        {LOCALES.map((locale) => {
          const selected = locale === current;
          return (
            <Pressable
              key={locale}
              testID={`language-${locale}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={LOCALE_META[locale].label}
              onPress={() => onChoose(locale)}
              style={{
                minHeight: 48,
                justifyContent: 'center',
                paddingHorizontal: space.s4,
                borderRadius: radius.sm,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? color.primary : color.borderStrong,
                backgroundColor: selected ? color.primary : color.surface,
              }}
            >
              <Text
                style={{
                  color: selected ? color.primaryContrast : color.text,
                  fontFamily: fontFamily.sansSemiBold,
                }}
              >
                {LOCALE_META[locale].label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
