import { ToolbarManagerService } from '../../app/services/toolbar-manager.service';

describe('ToolbarManagerService', () => {
  it('no-ops without setIcon and warns only once', async () => {
    (globalThis as any).chrome = { action: {} }; // no setIcon
    const svc = new ToolbarManagerService();
    const debugSpy = spyOn(console, 'debug').and.callThrough();
    await svc.trySetToolbarIcon(true);
    await svc.trySetToolbarIcon(false);
    const matched = debugSpy.calls.all().filter(c => /setIcon unavailable/.test(c.args.join(' ')));
    expect(matched.length).toBe(1); // only one warning
  });

  it('invokes chrome.action.setIcon when available', async () => {
    const setIconCalls: any[] = [];
    (globalThis as any).chrome = { action: { setIcon: async (p:any) => { setIconCalls.push(p); } } };
    const svc = new ToolbarManagerService();
    await svc.trySetToolbarIcon(true);
    await svc.trySetToolbarIcon(false);
    expect(setIconCalls.length).toBe(2);
    expect(Object.keys(setIconCalls[0].path)).toContain('16');
  });
});
