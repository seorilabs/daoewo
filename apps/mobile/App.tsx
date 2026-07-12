import {
  DaoewoApp,
  MOBILE_AUTH_OPTIONS,
  type DaoewoRuntime,
} from '@daoewo/product-ui';
import {useMemo} from 'react';
import {Platform, StatusBar, useColorScheme} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {createOfflineMobileRuntime} from './src/offline-runtime';
import {MOBILE_RUNTIME_CONFIG} from './src/runtime-config';

function createRuntime(): DaoewoRuntime {
  if (!MOBILE_RUNTIME_CONFIG.firebaseEnabled) {
    return createOfflineMobileRuntime(MOBILE_RUNTIME_CONFIG.legalUrls);
  }
  // Firebase native config가 있을 때만 실제 native module을 초기화한다.
  const {createMobileRuntime} = require('./src/mobile-runtime') as typeof import('./src/mobile-runtime');
  return createMobileRuntime(MOBILE_RUNTIME_CONFIG);
}

export default function App() {
  const dark = useColorScheme() === 'dark';
  const runtime = useMemo(createRuntime, []);
  const authOptions =
    Platform.OS === 'ios'
      ? MOBILE_AUTH_OPTIONS
      : MOBILE_AUTH_OPTIONS.filter(option => option.provider === 'google');

  return (
    <SafeAreaProvider>
      <StatusBar
        backgroundColor={dark ? '#10131C' : '#F7F8FC'}
        barStyle={dark ? 'light-content' : 'dark-content'}
      />
      <DaoewoApp runtime={runtime} authOptions={authOptions} />
    </SafeAreaProvider>
  );
}
