/** Chọn cơ sở đang làm việc khi nhân viên có nhiều cơ sở (QĐ-03 quyết định 9, SCR-56). */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../src/strings';
import { theme } from '../src/theme';

export interface SelectPropertyScreenProps {
  properties: readonly string[];
  onSelect: (propertyId: string) => void;
}

export default function SelectPropertyScreen({
  properties,
  onSelect,
}: SelectPropertyScreenProps): ReactElement {
  return (
    <View style={theme.screen}>
      <Text style={theme.title}>{t('property.select')}</Text>
      {properties.map((propertyId) => (
        <Pressable
          key={propertyId}
          testID={`property-${propertyId}`}
          accessibilityRole="button"
          accessibilityLabel={`${t('property.open')} ${propertyId}`}
          onPress={() => onSelect(propertyId)}
          style={[theme.buttonSecondary, { alignItems: 'flex-start' }]}
        >
          <Text style={theme.body}>{propertyId}</Text>
        </Pressable>
      ))}
    </View>
  );
}
