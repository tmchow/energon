import { describe, expect, it } from 'vitest';
import { hubCleanupDoneMessage, hubCleanupTarget, type HubCleanupFind } from './hub-cleanup-target';

const find: HubCleanupFind = {
  q: 'vhubclean',
  scope: 'involved',
  expires: 'any',
  expiresBefore: '',
  updatedBefore: '',
  minSize: '',
};

describe('hubCleanupTarget', () => {
  it('does not encode a cleared row selection as {} (that means every involved object)', () => {
    expect(hubCleanupTarget({ matching: false, sites: [], files: [] }, find)).toBeNull();
  });

  it('keeps {} only for select-all-matching with no extra filters', () => {
    expect(hubCleanupTarget({ matching: true }, {
      q: '',
      scope: 'involved',
      expires: 'any',
      expiresBefore: '',
      updatedBefore: '',
      minSize: '',
    })).toEqual({});
  });

  it('sends checked ids and matching filters', () => {
    expect(hubCleanupTarget({ matching: false, sites: [], files: ['RD2mvl', 'SENQQe'] }, find)).toEqual({
      files: ['RD2mvl', 'SENQQe'],
    });
    expect(hubCleanupTarget({ matching: true }, { ...find, expires: 'never', minSize: '15b' })).toEqual({
      q: 'vhubclean',
      expires: 'never',
      min_size: '15b',
    });
    expect(hubCleanupTarget({ matching: true }, { ...find, expires: 'never' })).not.toHaveProperty('last_read_before');
  });
});

describe('hubCleanupDoneMessage', () => {
  it('names expire as a 30-minute grace, not Set expiry', () => {
    expect(hubCleanupDoneMessage('expire', 1)).toBe('Set a 30-minute grace on 1 object.');
    expect(hubCleanupDoneMessage('expire', 3)).toBe('Set a 30-minute grace on 3 objects.');
    expect(hubCleanupDoneMessage('set_ttl', 2)).toBe('Set expiry on 2 objects.');
    expect(hubCleanupDoneMessage('delete', 1)).toBe('Deleted 1 object.');
  });
});
