import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  scheme: 'intoss',
  appName: 'daoewo',
  plugins: [
    appsInToss({
      brand: {
        displayName: '다외워',
        primaryColor: '#4C6FFF',
        // AppsInToss Console 등록 후 공개 HTTPS 자산 URL로 교체한다.
        icon: 'https://placehold.co/600x600/4C6FFF/FFFFFF.png?text=D',
      },
      permissions: [],
    }),
  ],
});
