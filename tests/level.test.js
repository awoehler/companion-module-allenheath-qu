const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const level = require('../level.json')
const actions = require('../actions')
const feedbacks = require('../feedbacks')
const variables = require('../variables')
const presets = require('../presets')
const src = fs.readFileSync(require.resolve('../index.js'), 'utf8')
const start = src.indexOf('class instance extends InstanceBase')
const end = src.indexOf('\nmodule.exports = instance', start)

class InstanceBase {
  log(level, message) {
    this.initializationLogs = this.initializationLogs || []
    this.initializationLogs.push({ level, message })
  }
  setVariableDefinitions(definitions) {
    if (Array.isArray(definitions)) throw new Error('Variable definitions should be an object')
    this.registeredVariables = definitions
  }
  setVariableValues(values) {
    if (!this.registeredVariables) throw new Error('Set variable definitions before values')
    this.registeredValues = values
  }
  setActionDefinitions(definitions) {
    this.registeredActions = definitions
  }
  setFeedbackDefinitions(definitions) {
    this.registeredFeedbacks = definitions
  }
  setPresetDefinitions(sections, definitions) {
    if (!Array.isArray(sections) || !definitions) throw new Error('Set both preset sections and definitions')
    this.registeredPresetSections = sections
    this.registeredPresets = definitions
  }
}
const sandbox = {
  InstanceBase,
  actions,
  feedbacks,
  variables,
  presets,
  level,
  quconfig: require('../quconfig.json'),
  MIDI: 51325,
  SysexHeader: [],
  Buffer,
  clearInterval,
  console,
}
const Klass = vm.runInNewContext(src.slice(start, end) + '\ninstance', sandbox)
function make() {
  const obj = Object.create(Klass.prototype)
  obj.levelState = new Map()
  obj.variableState = new Map()
  obj.pendingMidiData = []
  obj.logs = []
  obj.setVariableValues = () => {}
  obj.log = (level, message) => obj.logs.push({ level, message })
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
test('relative steps clamp at -55 dB and never send -inf', () => {
  const obj = make()
  const key = obj.levelKey('sendlev_input_mix', 32, 0)
  obj.recordLevel(key, 0x07)
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 998, 0), 0x07)
  obj.recordLevel(key, 0x00)
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 998, 0), undefined)
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 999, 0), 0x07)
})
test('step uses current console report value', () => {
  const obj = make()
  const key = obj.levelKey('sendlev_input_mix', 32, 0)
  obj.recordLevel(key, 0x62)
  const down = obj.getStepLevel('sendlev_input_mix', 32, 998, 0)
  assert.ok(down > 0 && down < 0x62)
})
test('split input-to-mix reports update the level used by relative steps', () => {
  const obj = make()
  const key = obj.levelKey('sendlev_input_mix', 32, 1)
  const report = Buffer.from([0xb0, 0x63, 32, 0xb0, 0x62, 0x20, 0xb0, 0x06, 0x62, 0xb0, 0x26, 1])

  obj.receiveMidiData(report.subarray(0, 8))
  assert.equal(obj.levelState.has(key), false)
  obj.receiveMidiData(report.subarray(8))

  assert.equal(obj.levelState.get(key), 0x62)
  assert.equal(obj.getStepLevel('sendlev_input_mix', 32, 998, 1), 0x5f)
  assert.ok(obj.logs.some(({ level, message }) => level === 'debug' && message.includes(`Received send level ${key}`)))
})
test('main fader relative steps move by 1 dB without jumping to maximum', () => {
  const obj = make()
  obj.levelState.set('level_input_32', 0x1f)
  const sent = []
  obj.midiSocket = { send: (buffer) => sent.push(buffer) }

  obj.action({ action: 'level_input', options: { channel: 0, level: 999 } })
  obj.action({ action: 'level_input', options: { channel: 0, level: 998 } })

  assert.deepEqual(sent.map((buffer) => buffer[8]), [0x20, 0x1f])
  assert.ok(
    obj.logs.some(
      ({ level, message }) =>
        level === 'info' &&
        message.includes('Relative level step level_input_32 (+1 dB): -30 dB/0x1f -> -29 dB/0x20')
    )
  )
  assert.ok(obj.logs.some(({ level, message }) => level === 'info' && message.includes('Sending level_input MIDI:')))
})
test('main fader step without a MIDI socket logs the unavailable send', () => {
  const obj = make()
  obj.levelState.set('level_input_32', 0x1f)

  obj.action({ action: 'level_input', options: { channel: 0, level: 999 } })

  assert.ok(obj.logs.some(({ level, message }) => level === 'warn' && message.includes('MIDI socket is unavailable')))
})
test('main fader downward step at -55 dB does not send MIDI zero', () => {
  const obj = make()
  obj.levelState.set('level_input_32', 0x07)
  const sent = []
  obj.midiSocket = { send: (buffer) => sent.push(buffer) }

  obj.action({ action: 'level_input', options: { channel: 0, level: 998 } })

  assert.equal(sent[0][8], 0x07)
})
test('variable registration converts legacy arrays to the current object API', () => {
  const obj = make()
  obj.getVariables = () => ({
    definitions: [{ label: 'CH 1 Level', variableId: 'level_input_32' }],
    initialValues: { ch_name_32: 'CH 1' },
  })
  let definitions
  let values
  obj.setVariableDefinitions = (input) => {
    definitions = input
  }
  obj.setVariableValues = (input) => {
    values = input
  }

  obj.variables()

  assert.equal(Array.isArray(definitions), false)
  assert.equal(definitions.level_input_32.name, 'CH 1 Level')
  assert.equal(values.ch_name_32, 'CH 1')
})
test('preset registration provides sections and modern simple definitions', () => {
  const obj = make()
  obj.getPresets = () => [
    {
      category: 'Mute Input',
      name: 'CH 1 Mute',
      style: { text: 'CH 1\\nMute' },
      steps: [{ down: [{ actionId: 'mute_input', options: { channel: 0 } }], up: [] }],
      feedbacks: [{ feedbackId: 'mute_input', options: { channel: 0 } }],
    },
  ]
  obj.getFeedbacks = () => ({
    mute_input: { defaultStyle: { color: 0xffffff, bgcolor: 0x990033 } },
  })
  let structure
  let presets
  obj.setPresetDefinitions = (sections, definitions) => {
    structure = sections
    presets = definitions
  }

  obj.presets()

  assert.equal(structure.length, 1)
  assert.equal(structure[0].name, 'Mute Input')
  const preset = presets[structure[0].definitions[0]]
  assert.equal(preset.type, 'simple')
  assert.equal(preset.name, 'CH 1 Mute')
  assert.equal(preset.feedbacks[0].style.bgcolor, 0x990033)
})
test('module initialization registers variables and presets without restarting', async () => {
  const obj = new Klass({})

  await obj.init({ host: '', model: 'QU16' })

  assert.ok(obj.registeredVariables.ch_name_32)
  assert.ok(Object.keys(obj.registeredActions).length > 0)
  assert.ok(Object.keys(obj.registeredFeedbacks).length > 0)
  assert.ok(obj.registeredPresetSections.length > 0)
  assert.ok(Object.keys(obj.registeredPresets).length > 0)
  assert.ok(obj.initializationLogs.some(({ message }) => message === 'Initialization completed.'))
})
test('module initialization tolerates missing settings so config can be restored', async () => {
  const obj = new Klass({})

  await obj.init({})

  assert.deepEqual(Object.keys(obj.registeredVariables), [])
  assert.deepEqual(Object.keys(obj.registeredActions), [])
  assert.equal(obj.registeredPresetSections.length, 0)
  assert.deepEqual(Object.keys(obj.registeredPresets), [])
  assert.ok(obj.initializationLogs.some(({ level }) => level === 'warn'))
})
test('module entrypoint exports its class using the installed base API', () => {
  assert.equal(typeof require('../index'), 'function')
})
