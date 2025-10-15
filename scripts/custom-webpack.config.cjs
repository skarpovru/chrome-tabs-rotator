const webpack = require('webpack');

const isProd = process.env.NODE_ENV === 'production';

/** @type {import('webpack').Configuration} */
module.exports = {
  entry: { background: { import: 'src/background/background.ts', runtime: false } },
  plugins: [
    new webpack.DefinePlugin({
      __E2E_TESTING__: JSON.stringify(!isProd) // true in dev/test, false in production builds
    })
  ]
};
