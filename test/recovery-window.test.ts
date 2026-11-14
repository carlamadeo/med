import {expect, it} from 'vitest';
import {isRecoverable} from '@data/recovery-window';

it('accepts deletion times from now up to just under thirty days ago', () => {
    const now = Date.UTC(2026, 10, 13);
    expect(isRecoverable(new Date(now).toISOString(), now)).toBe(true);
    expect(isRecoverable(new Date(now - 30 * 86400000 + 1).toISOString(), now)).toBe(true);
    expect(isRecoverable(new Date(now - 30 * 86400000).toISOString(), now)).toBe(false);
    expect(isRecoverable(new Date(now + 1).toISOString(), now)).toBe(false);
    expect(isRecoverable('invalid', now)).toBe(false);
});
