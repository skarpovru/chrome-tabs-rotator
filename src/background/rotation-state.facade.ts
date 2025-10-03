import { RotationState, TabsConfig } from '../app/models';
import { RotationStateRepository } from './rotation-state.repository';
import { ToolbarManagerService } from '../app/services';

export interface SetStateOptions {
  rotating: boolean;
  tabIds?: number[];
  tabsConfig?: TabsConfig;
  currentIndex: number;
  lastActivatedPageIndex: number | null;
  lastActivatedTabId: number | null;
  rotationCycle: number;
  debug?: boolean;
}

export class RotationStateFacade {
  private readonly originalRef: RotationState;
  constructor(
    private repo: RotationStateRepository,
    private toolbar: ToolbarManagerService,
    private rotationState: RotationState
  ) {
    // Capture the original object identity so we can detect if someone later reassigns
    // this.rotationState externally (which would cause the facade and service to diverge).
    this.originalRef = rotationState;
  }

  get state() { return this.rotationState; }

  async set(opts: SetStateOptions): Promise<void> {
    const { rotating, tabIds, tabsConfig, currentIndex } = opts;
    // Identity drift detection: if rotationState was reassigned after facade construction,
    // log a warning once so it surfaces during development.
    if (this.rotationState !== this.originalRef) {
      console.warn('[stateFacade] rotationState identity drift detected – facade still mutates original instance; merge external fields instead of reassigning.');
    }
    if (this.rotationState.isRotating === rotating && !tabIds) return;
    this.rotationState.isRotating = rotating;
    if (tabIds) this.rotationState.tabIds = tabIds;
    if (rotating && tabsConfig?.tabs?.length) {
      const ordered: number[] = [];
      for (const t of tabsConfig.tabs) if (t.tabId > 0) ordered.push(t.tabId);
      for (const t of tabsConfig.tabs) if (t.nextTabId > 0) ordered.push(t.nextTabId);
      if (ordered.length) this.rotationState.tabIds = ordered;
    }
    try { await this.repo.save(this.rotationState, currentIndex); } catch (e) { console.error('[stateFacade] save failed', e); }
    try { await this.toolbar.trySetToolbarIcon(rotating); } catch {}
  }

  async updateIndex(currentIndex: number) {
    try { await this.repo.updateCurrentIndex(currentIndex); } catch (e) { console.error('[stateFacade] updateIndex failed', e); }
  }
}
