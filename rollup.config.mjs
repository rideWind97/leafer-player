import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import url from "@rollup/plugin-url";
import dts from "rollup-plugin-dts";

const external = ["leafer-editor", "@leafer-in/flow"];

export default [
  // JS bundles
  {
    input: "index.ts",
    external,
    output: [
      {
        file: "dist/index.js",
        format: "esm",
        sourcemap: true
      },
      {
        file: "dist/index.cjs",
        format: "cjs",
        exports: "named",
        sourcemap: true
      }
    ],
    plugins: [
      // Inline SVG imports so consumers don't need extra bundler loaders.
      url({
        include: ["**/*.svg"],
        limit: Infinity,
        emitFiles: false
      }),
      resolve({ browser: true }),
      commonjs(),
      typescript({
        tsconfig: "tsconfig.rollup.json",
        sourceMap: true,
        declaration: false
      })
    ]
  },

  // Type declarations bundle
  {
    input: "index.ts",
    external,
    output: [{ file: "dist/index.d.ts", format: "es" }],
    plugins: [dts()]
  }
];


