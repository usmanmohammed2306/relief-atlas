export type Theme = 'daylight' | 'night';

type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type StorageAccess = () => AppearanceStorage;
const browserStorage: StorageAccess = () => window.localStorage;

/** Daylight is the welcome appearance; only an explicit Night choice overrides it. */
export function readTheme(storage: StorageAccess = browserStorage): Theme {
  try {
    return storage().getItem('relief-theme') === 'night' ? 'night' : 'daylight';
  } catch {
    return 'daylight';
  }
}

/** Appearance is optional browser state. A failed save must not break a toggle. */
export function persistTheme(theme: Theme, storage: StorageAccess = browserStorage): boolean {
  try {
    storage().setItem('relief-theme', theme);
    return true;
  } catch {
    return false;
  }
}
