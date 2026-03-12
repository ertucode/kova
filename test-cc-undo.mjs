// Quick test for cc + insert mode + esc creating single history item
import { VimEngine } from './src/common/VimEngine.js'
import { HistoryStack } from './src/common/history-stack.js'

// Helper to create a RealBufferItem
function createRealBufferItem(name, fullPath) {
  const item = {
    type: 'file',
    name,
    fullPath: fullPath || `/test/${name}`,
    ext: name.includes('.') ? `.${name.split('.').pop()}` : '',
    size: 1024,
    sizeStr: '1KB',
    category: 'other',
    modifiedAt: '2024-01-01',
    modifiedTimestamp: Date.now(),
  }
  return {
    type: 'real',
    item,
    str: name,
  }
}

// Create initial state
const items = [
  createRealBufferItem('file1.txt'),
  createRealBufferItem('file2.txt'),
  createRealBufferItem('file3.txt'),
]

const buffer = {
  fullPath: '/test',
  items: [...items],
  originalItems: [...items],
  historyStack: new HistoryStack([]),
  cursor: { line: 1, column: 0 },
}

let state = {
  ...VimEngine.defaultState(),
  buffers: {
    '/test': buffer,
  },
}

console.log('Initial state:')
console.log('  Items:', state.buffers['/test'].items.map(i => i.str))
console.log('  History items:', state.buffers['/test'].historyStack.hasItems() ? 'yes' : 'no')
console.log('  Mode:', state.mode)

// Execute cc (delete line and go to insert mode)
console.log('\n1. Executing cc...')
state = VimEngine.cc({ state, fullPath: '/test' })
console.log('  Items:', state.buffers['/test'].items.map(i => i.str))
console.log('  Mode:', state.mode)
console.log('  Has insertModeStartReversions:', state.insertModeStartReversions ? 'yes' : 'no')
console.log('  History has items:', state.buffers['/test'].historyStack.hasItems() ? 'yes' : 'no')

// Type some text
console.log('\n2. Typing "new line"...')
state = VimEngine.updateItemStr({ state, fullPath: '/test' }, 'new line', 8)
console.log('  Items:', state.buffers['/test'].items.map(i => i.str))
console.log('  Mode:', state.mode)
console.log('  History has items:', state.buffers['/test'].historyStack.hasItems() ? 'yes' : 'no')

// Exit insert mode
console.log('\n3. Pressing esc...')
state = VimEngine.esc({ state, fullPath: '/test' })
console.log('  Items:', state.buffers['/test'].items.map(i => i.str))
console.log('  Mode:', state.mode)
console.log('  History has items:', state.buffers['/test'].historyStack.hasItems() ? 'yes' : 'no')

// Undo once - should undo both the cc and the text change
console.log('\n4. Pressing u (undo)...')
state = VimEngine.u({ state, fullPath: '/test' })
console.log('  Items:', state.buffers['/test'].items.map(i => i.str))
console.log('  Expected: ["file1.txt", "file2.txt", "file3.txt"]')
console.log('  Success:', 
  state.buffers['/test'].items.length === 3 &&
  state.buffers['/test'].items[0].str === 'file1.txt' &&
  state.buffers['/test'].items[1].str === 'file2.txt' &&
  state.buffers['/test'].items[2].str === 'file3.txt' &&
  state.buffers['/test'].cursor.line === 1 &&
  state.buffers['/test'].cursor.column === 0
)

console.log('\n✅ Test completed - single undo should restore everything')
