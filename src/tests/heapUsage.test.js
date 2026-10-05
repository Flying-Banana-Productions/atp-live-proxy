const { getHeapUsedPercent } = require('../utils/heapUsage');

describe('getHeapUsedPercent', () => {
  it('measures heap used against the V8 heap size limit, not heapTotal', () => {
    const memoryUsage = { heapUsed: 45, heapTotal: 50 };
    const heapStatistics = { heap_size_limit: 1000 };
    expect(getHeapUsedPercent(memoryUsage, heapStatistics)).toBeCloseTo(4.5);
  });

  it('returns 0 when the heap limit is unavailable', () => {
    expect(getHeapUsedPercent({ heapUsed: 10 }, { heap_size_limit: 0 })).toBe(0);
  });

  it('reports low usage for an idle test process', () => {
    expect(getHeapUsedPercent()).toBeLessThan(70);
  });
});
