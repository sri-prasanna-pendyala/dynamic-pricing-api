module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/app.js', '!src/jobs/worker.js'],
  coverageDirectory: 'coverage',
};
