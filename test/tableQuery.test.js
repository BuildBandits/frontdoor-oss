import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_VALUES, tableQueryParams } from '../src/utils/tableQuery.js';

test('tableQueryParams maps sorting and whitelisted column filters to API parameters', () => {
  const columns = { user: { param: 'user_q', type: 'text' }, action: { param: 'actions', type: 'values' } };
  assert.deepEqual(tableQueryParams({}), {});
  assert.deepEqual(tableQueryParams({
    sorting: [{ id: 'user', desc: false }],
    columnFilters: [
      { id: 'user', value: '  alice ' },
      { id: 'action', value: ['create', 'delete'] },
      { id: 'unknown', value: 'ignored' },
    ],
    columns,
  }), { sort: 'user', dir: 'asc', user_q: 'alice', actions: 'create,delete' });
  // Nothing selected in a checklist matches nothing; a blank text filter is left out.
  assert.deepEqual(tableQueryParams({
    sorting: [{ id: 'date', desc: true }],
    columnFilters: [{ id: 'action', value: [] }, { id: 'user', value: '   ' }],
    columns,
  }), { sort: 'date', dir: 'desc', actions: NO_VALUES });
});
