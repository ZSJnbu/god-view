import { useSyncExternalStore } from 'react';
import type { AppStore, AppState } from '../app-store.js';

/** 订阅 AppStore。组件只读状态，所有写操作走 store 的方法。 */
export function useAppState(store: AppStore): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
