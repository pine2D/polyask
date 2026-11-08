import webpack from 'webpack';
import { rendererConfig } from './webpack.renderer.config';

// Only the report preload needs a single self-contained sandbox bundle. Shell remains lazy.
export default { ...rendererConfig, devtool: false,
  plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] };
