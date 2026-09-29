'use strict';

const PREVIEW_ENTRY_PATTERN = /^\/index(?=\.(?:bundle|map)(?:\?|$))/;

function rewritePreviewRequestUrl(requestUrl) {
  return requestUrl.replace(PREVIEW_ENTRY_PATTERN, '/index.preview');
}

module.exports = {rewritePreviewRequestUrl};
