import { RotationState, StorageKeys } from '../app/models';
import { StorageService } from './storage.service';

/**
 * Encapsulates persistence of RotationState and related fields (currentIndex & tabIds normalization).
 */
export class RotationStateRepository {
  constructor(private storage: StorageService) {}

  async load(): Promise<{ state: RotationState; currentIndex: number }> {
    try {
      const stored = await this.storage.get<any>(StorageKeys.RotationState);
      if (stored) {
        const rs = new RotationState({ isRotating: !!stored.isRotating, tabIds: Array.isArray(stored.tabIds) ? stored.tabIds : [] });
        const currentIndex = typeof stored.currentIndex === 'number' ? stored.currentIndex : 0;
        return { state: rs, currentIndex };
      }
    } catch {}
    return { state: new RotationState(), currentIndex: 0 };
  }

  async save(state: RotationState, currentIndex: number) {
    try {
      await this.storage.set({ [StorageKeys.RotationState]: { ...state, currentIndex } });
    } catch (e) {
      console.error('[rotator] RotationStateRepository.save failed', e);
    }
  }

  async updateCurrentIndex(currentIndex: number) {
    try {
      const existing = await this.storage.get<any>(StorageKeys.RotationState);
      await this.storage.set({ [StorageKeys.RotationState]: { ...(existing ?? {}), currentIndex } });
    } catch (e) {
      console.error('[rotator] RotationStateRepository.updateCurrentIndex failed', e);
    }
  }
}
