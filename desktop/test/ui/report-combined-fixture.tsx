import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskSetupNativeFixture } from './task-setup-native-fixture';
import { EvidenceNativeFixture, installEvidenceApi } from './multi-evidence-native-fixture';
import type { ArchiveRecord } from '../../src/shared/archive';
function Combined() {
  const [source, setSource] = useState<ArchiveRecord | null>(null);
  return source ? <EvidenceNativeFixture source={source}/> : <TaskSetupNativeFixture onPrepared={async prompt => {
    const archive = await (window as any).evidenceNative.call('prepareSyntheticAnswers', [prompt]);
    installEvidenceApi(); setSource(archive);
  }}/>;
}
createRoot(document.getElementById('root')!).render(<Combined/>);
