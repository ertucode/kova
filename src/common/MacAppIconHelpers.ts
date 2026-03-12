import { PathHelpers } from './PathHelpers.js'

export namespace MacAppIconHelpers {
  export function getAppIconFolderPath(appPath: string, homePath: string) {
    for (const folder of appFolders.concat(homeAppFolder(homePath))) {
      if (appPath.startsWith(folder)) {
        const withoutPrefix = appPath.slice(folder.length)
        const parts = PathHelpers.getFolderNameParts(withoutPrefix)
        if (parts[0] && parts[0].endsWith('.app')) {
          return folder + '/' + parts[0]
        }
      }
    }
    return undefined
  }

  const appFolders = ['/Applications', '/System/Applications', '~/Applications']

  function homeAppFolder(homePath: string) {
    return homePath + '/Applications'
  }
}
