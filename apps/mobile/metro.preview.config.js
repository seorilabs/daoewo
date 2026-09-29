const {mergeConfig} = require('@react-native/metro-config');

const baseConfig = require('./metro.config');
const {rewritePreviewRequestUrl} = require('./preview-request-url');

/**
 * AppDelegate/MainActivity가 요청하는 `index`를 Debug Preview 전용 entry로
 * 바꾼다. 기본 metro.config.js와 production index.js에는 Preview import가 없다.
 */
module.exports = mergeConfig(baseConfig, {
  server: {
    rewriteRequestUrl: rewritePreviewRequestUrl,
  },
});
