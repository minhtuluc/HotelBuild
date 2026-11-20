/**
 * HB-277 — khối dựng chung của màn nội dung: ảnh ô (tải từ web, lỗi thì ẩn), mục có tiêu đề, đoạn văn,
 * hàng dt/dd kẻ chấm như "mặt sau vé" của web. Chỉ dùng ba vật liệu: giấy in, giấy vé, bảng ga.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Image, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { photoAlt, slotById } from '@pinehill/content/photo-slots';
import { EXTRA_PHOTOS } from '@pinehill/content/photo-slots-extra';
import { color, FieldLabel, radius, space } from '@pinehill/ui-native';
import { currentLocale } from '../i18n/locale';
import { theme } from '../theme';
import { photoUri } from './photos';

function slotFor(id: string) {
  return slotById(id) ?? EXTRA_PHOTOS.find((slot) => slot.id === id);
}

/** Tiêu đề header của route nội dung (route không có trong `SCREEN_TITLES`). */
export function ScreenHeader({ title }: { title: string }): ReactElement {
  return <Stack.Screen options={{ title }} />;
}

/** Ảnh một ô; khung giấy in như "ảnh kẹp" của web. Không có origin web hoặc tải lỗi thì ẩn hẳn. */
export function SlotPhoto({
  id,
  ratio = 4 / 3,
}: {
  id: string;
  ratio?: number;
}): ReactElement | null {
  const [failed, setFailed] = useState(false);
  const uri = photoUri(id);
  const slot = slotFor(id);
  if (uri === null || failed) return null;
  return (
    <View
      style={{
        backgroundColor: color.surface,
        padding: 6,
        borderRadius: radius.sm,
        elevation: 2,
        shadowColor: '#121614',
      }}
    >
      <Image
        source={{ uri }}
        accessibilityLabel={slot === undefined ? undefined : photoAlt(slot, currentLocale())}
        resizeMode="cover"
        onError={() => setFailed(true)}
        style={{ width: '100%', aspectRatio: ratio, borderRadius: 2 }}
      />
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <View style={{ gap: space.s2 }}>
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Paragraphs({ lines }: { lines: readonly string[] }): ReactElement {
  return (
    <>
      {lines.map((line) => (
        <Text key={line} style={theme.body}>
          {line}
        </Text>
      ))}
    </>
  );
}

/** Một dòng thông số in trên giấy vé: nhãn chữ hoa phía trên, giá trị bên dưới, kẻ chấm ngăn dòng. */
export function SpecRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View
      style={{
        gap: 2,
        paddingVertical: space.s2,
        borderBottomWidth: 1,
        borderStyle: 'dotted',
        borderColor: color.primary,
      }}
    >
      <FieldLabel onTicket>{label}</FieldLabel>
      <Text style={theme.body}>{value}</Text>
    </View>
  );
}
