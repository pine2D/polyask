import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import { readLocalUiPreferences, writeDisplayPreferences, type LocalUiStorage } from './local-ui-preferences';
export type DisplayStorage = LocalUiStorage;

export interface DisplayDensityTarget {
  readonly dataset: { density?: string };
  readonly style?: { setProperty: (name: string, value: string) => void };
}

export function loadDisplayPreferences(
  storage: DisplayStorage,
  coarsePointer: boolean
): DisplayPreferences {
  const fallback = coarsePointer
    ? { ...DEFAULT_DISPLAY_PREFERENCES, density: "comfortable" as const }
    : DEFAULT_DISPLAY_PREFERENCES;
  return readLocalUiPreferences(storage, fallback).display;
}

export function saveDisplayPreferences(storage: DisplayStorage, value: unknown): boolean {
  return writeDisplayPreferences(storage, value);
}

export function applyDisplayDensity(
  target: DisplayDensityTarget,
  value: DisplayPreferences
): void {
  target.dataset.density = value.density;
}

export function applyDisplayPreferences(
  target: DisplayDensityTarget,
  storage: DisplayStorage,
  value: DisplayPreferences,
  onPersistenceFailure: () => void
): void {
  applyDisplayDensity(target, value);
  if (!saveDisplayPreferences(storage, value)) onPersistenceFailure();
}
