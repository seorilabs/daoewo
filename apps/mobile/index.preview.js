/**
 * @format
 */

import {AppRegistry} from 'react-native';
import {name as appName} from './app.json';

if (!__DEV__) {
  throw new Error('CONTENT_PREVIEW_REQUIRES_DEBUG_BUILD');
}

const PreviewApp = require('./src/dev-preview/PreviewApp').default;

AppRegistry.registerComponent(appName, () => PreviewApp);
