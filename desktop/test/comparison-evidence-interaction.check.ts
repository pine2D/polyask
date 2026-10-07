import test from 'node:test';
import { checkNativeReading } from './ui/reading-native-check';

test('native comparison and literal evidence retain scroll, source identity and manual decision drafts', { timeout: 60000 }, async () => {
  await checkNativeReading('comparison', ['comparison-layout-matrix', 'comparison-focus-and-scroll',
    'literal-worksheet-and-decision', 'raw-follow-up-and-source-boundaries']);
});
