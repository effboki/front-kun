/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',   // ← ここで src 配下を全部見るよう指定
  ],
  darkMode: false, // ダークモードを無効化
  theme: {
    extend: {},
  },
  plugins: [],
};