'use strict'

const ITERATIONS = 5_000_000
const OBJECT_COUNT = 100_000

// -------------------- setup objects --------------------

const objects = Array.from({ length: OBJECT_COUNT }, () => ({}))

// -------------------- WeakMap version --------------------

const wm = new WeakMap()
let wmNextId = 1

function getIdWeakMap(obj) {
  let id = wm.get(obj)
  if (id === undefined) {
    id = wmNextId++
    wm.set(obj, id)
  }
  return id
}

// -------------------- Symbol version --------------------

const ID = Symbol('id')
let symNextId = 1

function getIdSymbol(obj) {
  return (obj[ID] ??= symNextId++)
}

// -------------------- helpers --------------------

function time(label, fn) {
  const start = performance.now()
  fn()
  const end = performance.now()
  console.log(label.padEnd(30), (end - start).toFixed(2), 'ms')
}

// -------------------- cold path --------------------

time('WeakMap cold', () => {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    getIdWeakMap(objects[i])
  }
})

time('Symbol cold', () => {
  for (let i = 0; i < OBJECT_COUNT; i++) {
    getIdSymbol(objects[i])
  }
})

// -------------------- hot path --------------------

time('WeakMap hot', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    getIdWeakMap(objects[i % OBJECT_COUNT])
  }
})

time('Symbol hot', () => {
  for (let i = 0; i < ITERATIONS; i++) {
    getIdSymbol(objects[i % OBJECT_COUNT])
  }
})
