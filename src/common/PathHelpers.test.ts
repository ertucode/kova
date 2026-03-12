import { describe, it, expect } from 'vitest'
import { PathHelpers } from './PathHelpers.js'

describe('PathHelpers', () => {
  describe('resolveUpDirectory', () => {
    it('should return ~/ when going up from ~/Downloads', () => {
      const result = PathHelpers.resolveUpDirectory('/Users/cavitertugrulsirt', '~/Downloads')
      expect(result).toBe('~/')
    })

    it('should return parent directory for absolute paths', () => {
      const result = PathHelpers.resolveUpDirectory('/Users/cavitertugrulsirt', '/Users/cavitertugrulsirt/Documents')
      expect(result).toBe('/Users/cavitertugrulsirt')
    })

    it('should return / when going up from a single level path', () => {
      const result = PathHelpers.resolveUpDirectory('/Users/cavitertugrulsirt', '/Users')
      expect(result).toBe('/')
    })
  })

  describe('revertExpandedHome', () => {
    it('should return ~/ for the home directory path', () => {
      const result = PathHelpers.revertExpandedHome('/Users/cavitertugrulsirt', '/Users/cavitertugrulsirt')
      expect(result).toBe('~/')
    })

    it('should return ~/Downloads for home/Downloads path', () => {
      const result = PathHelpers.revertExpandedHome('/Users/cavitertugrulsirt', '/Users/cavitertugrulsirt/Downloads')
      expect(result).toBe('~/Downloads')
    })

    it('should return the original path if it does not start with home', () => {
      const result = PathHelpers.revertExpandedHome('/Users/cavitertugrulsirt', '/var/log')
      expect(result).toBe('/var/log')
    })
  })
})
