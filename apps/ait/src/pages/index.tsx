import {createRoute} from '@granite-js/react-native';
import {APPS_IN_TOSS_AUTH_OPTIONS, DaoewoApp} from '@daoewo/product-ui';
import React, {useMemo} from 'react';

import {APPS_IN_TOSS_RUNTIME_CONFIG} from '../runtime-config';
import {
  createAppsInTossBackend,
  createAppsInTossRuntime,
} from '../runtime';

export const Route = createRoute('/', {
  component: Page,
});

function Page() {
  const runtime = useMemo(() => {
    const {apiBaseUrl, firebaseApiKey, legalUrls} = APPS_IN_TOSS_RUNTIME_CONFIG;
    if (apiBaseUrl.length === 0 || firebaseApiKey.length === 0) {
      return createAppsInTossRuntime(undefined, legalUrls);
    }
    return createAppsInTossRuntime(
      createAppsInTossBackend({apiBaseUrl, firebaseApiKey}),
      legalUrls,
    );
  }, []);

  return (
    <DaoewoApp
      runtime={runtime}
      authOptions={APPS_IN_TOSS_AUTH_OPTIONS}
    />
  );
}
