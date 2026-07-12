module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // pnpm의 real path는 node_modules/.pnpm 아래에 있으므로 RN preset의
  // 기본 allow-list를 두 단계 모두에 적용해야 ESM setup을 변환할 수 있다.
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(?:@react-native\\+|react-native@|@react-native-community\\+|@react-native-async-storage\\+|@noble\\+hashes@))',
    'node_modules/(?!\\.pnpm|(?:jest-)?react-native|@react-native(?:-community)?/|@react-native-async-storage/|@noble/hashes/)',
  ],
};
