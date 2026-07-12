import {useMemo} from 'react';
import {useColorScheme} from 'react-native';

export const DAOEWO_ACCENT = '#4C6FFF';

export interface DaoewoColors {
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly text: string;
  readonly textMuted: string;
  readonly border: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentText: string;
  readonly success: string;
  readonly successSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly overlay: string;
}

export interface DaoewoTheme {
  readonly isDark: boolean;
  readonly colors: DaoewoColors;
}

const lightColors: DaoewoColors = {
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  text: '#171A24',
  textMuted: '#687083',
  border: '#E5E8F0',
  accent: DAOEWO_ACCENT,
  accentSoft: '#EDF0FF',
  accentText: '#FFFFFF',
  success: '#238A61',
  successSoft: '#E9F7F0',
  danger: '#D95050',
  dangerSoft: '#FCEEEE',
  warning: '#BA7600',
  warningSoft: '#FFF5DC',
  overlay: 'rgba(23, 26, 36, 0.08)',
};

const darkColors: DaoewoColors = {
  background: '#10121A',
  surface: '#191C27',
  surfaceRaised: '#202431',
  text: '#F5F6FA',
  textMuted: '#ADB4C5',
  border: '#303544',
  accent: '#7188FF',
  accentSoft: '#283052',
  accentText: '#FFFFFF',
  success: '#65D6A6',
  successSoft: '#17382C',
  danger: '#FF8585',
  dangerSoft: '#472426',
  warning: '#F6BE55',
  warningSoft: '#463718',
  overlay: 'rgba(0, 0, 0, 0.22)',
};

export function useDaoewoTheme(): DaoewoTheme {
  const isDark = useColorScheme() === 'dark';

  return useMemo(
    () => ({isDark, colors: isDark ? darkColors : lightColors}),
    [isDark],
  );
}
