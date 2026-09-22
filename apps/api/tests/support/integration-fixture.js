export function createIntegrationFixture() {
  const cleanups = [];
  return {
    defer(cleanup) {
      cleanups.push(cleanup);
    },
    async cleanup() {
      const failures = [];
      while (cleanups.length > 0) {
        try { await cleanups.pop()(); } catch (error) { failures.push(error); }
      }
      if (failures.length > 0) throw new AggregateError(failures, 'Integration fixture cleanup failed');
    },
  };
}
