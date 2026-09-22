import { expect, test } from 'bun:test';
import { createIntegrationFixture } from './support/integration-fixture.js';

test('integration fixture cleans up in reverse order and continues after an error', async () => {
  const fixture = createIntegrationFixture();
  const calls = [];
  fixture.defer(() => { calls.push('first'); });
  fixture.defer(() => { calls.push('second'); throw new Error('cleanup failed'); });
  fixture.defer(() => { calls.push('third'); });

  await expect(fixture.cleanup()).rejects.toThrow('Integration fixture cleanup failed');
  expect(calls).toEqual(['third', 'second', 'first']);
  await fixture.cleanup();
});
