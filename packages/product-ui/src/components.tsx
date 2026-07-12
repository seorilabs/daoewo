import type {PropsWithChildren, ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import type {DaoewoScreen} from './navigation';
import {type DaoewoColors, useDaoewoTheme} from './theme';

export function AppText({style, ...props}: TextProps) {
  const {colors} = useDaoewoTheme();

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={2}
      {...props}
      style={[styles.text, {color: colors.text}, style]}
    />
  );
}

interface ScreenProps extends PropsWithChildren {
  readonly scroll?: boolean;
  readonly footer?: ReactNode;
  readonly accessibilityLabel?: string;
}

export function Screen({
  children,
  scroll = true,
  footer,
  accessibilityLabel,
}: ScreenProps) {
  const {colors, isDark} = useDaoewoTheme();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.fixedContent}>{children}</View>
  );

  return (
    <SafeAreaView
      accessibilityLabel={accessibilityLabel}
      style={[styles.safeArea, {backgroundColor: colors.background}]}>
      <StatusBar
        backgroundColor={colors.background}
        barStyle={isDark ? 'light-content' : 'dark-content'}
      />
      {content}
      {footer}
    </SafeAreaView>
  );
}

interface TopBarProps {
  readonly title: string;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly trailing?: ReactNode;
}

export function TopBar({
  title,
  onBack,
  backLabel = '뒤로',
  trailing,
}: TopBarProps) {
  const {colors} = useDaoewoTheme();

  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            accessibilityHint="이전 화면으로 이동합니다"
            hitSlop={12}
            onPress={onBack}
            style={({pressed}) => [
              styles.topBarAction,
              {backgroundColor: pressed ? colors.overlay : 'transparent'},
            ]}>
            <AppText style={styles.topBarActionText}>‹</AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText accessibilityRole="header" style={styles.topBarTitle}>
        {title}
      </AppText>
      <View style={[styles.topBarSide, styles.topBarTrailing]}>{trailing}</View>
    </View>
  );
}

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly accessibilityHint?: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly testID?: string;
}

export function PrimaryButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  loading = false,
  testID,
}: ButtonProps) {
  const {colors} = useDaoewoTheme();
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled: unavailable, busy: loading}}
      disabled={unavailable}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.primaryButton,
        {backgroundColor: colors.accent},
        pressed && !unavailable ? styles.pressed : undefined,
        unavailable ? styles.disabled : undefined,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <AppText style={[styles.primaryButtonText, {color: colors.accentText}]}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  testID,
}: ButtonProps) {
  const {colors} = useDaoewoTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.secondaryButton,
        {backgroundColor: colors.surface, borderColor: colors.border},
        pressed && !disabled ? styles.pressed : undefined,
        disabled ? styles.disabled : undefined,
      ]}>
      <AppText style={styles.secondaryButtonText}>{label}</AppText>
    </Pressable>
  );
}

interface TextButtonProps extends ButtonProps {
  readonly tone?: 'accent' | 'muted' | 'danger';
}

export function TextButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  tone = 'accent',
  testID,
}: TextButtonProps) {
  const {colors} = useDaoewoTheme();
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'muted'
        ? colors.textMuted
        : colors.accent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.textButton,
        pressed && !disabled ? styles.pressed : undefined,
      ]}>
      <AppText style={[styles.textButtonText, {color}]}>{label}</AppText>
    </Pressable>
  );
}

interface SurfaceProps extends PropsWithChildren {
  readonly style?: ViewStyle | ViewStyle[];
  readonly accessibilityLabel?: string;
}

export function Surface({children, style, accessibilityLabel}: SurfaceProps) {
  const {colors} = useDaoewoTheme();

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.surface,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

interface SectionHeadingProps {
  readonly title: string;
  readonly detail?: string;
  readonly action?: ReactNode;
}

export function SectionHeading({title, detail, action}: SectionHeadingProps) {
  const {colors} = useDaoewoTheme();

  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionHeadingText}>
        <AppText accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </AppText>
        {detail ? (
          <AppText style={[styles.sectionDetail, {color: colors.textMuted}]}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

interface ProgressBarProps {
  readonly value: number;
  readonly label: string;
  readonly tone?: 'accent' | 'success' | 'warning';
}

export function ProgressBar({
  value,
  label,
  tone = 'accent',
}: ProgressBarProps) {
  const {colors} = useDaoewoTheme();
  const clamped = Math.min(1, Math.max(0, value));
  const fill =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : colors.accent;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{min: 0, max: 100, now: Math.round(clamped * 100)}}
      style={[styles.progressTrack, {backgroundColor: colors.border}]}>
      <View
        style={[
          styles.progressFill,
          {backgroundColor: fill, width: `${clamped * 100}%`},
        ]}
      />
    </View>
  );
}

interface ChipProps {
  readonly label: string;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
}

export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityHint,
}: ChipProps) {
  const {colors} = useDaoewoTheme();
  const backgroundColor = selected ? colors.accentSoft : colors.surface;
  const borderColor = selected ? colors.accent : colors.border;
  const color = selected ? colors.accent : colors.textMuted;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{selected}}
      disabled={!onPress}
      onPress={onPress}
      style={({pressed}) => [
        styles.chip,
        {backgroundColor, borderColor},
        pressed ? styles.pressed : undefined,
      ]}>
      <AppText style={[styles.chipText, {color}]}>{label}</AppText>
    </Pressable>
  );
}

