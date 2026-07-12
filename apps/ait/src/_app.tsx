import { AppsInToss } from '@apps-in-toss/framework';
import { TDSProvider } from '@toss/tds-react-native';
import { InitialProps } from '@granite-js/react-native';
import React, { PropsWithChildren } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { context } from '../require.context';

function AppContainer({ children }: PropsWithChildren<InitialProps>) {
  return (
    <SafeAreaProvider>
      <TDSProvider>{children}</TDSProvider>
    </SafeAreaProvider>
  );
}

export default AppsInToss.registerApp(AppContainer, { context });
