import { prepareDevelopmentStart } from './dev-runtime';
// 只准备与核验运行时，不调用 Forge 或启动 Electron，不接触登录档案。
void prepareDevelopmentStart().catch(error => {
  console.error(`Development runtime preparation blocked: ${error.code ?? error.message}`);
  process.exitCode = 1;
});
