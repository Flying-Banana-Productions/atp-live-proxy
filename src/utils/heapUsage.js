const v8 = require('v8');

/**
 * Percentage of the V8 heap limit currently in use.
 *
 * heapUsed / heapTotal is not a pressure signal: V8 grows heapTotal lazily,
 * so an idle process routinely sits at 85-95% of it. The heap size limit is
 * the ceiling the process actually runs out of memory against.
 */
function getHeapUsedPercent(
  memoryUsage = process.memoryUsage(),
  heapStatistics = v8.getHeapStatistics(),
) {
  const limit = heapStatistics.heap_size_limit;
  if (!limit) {
    return 0;
  }
  return (memoryUsage.heapUsed / limit) * 100;
}

module.exports = { getHeapUsedPercent };
