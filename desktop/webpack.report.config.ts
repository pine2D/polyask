import webpack from 'webpack';

// Forge loads this file through Node ESM, independently of the root config loader.
// Keep it self-contained; only this preload merges Mermaid's lazy chunks.
export default {
  devtool: false,
  // The merged Mermaid graph is large; avoid a second full-graph minifier peak beside the shell build.
  optimization: { minimize: false },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/,
    use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] }] },
  resolve: { extensions: ['.js', '.ts', '.json'] },
  plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })]
};
