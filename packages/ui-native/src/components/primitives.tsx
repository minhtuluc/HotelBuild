/**
 * HB-272 — thành phần "vé tàu" dùng chung cho hai app Android (DESIGN.md §Components). Mọi style đến từ
 * `styles.ts`; component chỉ nối trạng thái (nhấn, tiêu điểm, giấy vé) và thuộc tính trợ năng.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { color, fontFamily, radius, space, typography } from '../tokens.js';
import {
  boardRowStyle,
  boardStyle,
  buttonStyle,
  fieldStyle,
  labelStyle,
  moneyStyle,
  paperStyle,
  ticketStyle,
  type ButtonRole,
  type ButtonSize,
} from './styles.js';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly role?: ButtonRole;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  /** Đang xử lý: không bấm được, nhãn nên đổi sang dạng "Đang…" ở nơi gọi. */
  readonly busy?: boolean;
  /** Nằm trên giấy vé hồng: đỏ dấu bấm đổi sang đỏ đậm (The Ticket Ink Rule). */
  readonly onTicket?: boolean;
  readonly testID?: string;
}

/**
 * Không dùng context để biết "đang trên giấy vé": các harness UI của app tự thay `useState`/`useEffect`
 * và gọi thẳng component, không có dispatcher cho `useContext`. Nơi đặt nút trên `Ticket` truyền `onTicket`.
 */
export function Button(props: ButtonProps): ReactElement {
  const onTicket = props.onTicket === true;
  const inactive = props.disabled === true || props.busy === true;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: inactive, busy: props.busy === true }}
      disabled={inactive}
      onPress={props.onPress}
      style={({ pressed }) =>
        buttonStyle({
          role: props.role ?? 'primary',
          size: props.size ?? 'md',
          disabled: inactive,
          pressed,
          onTicket,
        }).container
      }
    >
      <Text
        style={
          buttonStyle({
            role: props.role ?? 'primary',
            size: props.size ?? 'md',
            disabled: inactive,
            onTicket,
          }).label
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function Paper({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}): ReactElement {
  return (
    <View testID={testID} style={paperStyle()}>
      {children}
    </View>
  );
}

/** Khối giấy vé hồng. Con đặt trên vé truyền `onTicket` để đổi màu chữ theo The Ticket Ink Rule. */
export function Ticket({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}): ReactElement {
  return (
    <View testID={testID} style={ticketStyle()}>
      {children}
    </View>
  );
}

export function Board({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const style = boardStyle();
  return (
    <View style={style.container}>
      <Text accessibilityRole="header" style={style.title}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function BoardRow(props: {
  label: string;
  value?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}): ReactElement {
  const style = boardRowStyle(props.selected === true);
  const content = (
    <>
      <Text style={style.label}>{props.label}</Text>
      {props.value === undefined ? null : <Text style={style.label}>{props.value}</Text>}
    </>
  );
  if (props.onPress === undefined)
    return (
      <View testID={props.testID} style={style.container}>
        {content}
      </View>
    );
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected === true }}
      onPress={props.onPress}
      style={style.container}
    >
      {content}
    </Pressable>
  );
}

export function FieldLabel(props: { children: string; onTicket?: boolean }): ReactElement {
  return <Text style={labelStyle(props.onTicket === true)}>{props.children}</Text>;
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string;
  readonly error?: string | null;
}

/** Ô nhập kiểu trường in trên vé: nhãn chữ hoa phía trên, lỗi bằng chữ phía dưới. */
export function Field({ label, error, ...input }: FieldProps): ReactElement {
  const [focused, setFocused] = useState(false);
  const invalid = error !== undefined && error !== null && error !== '';
  return (
    <View style={{ gap: space.s1 }}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={color.textMuted}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        style={fieldStyle({ focused, invalid })}
      />
      {invalid ? (
        <Text
          accessibilityRole="alert"
          style={{ color: color.danger, fontFamily: fontFamily.sans }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Money(props: { children: string; onTicket?: boolean }): ReactElement {
  return <Text style={moneyStyle(props.onTicket === true)}>{props.children}</Text>;
}

/** Trạng thái bằng chữ trong viền mảnh — không truyền đạt chỉ bằng màu. */
export function StatusBadge({
  label,
  tone = 'info',
}: {
  label: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}): ReactElement {
  const ink = color[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: ink,
        borderRadius: radius.sm,
        paddingHorizontal: space.s2,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{ color: ink, fontFamily: fontFamily.sansSemiBold, fontSize: typography.caption.sp }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Tiêu đề màn: không có nhãn nhỏ phía trên (The No Eyebrow Rule). */
export function ScreenTitle({
  children,
  display = false,
}: {
  children: string;
  display?: boolean;
}): ReactElement {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: color.text,
        fontFamily: display ? fontFamily.displaySemiBold : fontFamily.sansSemiBold,
        fontSize: display ? typography.display.sp : typography.h1.sp,
      }}
    >
      {children}
    </Text>
  );
}

/** Bước của luồng ("Bước 2/3") là thông tin, không phải nhãn trang trí. */
export function Step(props: { text: string; onTicket?: boolean }): ReactElement {
  return <Text style={labelStyle(props.onTicket === true)}>{props.text}</Text>;
}
