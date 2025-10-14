// Karma configuration with coverage thresholds
module.exports = function (config) {
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

  // Custom launcher tuned for containerized CI (no sandbox, disable GPU, etc.)
  const customLaunchers = {
    ChromeHeadlessCI: {
      base: 'ChromeHeadless',
      flags: [
        '--headless=new',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--mute-audio'
      ]
    }
  };

  const browsersEnv = process.env.KARMA_BROWSERS;
  const browsers = browsersEnv ? browsersEnv.split(',') : [isCI ? 'ChromeHeadlessCI' : 'ChromeHeadless'];

  config.set({
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    reporters: ['progress', 'coverage'],
    customLaunchers,
    browsers,
    singleRun: true,
    coverageReporter: {
      dir: require('path').join(__dirname, 'coverage'),
      reports: ['html', 'lcovonly', 'text-summary'],
      fixWebpackSourcePaths: true,
      thresholds: {
        emitWarning: false,
        global: {
          statements: 70,
          branches: 60,
          functions: 70,
          lines: 70
        }
      }
    }
  });
};
