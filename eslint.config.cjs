const js = require('@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const legacyConfig = require('./.eslintrc.cjs');

module.exports = [...compat.config(legacyConfig)];
