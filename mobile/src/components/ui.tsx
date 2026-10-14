import { SymbolView, type SFSymbol } from 'expo-symbols';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  const theme = useTheme();
  const inactive = Boolean(loading || disabled);

  const background =
    variant === 'primary' ? theme.text : variant === 'danger' ? 'transparent' : theme.surface;
  const foreground =
    variant === 'primary' ? theme.onInk : variant === 'danger' ? theme.danger : theme.text;
  const borderColor = variant === 'primary' ? theme.text : variant === 'danger' ? theme.danger : theme.line;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor },
        (pressed || inactive) && styles.dimmed,
      ]}>
      {loading ? <ActivityIndicator color={foreground} /> : null}
      <ThemedText style={[styles.buttonLabel, { color: foreground }]}>{label}</ThemedText>
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label: string };

export function Field({ label, style, multiline, ...rest }: FieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { backgroundColor: theme.surface, borderColor: theme.line, color: theme.text },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

type SwitchRowProps = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export function SwitchRow({ label, value, onValueChange }: SwitchRowProps) {
  const theme = useTheme();

  return (
    <View style={styles.switchRow}>
      <ThemedText style={styles.switchLabel}>{label}</ThemedText>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
      />
    </View>
  );
}

type SegmentedProps<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function Segmented<T extends string>({ options, value, onChange, disabled = false }: SegmentedProps<T>) {
  const theme = useTheme();

  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            style={[styles.segment, selected && { backgroundColor: theme.text }]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.onInk : theme.text }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A card that groups related rows on a form or account screen. */
export function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      {children}
    </View>
  );
}

type StateViewProps = {
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Centered empty or error message, optionally with one action. */
export function StateView({ title, hint, actionLabel, onAction }: StateViewProps) {
  const theme = useTheme();

  return (
    <View style={styles.state}>
      <ThemedText type="smallBold" style={styles.centerText}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
          {hint}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={12}>
          <ThemedText type="smallBold" style={{ color: theme.accentDeep }}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function LoadingView() {
  const theme = useTheme();

  return (
    <View style={styles.state}>
      <ActivityIndicator color={theme.accentDeep} />
    </View>
  );
}

type HeaderButtonProps = {
  symbol: SFSymbol;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** Icon button for a navigation header; the label is its accessible name. */
export function HeaderButton({ symbol, label, onPress, disabled }: HeaderButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={({ pressed }) => [styles.headerButton, (pressed || disabled) && styles.dimmed]}>
      <SymbolView
        name={symbol}
        size={22}
        tintColor={theme.text}
        fallback={<ThemedText type="smallBold">{label}</ThemedText>}
      />
    </Pressable>
  );
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 GB';

  const gigabytes = bytes / 1024 ** 3;
  if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;

  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  buttonLabel: { fontSize: 16, fontWeight: 700 },
  dimmed: { opacity: 0.55 },
  field: { gap: Spacing.two },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  inputMultiline: {
    minHeight: 104,
    paddingVertical: Spacing.three,
    textAlignVertical: 'top',
  },
  switchRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchLabel: { flex: 1 },
  segmented: {
    flexDirection: 'row',
    borderRadius: Radius.control,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.control - Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  centerText: { textAlign: 'center' },
  headerButton: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
