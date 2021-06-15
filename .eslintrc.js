module.exports = {
  root: true,
  env: {
    node: true,
  },
  extends: [
    'plugin:vue/essential',
    '@vue/airbnb',
  ],
  rules: {
    'no-console': 'off',
    'no-debugger': 'off',
    'no-alert': 'off',
    'no-await-in-loop': 'off',
    'no-param-reassign': 'off',
    'no-loop-func': 'off',
  },
  parserOptions: {
    parser: 'babel-eslint',
  },
  globals: {
    wx: true,
    _hmt: true,
  },
};
