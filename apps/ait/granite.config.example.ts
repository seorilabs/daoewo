import { appsInToss } from '@apps-in-toss/framework/plugins';
import { defineConfig } from '@granite-js/react-native/config';

export default defineConfig({
  scheme: 'intoss',
  appName: 'confirmed-app-name',
  plugins: [
    appsInToss({
      brand: {
        displayName: '확정 필요',
        primaryColor: '#3182F6',
        icon: 'https://placehold.co/600x600/3182F6/FFFFFF.png?text=APP',
      },
      permissions: [],
    }),
  ],
});
