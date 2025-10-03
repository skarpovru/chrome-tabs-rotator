import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface CountdownState {
  seconds: number;
  nextAt: number;
}

@Injectable({ providedIn: 'root' })
export class CountdownStateService {
  private _state$ = new BehaviorSubject<CountdownState | null>(null);
  readonly state$: Observable<CountdownState | null> = this._state$.asObservable();

  constructor(private zone: NgZone) {
    this.attachStorageListener();
    this.primeFromStorage();
  }

  private attachStorageListener() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes['__countdown']) {
          const val = (changes as any)['__countdown'].newValue;
          if (val && typeof val.seconds === 'number') {
            this.zone.run(() => this._state$.next({ seconds: val.seconds, nextAt: val.nextAt }));
          }
        }
      });
    } catch {}
  }

  private primeFromStorage() {
    try {
      chrome.storage.local.get(['__countdown'], (res) => {
        const val = res['__countdown'];
        if (val && typeof val.seconds === 'number') {
          this.zone.run(() => this._state$.next({ seconds: val.seconds, nextAt: val.nextAt }));
        }
      });
    } catch {}
  }
}
