import test from 'node:test';
import { checkNativeReading } from './ui/reading-native-check';

test('focused library toolbar gives short windows more reading space and keeps keyboard actions', { timeout: 60000 }, async () => {
  await checkNativeReading('layout', ['focused-toolbar-layout', 'focused-toolbar-keyboard-and-return']);
});
