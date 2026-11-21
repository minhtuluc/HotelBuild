/** Chọn cơ sở đang làm việc khi nhân viên có nhiều cơ sở (QĐ-03 quyết định 9, SCR-56). */
import { useEffect, useState, type ReactElement } from 'react';
import { loadPropertyNames, propertyLabel, type NamedProperty } from '../src/property-names';
import { Pressable, Text, View } from 'react-native';
import { t } from '../src/strings';
import { theme } from '../src/theme';

export interface SelectPropertyScreenProps {
  properties: readonly string[];
  onSelect: (propertyId: string) => void;
  /** HB-264: nguồn tên cơ sở; vắng hoặc lỗi thì hiện id. */
  listProperties?: () => Promise<readonly NamedProperty[]>;
}

export default function SelectPropertyScreen({
  properties,
  onSelect,
  listProperties,
}: SelectPropertyScreenProps): ReactElement {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (listProperties === undefined) return;
    let cancelled = false;
    void loadPropertyNames(listProperties).then((loaded) => {
      if (!cancelled) setNames(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [listProperties]);
  return (
    <View style={theme.screen}>
      <Text style={theme.title}>{t('property.select')}</Text>
      {properties.map((propertyId) => (
        <Pressable
          key={propertyId}
          testID={`property-${propertyId}`}
          accessibilityRole="button"
          accessibilityLabel={`${t('property.open')} ${propertyLabel(propertyId, names)}`}
          onPress={() => onSelect(propertyId)}
          style={[theme.buttonSecondary, { alignItems: 'flex-start' }]}
        >
          <Text style={theme.body}>{propertyLabel(propertyId, names)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
