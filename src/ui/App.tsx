// import "../../wdyr/wdyr.js";
import './App.css'
import { ConfirmationRenderer } from './lib/components/confirmation'
import { ToastRenderer } from './lib/components/toast'
import { subscribeToGenericEvents } from './global/genericEventListener'
import { TaskMonitor } from './global/TaskMonitor'
import { DialogStoreRenderer } from './global/dialogStore'
import { subscribeToTasks } from './global/taskSubscription'
import { CustomTitleBar } from './components/CustomTitleBar'
import { FolderExplorer } from './folders/FolderExplorer'

subscribeToTasks()
subscribeToGenericEvents()

function App() {
  return (
    <>
      <ToastRenderer />
      <ConfirmationRenderer />
      <DialogStoreRenderer />

      <div className="flex h-full flex-col">
        <CustomTitleBar />
        <FolderExplorer />
      </div>
      <TaskMonitor />
    </>
  )
}

export default App
