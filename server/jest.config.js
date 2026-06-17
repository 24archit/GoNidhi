/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/dbSetup.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^uuid$': '<rootDir>/tests/__mocks__/uuid.ts'
  },
  reporters: [
    'default',
    ['jest-html-reporter', {
      pageTitle: 'GoNidhi — API Test Report',
      outputPath: 'tests/reports/index.html',
      includeFailureMsg: true,
      includeConsoleLog: false,
      includeSuiteFailure: true,
      theme: 'darkTheme'
    }],
    ['jest-junit', {
      outputDirectory: 'tests/reports',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
    }],
  ],
  collectCoverage: true,
  coverageDirectory: 'tests/reports/coverage',
  coverageReporters: ['text', 'lcov', 'json', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/scripts/**'
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
      diagnostics: false
    }]
  }
};
