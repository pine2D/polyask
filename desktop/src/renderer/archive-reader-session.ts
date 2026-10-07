import { useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';

export interface ArchiveReaderState {
  readonly archiveId: string;
  readonly view: 'read' | 'compare' | 'synthesis';
  readonly leftHost: string;
  readonly rightHost: string;
  readonly differencesOnly: boolean;
  readonly readScroll: number;
  readonly leftScroll: number;
  readonly rightScroll: number;
  readonly synthesisScroll: number;
}
export type ArchiveDetailView = ArchiveReaderState['view'];

export interface ArchiveReaderBinding {
  readonly state: ArchiveReaderState;
  readonly change: (patch: Partial<Omit<ArchiveReaderState, 'archiveId'>>) => void;
}

export function initialArchiveReader(record: Pick<ArchiveRecord, 'id' | 'results'>, compare = false): ArchiveReaderState {
  const sources = record.results.filter(result => !!result.text?.trim());
  return { archiveId: record.id, view: compare && sources.length >= 2 ? 'compare' : 'read',
    leftHost: sources[0]?.host ?? '', rightHost: sources[1]?.host ?? '', differencesOnly: false,
    readScroll: 0, leftScroll: 0, rightScroll: 0, synthesisScroll: 0 };
}

// 只保留当前记录的选择与位置；正文和危险确认仍由各自组件管理。
export function useArchiveReader(record: Pick<ArchiveRecord, 'id' | 'results'>, compare = false,
  saved?: ArchiveReaderState | null, onSave?: (state: ArchiveReaderState) => void): ArchiveReaderBinding {
  const [state, setState] = useState(() => saved?.archiveId === record.id ? saved : initialArchiveReader(record, compare));
  const current = useRef(state), publish = useRef(onSave);
  const previous = useRef(record);
  current.current = state.archiveId === record.id ? state : initialArchiveReader(record, compare); publish.current = onSave;
  const change = (patch: Partial<Omit<ArchiveReaderState, 'archiveId'>>) => {
    const next = { ...current.current, ...patch };
    if (Object.keys(next).every(key => next[key as keyof ArchiveReaderState] === current.current[key as keyof ArchiveReaderState])) return;
    current.current = next; setState(next); publish.current?.(next);
  };
  useLayoutEffect(() => {
    if (state.archiveId !== record.id) setState(current.current);
    const sources = record.results.filter(source => !!source.text?.trim()), old = previous.current;
    const left = sources.find(source => source.host === current.current.leftHost) ?? sources[0];
    const right = sources.find(source => source.host === current.current.rightHost && source.host !== left?.host)
      ?? sources.find(source => source.host !== left?.host);
    const changed = (host: string) => old.id === record.id
      && old.results.find(source => source.host === host)?.text !== record.results.find(source => source.host === host)?.text;
    change({ leftHost: left?.host ?? '', rightHost: right?.host ?? '',
      ...(left?.host !== current.current.leftHost || changed(current.current.leftHost) ? { leftScroll: 0 } : {}),
      ...(right?.host !== current.current.rightHost || changed(current.current.rightHost) ? { rightScroll: 0 } : {}),
      ...(current.current.view === 'compare' && sources.length < 2 ? { view: 'read' as const } : {}) });
    previous.current = record; publish.current?.(current.current);
  }, [record.id, record.results]);
  return { state: state.archiveId === record.id ? state : initialArchiveReader(record, compare), change };
}
