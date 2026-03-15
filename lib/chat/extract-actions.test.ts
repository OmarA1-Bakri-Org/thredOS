import { describe, test, expect } from 'bun:test'
import { extractActions } from './extract-actions'

describe('extractActions', () => {
  test('extracts clean JSON array', () => {
    const input = '[{"command":"step add","args":{"id":"x","name":"X","type":"base","model":"claude-code","prompt_file":"p.md"}}]'
    expect(extractActions(input)).toHaveLength(1)
    expect(extractActions(input)[0].command).toBe('step add')
  })

  test('extracts JSON from markdown code fence', () => {
    const input = 'Here is my suggestion:\n```json\n[{"command":"run","args":{}}]\n```\nLet me know!'
    expect(extractActions(input)).toHaveLength(1)
  })

  test('extracts bare JSON array with surrounding text', () => {
    const input = 'I recommend:\n[{"command":"step add","args":{"id":"b","name":"B","type":"base","model":"claude-code","prompt_file":"p.md"}}]\nDone.'
    expect(extractActions(input)).toHaveLength(1)
  })

  test('returns empty array for pure text', () => {
    expect(extractActions('The sequence looks good.')).toEqual([])
  })

  test('returns empty array for malformed JSON', () => {
    expect(extractActions('[{"command": "broken')).toEqual([])
  })

  test('wraps single object into array', () => {
    const input = '{"command":"run","args":{}}'
    expect(extractActions(input)).toHaveLength(1)
  })

  test('returns empty array for empty JSON array', () => {
    expect(extractActions('```json\n[]\n```')).toEqual([])
  })

  test('extracts multiple actions from array', () => {
    const input = '[{"command":"step add","args":{"id":"a","name":"A","type":"base","model":"claude-code","prompt_file":"a.md"}},{"command":"dep add","args":{"from":"a","to":"b"}}]'
    const actions = extractActions(input)
    expect(actions).toHaveLength(2)
    expect(actions[0].command).toBe('step add')
    expect(actions[1].command).toBe('dep add')
  })

  test('filters out non-action objects from array', () => {
    const input = '[{"command":"run","args":{}},{"notAnAction":true}]'
    const actions = extractActions(input)
    expect(actions).toHaveLength(1)
    expect(actions[0].command).toBe('run')
  })

  test('extracts from code fence without json language tag', () => {
    const input = '```\n[{"command":"stop","args":{}}]\n```'
    expect(extractActions(input)).toHaveLength(1)
  })
})
