import test from 'node:test';
import { checkNativeReading } from './ui/reading-native-check';

test('native capture names and comparison reading preserve keyboard entry across locales and zoom', { timeout: 60000 }, async () => {
  await checkNativeReading('accessibility', ['capture-accessible-name', 'comparison-keyboard-reading']);
});
