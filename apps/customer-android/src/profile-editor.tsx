/**
 * HB-260 — form sửa hồ sơ (SCR-83): họ tên, email, đồng ý nhận khuyến mãi → `PATCH /guests/me`.
 * SĐT là định danh tài khoản (BR-CRM-01) nên chỉ hiện ghi chú, không có ô sửa. Kiểm tại chỗ trước khi gửi;
 * hồ sơ hiển thị sau khi lưu là bản máy chủ trả, không tự ghép.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { color, space } from '@pinehill/ui-native';
import type { GuestSummary } from '@pinehill/contracts';
import type { NetInfoSource } from './netinfo';
import {
  draftOf,
  saveProfile,
  updateRequestFor,
  type ProfileApi,
  type ProfileDraft,
} from './profile';
import { t } from './strings';
import { theme } from './theme';

function Input({
  label,
  value,
  onChange,
  email = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  email?: boolean;
}): ReactElement {
  return (
    <View style={{ gap: space.s1 }}>
      <Text style={{ color: color.text }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCapitalize={email ? 'none' : 'words'}
        keyboardType={email ? 'email-address' : 'default'}
        placeholderTextColor={color.textMuted}
        style={theme.field}
      />
    </View>
  );
}

export function ProfileEditor({
  guest,
  api,
  net,
  onSaved,
}: {
  guest: GuestSummary;
  api: ProfileApi;
  net: NetInfoSource;
  onSaved: (profile: GuestSummary) => void;
}): ReactElement {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(guest));
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Hồ sơ mới (tải lại/lưu xong) thì form về đúng bản máy chủ.
  useEffect(() => setDraft(draftOf(guest)), [guest]);

  const save = async (): Promise<void> => {
    const built = updateRequestFor(draft, guest);
    if (!built.ok) {
      setMessage({ text: t(`profile.edit.issue.${built.issue}`), ok: false });
      return;
    }
    setBusy(true);
    const outcome = await saveProfile({ api, net }, built.request);
    setBusy(false);
    if (outcome.kind === 'saved') {
      setMessage({ text: t('profile.edit.saved'), ok: true });
      onSaved(outcome.profile);
      return;
    }
    setMessage({
      text:
        outcome.kind === 'offline'
          ? t('guest.offline')
          : t('profile.edit.failed', { code: outcome.code ?? 'UNKNOWN' }),
      ok: false,
    });
  };

  return (
    <View style={theme.card} testID="profile-editor">
      <Text accessibilityRole="header" style={theme.sectionTitle}>
        {t('profile.edit.title')}
      </Text>
      <Input
        label={t('profile.name')}
        value={draft.fullName}
        onChange={(fullName) => setDraft((previous) => ({ ...previous, fullName }))}
      />
      <Input
        label={t('profile.email')}
        value={draft.email}
        email
        onChange={(email) => setDraft((previous) => ({ ...previous, email }))}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2 }}>
        <Switch
          accessibilityLabel={t('profile.edit.consent')}
          value={draft.consent}
          onValueChange={(consent) => setDraft((previous) => ({ ...previous, consent }))}
        />
        <Text style={{ color: color.text, flex: 1 }}>{t('profile.edit.consent')}</Text>
      </View>
      <Text style={theme.muted}>{t('profile.edit.phoneNote')}</Text>
      {message === null ? null : (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: message.ok ? color.success : color.danger }}
        >
          {message.text}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.edit.save')}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => void save()}
        style={[theme.buttonPrimary, busy ? { backgroundColor: color.borderStrong } : null]}
      >
        <Text style={theme.buttonPrimaryText}>{t('profile.edit.save')}</Text>
      </Pressable>
    </View>
  );
}
