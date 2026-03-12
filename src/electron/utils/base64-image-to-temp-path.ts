import fs from 'fs'
import path from 'path'

export function base64ImageToTempPath(app: Electron.App, base64Data: string) {
  const tempDir = app.getPath('temp')

  // 2. Create your own temp subfolder (optional but cleaner)
  const folder = path.join(tempDir, 'my-electron-images')
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder)
  }

  // 3. File path
  const imagePath = path.join(folder, 'copy-image.png')

  // 4. Remove prefix if it exists
  const cleanedBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')

  // 5. Write file
  fs.writeFileSync(imagePath, cleanedBase64, 'base64')

  return imagePath
}
