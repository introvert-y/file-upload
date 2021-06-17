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
    'no-param-reassign': 'off', // 修改函数入参
    'no-loop-func': 'off', // 在循环语句中定于函数
  },
  parserOptions: {
    parser: 'babel-eslint',
  },
  globals: {
    wx: true,
    _hmt: true,
  },
};
