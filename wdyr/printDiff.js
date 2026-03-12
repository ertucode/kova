import calculateDeepEqualDiffs from './calculateDeepEqualDiffs';
import {diffTypesDescriptions} from './consts';

const sortBy = (array, key) => array.slice().sort((a, b) => a[key] > b[key] ? 1 : -1);
const groupBy = (array, key) => array.reduce((acc, item) => {
  (acc[item[key]] = acc[item[key]] || []).push(item);
  return acc;
}, {});

export default function printDiff(value1, value2, {pathString, consoleLog}) {
  const diffs = calculateDeepEqualDiffs(value1, value2, pathString, {detailed: true});

  Object.entries(groupBy(sortBy(diffs, 'pathString'), 'diffType'))
    .forEach(([diffType, diffs]) => {
      consoleLog(diffTypesDescriptions[diffType]);
      diffs.forEach(diff => {
        consoleLog({path: diff.pathString, value: diff.prevValue});
      });
    });
}

