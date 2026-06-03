import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  countWords,
  detectLanguage,
  computeMetrics,
} from './transcriptMetrics'

describe('formatBytes', () => {
  it('shows bytes under 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })
  it('shows one decimal for small KB/MB, rounds larger', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(500_000)).toBe('488 KB')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
    expect(formatBytes(52_428_800)).toBe('50 MB')
  })
})

describe('countWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('one two three')).toBe(3)
  })
  it('treats any whitespace run as a single separator', () => {
    expect(countWords('  one\n\ntwo\t three  ')).toBe(3)
  })
  it('is zero for empty/blank text', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })
})

describe('detectLanguage', () => {
  it('flags Vietnamese by its diacritics', () => {
    expect(detectLanguage('Mẹ kiếp, mỹ nhân cô nhận nhầm người rồi')).toBe(
      'Vietnamese',
    )
  })
  it('treats plain Latin text as English / Latin', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog')).toBe(
      'English / Latin',
    )
  })
  it('detects CJK scripts', () => {
    expect(detectLanguage('这是一个中文句子')).toBe('Chinese')
    expect(detectLanguage('これは日本語の文です')).toBe('Japanese')
    expect(detectLanguage('이것은 한국어 문장입니다')).toBe('Korean')
  })
  it('detects Cyrillic', () => {
    expect(detectLanguage('Это предложение на русском языке')).toBe(
      'Russian / Cyrillic',
    )
  })
  it('returns Unknown for text with no detectable letters', () => {
    expect(detectLanguage('1234 5678 !@#$ %^&*')).toBe('Unknown')
    expect(detectLanguage('')).toBe('Unknown')
  })
})

describe('computeMetrics', () => {
  it('assembles size, counts, and language', () => {
    const m = computeMetrics('Mẹ kiếp một hai ba', 1536)
    expect(m.sizeBytes).toBe(1536)
    expect(m.sizeLabel).toBe('1.5 KB')
    expect(m.wordCount).toBe(5)
    expect(m.charCount).toBe('Mẹ kiếp một hai ba'.length)
    expect(m.language).toBe('Vietnamese')
  })
})
