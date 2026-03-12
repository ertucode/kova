#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const traceFile = path.join(process.env.HOME, "Desktop/trace.json");
const trace = JSON.parse(fs.readFileSync(traceFile, "utf8"));

console.log("=== TRACE ANALYSIS ===\n");

// Get unique event names
const eventNames = {};
const errors = [];
const warnings = [];
const longTasks = [];
const functionCalls = {};
const functionDurations = {};
const timerCallbacks = {};

trace.traceEvents.forEach((event) => {
  eventNames[event.name] = (eventNames[event.name] || 0) + 1;

  // Track errors and warnings
  if (event.name === "ConsoleAPICall" && event.args?.data) {
    const type = event.args.data[0]?.type;
    if (type === "error") {
      errors.push(event);
    } else if (type === "warning") {
      warnings.push(event);
    }
  }

  // Track long tasks (> 50ms)
  if (event.dur && event.dur > 50000) {
    longTasks.push({
      name: event.name,
      duration: (event.dur / 1000).toFixed(2) + "ms",
      category: event.cat,
      ts: event.ts,
      event: event,
    });
  }

  // Track function calls with durations
  if (event.name === "FunctionCall" && event.dur) {
    const functionName = event.args?.data?.functionName || "anonymous";
    let url = event.args?.data?.url || "unknown";
    
    // Simplify URL for readability
    if (url.includes("/assets/")) {
      url = url.split("/assets/")[1].split("?")[0];
    }
    
    const key = `${functionName} @ ${url}`;
    
    if (!functionDurations[key]) {
      functionDurations[key] = { total: 0, count: 0, max: 0 };
    }
    const duration = event.dur / 1000;
    functionDurations[key].total += duration;
    functionDurations[key].count += 1;
    functionDurations[key].max = Math.max(functionDurations[key].max, duration);
  }

  // Track timer callbacks
  if (event.name === "TimerFire" && event.dur) {
    const timerId = event.args?.data?.timerId || "unknown";
    if (!timerCallbacks[timerId]) {
      timerCallbacks[timerId] = { total: 0, count: 0, max: 0 };
    }
    const duration = event.dur / 1000;
    timerCallbacks[timerId].total += duration;
    timerCallbacks[timerId].count += 1;
    timerCallbacks[timerId].max = Math.max(timerCallbacks[timerId].max, duration);
  }
});

console.log("Top Event Types:");
Object.entries(eventNames)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([name, count]) => {
    console.log(`  ${name}: ${count}`);
  });

console.log("\n=== ERRORS ===");
if (errors.length > 0) {
  errors.slice(0, 10).forEach((err, i) => {
    console.log(`\nError ${i + 1}:`);
    console.log(`  Message:`, err.args?.data?.[0]?.value || "N/A");
    console.log(`  Time:`, err.ts);
  });
} else {
  console.log("No console errors found");
}

console.log("\n=== WARNINGS ===");
if (warnings.length > 0) {
  warnings.slice(0, 10).forEach((warn, i) => {
    console.log(`\nWarning ${i + 1}:`);
    console.log(`  Message:`, warn.args?.data?.[0]?.value || "N/A");
  });
} else {
  console.log("No console warnings found");
}

console.log("\n=== LONG TASKS (>50ms) ===");
if (longTasks.length > 0) {
  console.log(`Found ${longTasks.length} long tasks`);
  longTasks
    .sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration))
    .slice(0, 15)
    .forEach((task, i) => {
      console.log(
        `  ${i + 1}. ${task.name} - ${task.duration} (${task.category})`,
      );
      
      // Find child function calls within this task's timeframe
      const taskStart = task.event.ts;
      const taskEnd = task.event.ts + task.event.dur;
      const childFunctions = trace.traceEvents.filter(e => 
        e.name === "FunctionCall" && 
        e.ts >= taskStart && 
        e.ts <= taskEnd &&
        e.dur > 5000 // Only show functions taking > 5ms
      ).sort((a, b) => b.dur - a.dur).slice(0, 5);
      
      childFunctions.forEach(fn => {
        const fnName = fn.args?.data?.functionName || "anonymous";
        let fnUrl = fn.args?.data?.url || "";
        // Simplify URL
        if (fnUrl.includes("/assets/")) {
          fnUrl = fnUrl.split("/assets/")[1].split("?")[0];
        }
        const fnDuration = (fn.dur / 1000).toFixed(2);
        console.log(`      └─ ${fnName} - ${fnDuration}ms @ ${fnUrl}`);
      });
    });
} else {
  console.log("No long tasks found");
}

console.log("\n=== SLOWEST FUNCTIONS (by total time) ===");
const sortedFunctions = Object.entries(functionDurations)
  .map(([name, stats]) => ({
    name,
    total: stats.total,
    count: stats.count,
    avg: stats.total / stats.count,
    max: stats.max
  }))
  .sort((a, b) => b.total - a.total)
  .slice(0, 20);

sortedFunctions.forEach((fn, i) => {
  console.log(
    `  ${i + 1}. ${fn.name}`
  );
  console.log(
    `      Total: ${fn.total.toFixed(2)}ms, Calls: ${fn.count}, Avg: ${fn.avg.toFixed(2)}ms, Max: ${fn.max.toFixed(2)}ms`
  );
});

console.log("\n=== SLOWEST INDIVIDUAL FUNCTION CALLS ===");
const sortedByMax = Object.entries(functionDurations)
  .map(([name, stats]) => ({
    name,
    max: stats.max
  }))
  .sort((a, b) => b.max - a.max)
  .slice(0, 15);

sortedByMax.forEach((fn, i) => {
  console.log(`  ${i + 1}. ${fn.name} - ${fn.max.toFixed(2)}ms`);
});

// Calculate total duration
const timestamps = trace.traceEvents.map((e) => e.ts).filter(Boolean);
const duration = (Math.max(...timestamps) - Math.min(...timestamps)) / 1000000;
console.log(`\n=== TRACE DURATION: ${duration.toFixed(2)}s ===`);

console.log(`\nTotal events: ${trace.traceEvents.length}`);
