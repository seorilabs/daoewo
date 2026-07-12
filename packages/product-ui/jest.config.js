module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(?:@react-native\\+|react-native@|@daoewo\\+))',
    'node_modules/(?!\\.pnpm|(?:@react-native|react-native|@daoewo)/)',
  ],
};
