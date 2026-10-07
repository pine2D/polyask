import test from 'node:test';
import { checkNativeReading } from './ui/reading-native-check';

test('native supplementary analysis shows full payload and true submitted, reviewed and saved stages', { timeout: 60000 }, async () => {
  await checkNativeReading('analysis', ['analysis-layout-and-payload-matrix', 'analysis-progress-and-recovered-context',
    'uncertain-submit-and-explicit-source-review', 'saved-analysis-original-requirement']);
});
