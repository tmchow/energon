export type CatalogScanMark = 'key' | 'lock' | 'lockup' | 'people' | 'peopleOff';

export const CATALOG_SCAN_LABEL: Record<CatalogScanMark, string> = {
  key: 'Private',
  lock: 'View password',
  lockup: 'Write password',
  people: 'Org can write',
  peopleOff: 'Org cannot write',
};

export const CATALOG_SCAN_SIZE = 24;
export const CATALOG_ACTION_SIZE = 24;
