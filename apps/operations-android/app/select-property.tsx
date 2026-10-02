/** Chọn cơ sở đang làm việc khi nhân viên có nhiều cơ sở (QĐ-03 quyết định 9, SCR-56). */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { color, space, touchTargetDp, typography } from '@pinehill/ui-native';
import { t } from '../src/strings';

export interface SelectPropertyScreenProps {
  properties: readonly string[];
  onSelect: (propertyId: string) => void;
}

export default function SelectPropertyScreen({
  properties,
  onSelect,
}: SelectPropertyScreenProps): ReactElement {
  return (
    <View style={{ padding: space.s4, gap: space.s3 }}>
      <Text style={{ fontSize: typography.h1.sp, fontWeight: '700', color: color.text }}>
        {t('property.select')}
      </Text>
      {properties.map((propertyId) => (
        <Pressable
          key={propertyId}
          testID={`property-${propertyId}`}
          accessibilityRole="button"
          accessibilityLabel={`${t('property.open')} ${propertyId}`}
          onPress={() => onSelect(propertyId)}
          style={{
            minHeight: touchTargetDp,
            justifyContent: 'center',
            paddingHorizontal: space.s3,
            backgroundColor: color.surface,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: color.text }}>{propertyId}</Text>
        </Pressable>
      ))}
    </View>
  );
}
