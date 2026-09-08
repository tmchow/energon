import { describe, expect, it } from 'vitest';
import { hubCleanupTarget, type HubCleanupFind } from './hub-cleanup-target';

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
