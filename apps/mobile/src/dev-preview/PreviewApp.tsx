import {DaoewoApp} from '@daoewo/product-ui';
import {useMemo} from 'react';
import {StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {
  createMobileContentPreviewRuntime,
  type MobileContentPreviewArtifact,
} from './content-preview-runtime';

const previewArtifact = require('../../.work/content-preview.generated.json') as MobileContentPreviewArtifact;

export default function PreviewApp() {
  const runtime = useMemo(
    () => createMobileContentPreviewRuntime(previewArtifact),
    [],
  );

  return (
    <SafeAreaProvider>
      <StatusBar backgroundColor="#7A2E00" barStyle="light-content" />
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.bannerTitle}>
            DEV · 미승인 콘텐츠
          </Text>
          <Text style={styles.bannerDetail}>
            분석 · 동기화 · 결제 · 공유 · 알림 OFF
          </Text>
        </SafeAreaView>
        <View style={styles.app}>
          <DaoewoApp
            runtime={runtime}
            initialScreen="catalog"
            authOptions={[]}
          />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  banner: {
    alignItems: 'center',
    backgroundColor: '#7A2E00',
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  bannerDetail: {
    color: '#FFE0CC',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  app: {
    flex: 1,
  },
});
