export type AppUpdateCheckResult =
  | {
      status: 'unsupported'
      currentVersion: string
    }
  | {
      status: 'up-to-date'
      currentVersion: string
    }
  | {
      status: 'update-available'
      currentVersion: string
      availableVersion: string
    }
