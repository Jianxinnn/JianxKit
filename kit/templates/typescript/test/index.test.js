import assert from 'node:assert/strict'
import test from 'node:test'
import { name } from '../dist/index.js'

test('exports its name', () => {
  assert.equal(name, '$id')
})
