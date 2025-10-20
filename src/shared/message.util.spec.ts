import { safeRuntimeSend } from './message.util';

describe('safeRuntimeSend', () => {
  let originalChrome: any;
  let sendMessageSpy: jasmine.Spy;
  let lastError: any;

  beforeEach(() => {
    originalChrome = (globalThis as any).chrome;
    lastError = undefined;
    const chromeMock: any = {
      runtime: {
        sendMessage: (...args: any[]) => {
          const cb = args.find(a => typeof a === 'function');
          if (cb) {
            if (lastError) (chromeMock.runtime as any).lastError = lastError;
            try { cb({ ok: true }); } catch {}
            delete (chromeMock.runtime as any).lastError;
          }
        }
      }
    };
    (globalThis as any).chrome = chromeMock;
    sendMessageSpy = spyOn(chromeMock.runtime, 'sendMessage').and.callThrough();
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
  });

  it('calls sendMessage with just a message', () => {
    safeRuntimeSend({ action: 'test' });
    expect(sendMessageSpy.calls.count()).toBe(1);
    const args = sendMessageSpy.calls.mostRecent().args;
    expect(args[0]).toEqual({ action: 'test' });
    expect(args.some(a => typeof a === 'function')).toBeTrue();
  });

  it('invokes callback (2-arg form)', (done) => {
    safeRuntimeSend({ action: 'test' }, (resp: any) => {
      expect(resp).toEqual({ ok: true });
      done();
    });
  });

  it('invokes callback (3-arg form with options)', (done) => {
    const options: any = { includeTlsChannelId: true };
    safeRuntimeSend({ action: 'test' }, options, (resp: any) => {
      expect(resp).toEqual({ ok: true });
      done();
    });
  });

  it('swallows runtime.lastError without throwing', () => {
    lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
    expect(() => safeRuntimeSend({ action: 'test' })).not.toThrow();
    expect(sendMessageSpy.calls.count()).toBe(1);
  });

  it('ignores thrown errors inside sendMessage', () => {
    sendMessageSpy.and.callFake(() => { throw new Error('Sending failed'); });
    expect(() => safeRuntimeSend({ action: 'test' })).not.toThrow();
  });
});
