/** HB-249: chọn cơ sở từ `GET /public/properties` thay vì gõ mã — API tìm phòng cần id cơ sở. */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { color, radius, space, touchTargetDp } from '@pinehill/ui-native';
import { initialPropertyId, type PropertyChoice } from './properties';
import { t } from './strings';
import { theme } from './theme';

type Load =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; list: readonly PropertyChoice[] };

export function PropertyPicker({
  load,
  value,
  onChange,
}: {
  load: () => Promise<readonly PropertyChoice[]>;
  value: string;
  onChange: (id: string) => void;
}): ReactElement {
  const [state, setState] = useState<Load>({ kind: 'loading' });

  const fetchList = useCallback(async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const list = await load();
      setState({ kind: 'ready', list });
      const chosen = initialPropertyId(list, value);
      if (chosen !== value) onChange(chosen);
    } catch {
      setState({ kind: 'failed' });
    }
  }, [load, onChange, value]);

  useEffect(() => {
    void fetchList();
    // Chỉ tải một lần khi mở màn; chọn cơ sở không cần tải lại danh sách.
  }, []);

  return (
    <View style={{ gap: space.s2 }}>
      <Text style={{ color: color.text }}>{t('search.form.property')}</Text>
      {state.kind === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel={t('search.properties.loading')}
          color={color.primary}
        />
      ) : null}
      {state.kind === 'failed' ? (
        <View style={{ gap: space.s1 }}>
          <Text accessibilityRole="alert" style={theme.alertDanger}>
            {t('search.properties.failed')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.form.retry')}
            onPress={() => void fetchList()}
            style={theme.buttonPlain}
          >
            <Text style={theme.buttonPlainText}>{t('search.form.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
      {state.kind === 'ready'
        ? state.list.map((property) => (
            <Pressable
              key={property.id}
              testID={`property-${property.id}`}
              accessibilityRole="radio"
              accessibilityLabel={t('search.properties.option', { name: property.name })}
              accessibilityState={{ checked: value === property.id }}
              onPress={() => onChange(property.id)}
              style={{
                backgroundColor: color.surface,
                borderColor: value === property.id ? color.primary : color.border,
                borderRadius: radius.md,
                borderWidth: value === property.id ? 2 : 1,
                justifyContent: 'center',
                minHeight: touchTargetDp,
                paddingHorizontal: space.s3,
              }}
            >
              <Text style={{ color: color.text }}>{property.name}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}
