import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "tmps/**"]
  }
];

export default eslintConfig;
