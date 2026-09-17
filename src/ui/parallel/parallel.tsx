import { createRoot } from 'react-dom/client'
import { ParallelWindow } from './ParallelWindow.tsx'
import '../App.css'
import '../global/theme'

createRoot(document.getElementById('root')!).render(<ParallelWindow />)