interface BadgeProps {
  readonly label: string;
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
}

export function Badge({label, tone = 'neutral'}: BadgeProps) {
  const {colors} = useDaoewoTheme();
  const toneColors: Record<NonNullable<BadgeProps['tone']>, [string, string]> = {
    accent: [colors.accentSoft, colors.accent],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    neutral: [colors.background, colors.textMuted],
  };
  const [backgroundColor, color] = toneColors[tone];

  return (
    <View style={[styles.badge, {backgroundColor}]}>
      <AppText style={[styles.badgeText, {color}]}>{label}</AppText>
    </View>
  );
}

interface BottomNavigationProps {
  readonly current: 'home' | 'statistics' | 'settings';
  readonly navigate: (screen: DaoewoScreen) => void;
}

export function BottomNavigation({
  current,
  navigate,
}: BottomNavigationProps) {
  const {colors} = useDaoewoTheme();
  const items: ReadonlyArray<{
    key: BottomNavigationProps['current'];
    label: string;
    symbol: string;
  }> = [
    {key: 'home', label: '홈', symbol: '⌂'},
    {key: 'statistics', label: '통계', symbol: '▥'},
    {key: 'settings', label: '설정', symbol: '⚙'},
  ];

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bottomNavigation,
        {backgroundColor: colors.surface, borderTopColor: colors.border},
      ]}>
      {items.map(item => {
        const selected = item.key === current;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={`${item.label} 탭`}
            accessibilityState={{selected}}
            key={item.key}
            onPress={() => navigate(item.key)}
            style={({pressed}) => [
              styles.bottomNavigationItem,
              pressed ? {backgroundColor: colors.overlay} : undefined,
            ]}>
            <AppText
              style={[
                styles.bottomNavigationIcon,
                {color: selected ? colors.accent : colors.textMuted},
              ]}>
              {item.symbol}
            </AppText>
            <AppText
              style={[
                styles.bottomNavigationLabel,
                {color: selected ? colors.accent : colors.textMuted},
              ]}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
}

export function EmptyState({title, description}: EmptyStateProps) {
  const {colors} = useDaoewoTheme();

  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <AppText accessibilityRole="header" style={styles.emptyStateTitle}>
        {title}
      </AppText>
      <AppText style={[styles.emptyStateDescription, {color: colors.textMuted}]}>
        {description}
      </AppText>
    </View>
  );
}

export function titleStyle(colors: DaoewoColors): TextStyle {
  return {color: colors.text};
}

const styles = StyleSheet.create({
  safeArea: {flex: 1},
  fixedContent: {flex: 1, paddingHorizontal: 24, paddingBottom: 18},
  scrollContent: {flexGrow: 1, paddingHorizontal: 24, paddingBottom: 28},
  text: {fontSize: 16, lineHeight: 24},
  topBar: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  topBarSide: {width: 56, alignItems: 'flex-start'},
  topBarTrailing: {alignItems: 'flex-end'},
  topBarAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarActionText: {fontSize: 38, lineHeight: 40, fontWeight: '300'},
  topBarTitle: {fontSize: 18, lineHeight: 24, fontWeight: '700'},
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {fontSize: 17, lineHeight: 24, fontWeight: '700'},
  secondaryButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {fontSize: 16, lineHeight: 22, fontWeight: '600'},
  textButton: {paddingHorizontal: 6, paddingVertical: 8, borderRadius: 8},
  textButtonText: {fontSize: 14, lineHeight: 20, fontWeight: '600'},
  pressed: {opacity: 0.74, transform: [{scale: 0.99}]},
  disabled: {opacity: 0.45},
  surface: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 2,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 30,
    marginBottom: 14,
  },
  sectionHeadingText: {flex: 1, paddingRight: 12},
  sectionTitle: {fontSize: 20, lineHeight: 27, fontWeight: '700'},
  sectionDetail: {fontSize: 14, lineHeight: 20, marginTop: 2},
  progressTrack: {height: 8, width: '100%', overflow: 'hidden', borderRadius: 999},
  progressFill: {height: '100%', borderRadius: 999},
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {fontSize: 14, lineHeight: 19, fontWeight: '600'},
  badge: {alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4},
  badgeText: {fontSize: 12, lineHeight: 16, fontWeight: '700'},
  bottomNavigation: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  bottomNavigationItem: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavigationIcon: {fontSize: 23, lineHeight: 25},
  bottomNavigationLabel: {fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 2},
  emptyState: {alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48},
  emptyStateTitle: {fontSize: 19, lineHeight: 26, fontWeight: '700', textAlign: 'center'},
  emptyStateDescription: {fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8},
});
