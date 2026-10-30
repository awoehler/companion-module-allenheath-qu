const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const level = require('../level.json')
const src = fs.readFileSync(require.resolve('../index.js'), 'utf8')
const start = src.indexOf('class instance extends InstanceBase')
const end = src.indexOf('\nrunEntrypoint(', start)
const sandbox = {
  InstanceBase: class {},
  level,
  quconfig: require('../quconfig.json'),
  MIDI: 51325,
  SysexHeader: [],
  Buffer,
  console,
}
const Klass = vm.runInNewContext(src.slice(start, end) + '\ninstance', sandbox)
function make() {
  const obj = Object.create(Klass.prototype)
  obj.levelState = new Map()
  obj.variableState = new Map()
  obj.setVariableValues = () => {}
  obj.log = () => {}
  return obj
}
test('unknown relative input-to-mix value is not sent as -inf', () => {
  const obj = make()
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 998, 0), undefined)
})
test('absolute send initializes separate keys per mix', () => {
  const obj = make()
  const a = obj.levelKey('sendlev_input_mix', 32, 0)
  const b = obj.levelKey('sendlev_input_mix', 32, 1)
  assert.notEqual(a, b)
  obj.recordLevel(a, 0x62)
  obj.recordLevel(b, 0x1f)
  assert.equal(obj.getVariable(a), '0')
  assert.equal(obj.getVariable(b), '-30')
  assert.notEqual(obj.getStepLevel('sendlev_input_mix', 32, 999, 0), 0)
  assert.notEqual(obj.getStepLevel('sendlev_input_mix', 32, 998, 1), 0)
})
test('step at floor goes up to a valid value and down remains at floor', () => {
  const obj = make()
  const key = obj.levelKey('sendlev_input_mix', 32, 0)
  obj.recordLevel(key, 0)
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 998, 0), 0)
  assert.ok(obj.getStepLevel('sendlev_input_mix', 32, 999, 0) > 0)
})
test('step uses current console report value', () => {
  const obj = make()
  const key = obj.levelKey('sendlev_input_mix', 32, 0)
  obj.recordLevel(key, 0x62)
  const down = obj.getStepLevel('sendlev_input_mix', 32, 998, 0)
  assert.ok(down > 0 && down < 0x62)
})
