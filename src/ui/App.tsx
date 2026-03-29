// import "../../wdyr/wdyr.js";
import './App.css'
import { useEffect } from 'react'
import { ConfirmationRenderer } from './lib/components/confirmation'
import { ToastRenderer } from './lib/components/toast'
import { subscribeToGenericEvents } from './global/genericEventListener'
import { TaskMonitor } from './global/TaskMonitor'
import { AppSettingsCoordinator } from './global/appSettingsStore'
import { DialogStoreRenderer } from './global/dialogStore'
import { subscribeToTasks } from './global/taskSubscription'
import { CustomTitleBar } from './components/CustomTitleBar'
import { FolderExplorer } from './folders/FolderExplorer'
import { useAppShortcuts } from './appShortcuts'

subscribeToTasks()
subscribeToGenericEvents()

function App() {
  useEffect(() => {
    void AppSettingsCoordinator.loadSettings()
  }, [])

  useAppShortcuts()

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
