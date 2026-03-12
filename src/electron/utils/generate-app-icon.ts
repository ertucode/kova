import { execFile } from 'child_process'
import { promisify } from 'util'
import { expandHome } from './expand-home.js'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'

const execFileAsync = promisify(execFile)

// Simple in-memory cache for app icons
const iconCache = new Map<string, string>()

/**
 * Generates an icon from a macOS .app bundle and returns it as a base64 string
 * @param appPath - Full path to the .app bundle
 * @returns Promise<string> - Base64 encoded image (PNG format) with data URI prefix
 */
export async function generateAppIcon(appPath: string): Promise<string> {
  // Check cache first
  const cached = iconCache.get(appPath)
  if (cached) {
    return cached
  }
  // Create a temporary file for the icon
  const tempDir = os.tmpdir()
  const tempFile = path.join(tempDir, `app-icon-${Date.now()}-${Math.random().toString(36).substring(7)}.png`)

  try {
    const expandedPath = expandHome(appPath)

    // Try to find the icon file - it could be named differently in different apps
    const resourcesPath = path.join(expandedPath, 'Contents', 'Resources')

    // Common icon file names
    const possibleIconNames = ['AppIcon.icns', 'app.icns', 'icon.icns', 'application.icns']

    let icnsPath: string | null = null

    // Try to find an existing icon file
    for (const iconName of possibleIconNames) {
      const candidatePath = path.join(resourcesPath, iconName)
      try {
        await fs.access(candidatePath)
        icnsPath = candidatePath
        break
      } catch {
        // File doesn't exist, try next
        continue
      }
    }

    // If no specific icon found, try to find any .icns file in Resources
    if (!icnsPath) {
      try {
        const files = await fs.readdir(resourcesPath)
        const icnsFile = files.find(f => f.endsWith('.icns'))
        if (icnsFile) {
          icnsPath = path.join(resourcesPath, icnsFile)
        }
      } catch {
        // Resources directory might not exist
      }
    }

    if (!icnsPath) {
      throw new Error('No icon file found in app bundle')
    }

    // Use sips to convert the icns to a 64x64 PNG
    // -s format png: convert to PNG
    // -z 64 64: resize to 64x64 pixels
    // --out: output file path
    const { stderr } = await execFileAsync('sips', [
      '-s',
      'format',
      'png',
      '-z',
      '64',
      '64',
      icnsPath,
      '--out',
      tempFile,
    ])

    // Check if sips reported any errors
    if (stderr && stderr.trim()) {
      throw new Error(`sips error: ${stderr.trim()}`)
    }

    // Verify the file was created before trying to read it
    try {
      await fs.access(tempFile)
    } catch {
      throw new Error('sips failed to create output file')
    }

    // Read the generated icon and convert to base64
    const imageBuffer = await fs.readFile(tempFile)
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`

    // Clean up temp file
    await fs.unlink(tempFile)

    // Cache the result
    iconCache.set(appPath, base64Image)

    return base64Image
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempFile)
    } catch {
      // Ignore cleanup errors
    }

    throw new Error(
      `Failed to generate app icon for: ${appPath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
