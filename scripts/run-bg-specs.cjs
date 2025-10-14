/* Executes compiled background specs (precompiled JS) under Jasmine.
 * Assumes `yarn test:bg:build` already ran producing out-tsc/background-spec.
 */
const path = require('path');
const Jasmine = require('jasmine');
const jasmineRunner = new Jasmine();
jasmineRunner.loadConfigFile(path.join(__dirname, '..', 'jasmine.background.json'));
jasmineRunner.configureDefaultReporter({});
// Jasmine 5 uses exitCode via returned promise from execute
jasmineRunner.execute().then((passed) => {
	process.exitCode = passed ? 0 : 1;
});