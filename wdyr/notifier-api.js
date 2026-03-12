import {diffTypes, diffTypesDescriptions} from './consts';
import printDiff from './printDiff';
import safeJsonStringify from './safe-stringify';

const moreInfoUrl = 'http://bit.ly/wdyr02';
const moreInfoHooksUrl = 'http://bit.ly/wdyr3';

let inHotReload = false;
let wdyrStore;

const url = "http://localhost:4242"

const queue = []

const BATCH_SIZE = 100

let timeoutId= undefined

function createReportSender(type) {
  return async function (data) {
    try {
      if (data) {
        queue.push({type, data: JSON.parse(safeJsonStringify(data))})
      } else {
        queue.push({type, data: ''})
      }
      if (queue.length > BATCH_SIZE) {
        await sendBatch();
      } else {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          sendBatch();
        }, 400)
      }
    }
    catch (e) {
      console.error(e)
      console.log("report sender failed")
    }
  }
}

async function sendBatch() {
  const body = JSON.stringify({
    type: 'batch',
    data: queue
  })
  queue.length = 0;
  return await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body
  }) 
}

/* const logFns = {
  component: console.log,
  log: console.log,
  groupStart: console.group,
  groupEnd: console.groupEnd,
} */

const logFns = {
  component: createReportSender('component'),
  log: createReportSender('log'),
  groupStart: createReportSender('groupStart'),
  groupEnd: createReportSender('groupEnd'),
}

function hasDifferentValues(reason) {
  return (
    reason.propsDifferences &&
      reason.propsDifferences.some(diff => diff.diffType === diffTypes.different)
  ) || (
      reason.stateDifferences &&
        reason.stateDifferences.some(diff => diff.diffType === diffTypes.different)
    ) || (
      reason.hookDifferences &&
        reason.hookDifferences.some(diff => diff.diffType === diffTypes.different)
    );
}

function shouldLog(reason, Component) {
  if (inHotReload) {
    return false;
  }

  if (wdyrStore.options.logOnDifferentValues) {
    return true;
  }

  if (Component.whyDidYouRender && Component.whyDidYouRender.logOnDifferentValues) {
    return true;
  }

  return !hasDifferentValues(reason);
}

function logDifference({Component, displayName, hookName, diffObjType, differences, values}) {
  if (differences && differences.length > 0) {
    logFns.log({displayName, diffObjType});
    differences.forEach(({pathString, diffType, prevValue, nextValue}) => {
      logFns.groupStart({
        diffObjType,
        hookName,
        pathString
      })
      logFns.log({
        description: diffTypesDescriptions[diffType],
        moreInfoUrl: hookName ? moreInfoHooksUrl : moreInfoUrl,
      })
      logFns.log({
        pathString,
        prevValue,
        nextValue
      })
      if (diffType === diffTypes.deepEquals) {
        printDiff(prevValue, nextValue, {pathString, consoleLog: logFns.log});
      }
      logFns.groupEnd();
    });
  }
  else if (differences) {
    logFns.log({
      displayName,
      Component: Component?.toString(),
      diffObjType,
      suggestion: 
      diffObjType === 'props' ?
        'This could have been avoided by making the component pure, or by preventing its father from re-rendering.' :
        'This usually means this component called setState when no changes in its state actually occurred.',
      moreInfoUrl,
      values
    })
  }
}

export default function defaultNotifier(updateInfo) {
  try {
    const {Component, displayName, hookName, prevOwner, nextOwner, prevProps, prevState, prevHookResult, nextProps, nextState, nextHookResult, reason} = updateInfo;
    //
    // if (displayName !== "SplashScreen") {
    //   return;
    // }

    // TODO: Spamledikleri için ignorelandı
    if (displayName === "SvgComponent" || displayName === "VisibilitySensor") return;

    if (!shouldLog(reason, Component, wdyrStore.options)) {
      return;
    }

    logFns.component({
      displayName: displayName || Component?.toString() || "Unknown Component",
    })

    if (reason.propsDifferences) {
      logDifference({
        Component,
        displayName,
        diffObjType: 'props',
        differences: reason.propsDifferences,
        values: {prev: prevProps, next: nextProps},
      });
    }

    if (reason.stateDifferences) {
      logDifference({
        Component,
        displayName,
        diffObjType: 'state',
        differences: reason.stateDifferences,
        values: {prev: prevState, next: nextState},
      });
    }

    if (reason.hookDifferences) {
      logDifference({
        Component,
        displayName,
        diffObjType: 'hook',
        differences: reason.hookDifferences,
        values: {prev: prevHookResult, next: nextHookResult},
        hookName,
      });
    }

    if (reason.propsDifferences && reason.ownerDifferences) {
      const prevOwnerData = wdyrStore.ownerDataMap.get(prevOwner);
      const nextOwnerData = wdyrStore.ownerDataMap.get(nextOwner);

      if (prevOwnerData && nextOwnerData) {
        logFns.groupStart({renderedBy: nextOwnerData.displayName});

        if (reason.ownerDifferences.propsDifferences) {
          logDifference({
            Component: nextOwnerData.Component,
            displayName: nextOwnerData.displayName,
            diffObjType: 'props',
            differences: reason.ownerDifferences.propsDifferences,
            values: {prev: prevOwnerData.props, next: nextOwnerData.props},
          });
        }

        if (reason.ownerDifferences.stateDifferences) {
          logDifference({
            Component: nextOwnerData.Component,
            displayName: nextOwnerData.displayName,
            diffObjType: 'state',
            differences: reason.ownerDifferences.stateDifferences,
            values: {prev: prevOwnerData.state, next: nextOwnerData.state},
          });
        }

        if (reason.ownerDifferences.hookDifferences) {
          reason.ownerDifferences.hookDifferences.forEach(({hookName, differences}, i) =>
            logDifference({
              Component: nextOwnerData.Component,
              displayName: nextOwnerData.displayName,
              diffObjType: 'hook',
              differences,
              values: {prev: prevOwnerData.hooksInfo[i].result, next: nextOwnerData.hooksInfo[i].result},
              hookName,
            })
          );
        }
        logFns.groupEnd();
      }
    }

    if (!reason.propsDifferences && !reason.stateDifferences && !reason.hookDifferences) {
      logFns.log({
        displayName,
        message: `
Re-rendered although props and state objects are the same.
This usually means there was a call to this.forceUpdate() inside the component.
more info at ${moreInfoUrl}
`
      })
    }

    logFns.groupEnd();
  }
  catch (e) {
    console.log("Error in default notifier")
    console.error(e)
  }
}

export function createDefaultNotifier(hotReloadBufferMs, wdyrStoreObj) {
  if (hotReloadBufferMs) {
    if (typeof(module) !== 'undefined' && module.hot && module.hot.addStatusHandler) {
      module.hot.addStatusHandler(status => {
        if (status === 'idle') {
          inHotReload = true;
          setTimeout(() => {
            inHotReload = false;
          }, hotReloadBufferMs);
        }
      });
    }
  }

  wdyrStore = wdyrStoreObj;

  return defaultNotifier;
}

