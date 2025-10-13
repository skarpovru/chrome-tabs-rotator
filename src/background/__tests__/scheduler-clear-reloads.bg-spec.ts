import { installBaseChromeMocks } from './test-helpers/chrome-mock';
import { SchedulerService } from '../scheduler.service';

// We assume SchedulerService has a clearAllReloads() method that clears alarms with prefix 'reload:'
// This spec seeds alarms via the chrome mock and ensures only reload:* alarms are cleared.

describe('SchedulerService.clearAllReloads', () => {
  it('clears only reload: alarms and leaves others intact', async () => {
    const { createdAlarms, clearedAlarms } = installBaseChromeMocks();

    // Simulate previously scheduled alarms
    (globalThis as any).chrome.alarms.create('reload:page-1', { when: Date.now() + 1000 });
    (globalThis as any).chrome.alarms.create('reload:page-2', { when: Date.now() + 2000 });
    (globalThis as any).chrome.alarms.create('rotate', { when: Date.now() + 5000 });
    (globalThis as any).chrome.alarms.create('metrics:poll', { when: Date.now() + 6000 });

    const service = new SchedulerService();

    // Action
    await service.clearAllReloads();

    // Expectations: only reload:* cleared
    expect(clearedAlarms).toContain('reload:page-1');
    expect(clearedAlarms).toContain('reload:page-2');
    expect(clearedAlarms).not.toContain('rotate');
    expect(clearedAlarms).not.toContain('metrics:poll');

    // Ensure original list of created alarms still has 4 entries (we are just clearing, not removing metadata)
    expect(createdAlarms.length).toBe(4);
  });
});
