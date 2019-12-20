import { assert } from 'chai'
import { readFileSync } from 'fs'
import globby from 'globby'
import { basename, join } from 'path'
import yargs from 'yargs'
import { buildEnvironment } from '../src'
import interpreter, { Evaluation, Natives } from '../src/interpreter'
import log, { enableLogs, LogLevel } from '../src/log'
import { List, Node } from '../src/model'
import natives from '../src/wre/wre.natives'

const { fail } = assert

const ARGUMENTS = yargs
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Run with verbose logging',
  })
  .option('root', {
    demandOption: true,
    type: 'string',
    description: 'Path to the root test folder',
  })
  .argv


// TODO: Don't skip
const SKIPPED = globby.sync([
  'game/**',
], { cwd: ARGUMENTS.root })

describe(basename(ARGUMENTS.root), () => {

  if (ARGUMENTS.verbose) enableLogs(LogLevel.DEBUG)

  log.start('Reading tests')
  const testFiles = globby.sync('**/*.@(wlk|wtest)', { cwd: ARGUMENTS.root })
    .filter(name => !SKIPPED.includes(name))
    .map(name => ({
      name,
      content: readFileSync(join(ARGUMENTS.root, name), 'utf8'),
    }))
  log.done('Reading tests')

  log.start('Building environment')
  const environment = buildEnvironment(testFiles)
  log.done('Building environment')

  const { stepAll, buildEvaluation } = interpreter(environment, natives as Natives)

  log.start('Initializing Evaluation')
  const baseEvaluation = buildEvaluation()
  stepAll(baseEvaluation)
  baseEvaluation.frameStack.pop()
  log.done('Initializing Evaluation')

  function registerTests(evaluation: Evaluation, nodes: List<Node>): void {
    nodes.forEach(node => {

      if (node.is('Describe') || node.is('Package'))
        describe(node.name, () => registerTests(evaluation, node.members))

      if (node.is('Test'))
        it(node.name, () => {
          const { runTest } = interpreter(evaluation.environment, natives as Natives)
          const { error } = runTest(evaluation.copy(), node)
          if (error) fail(`${error}`)
        })

    })
  }

  registerTests(baseEvaluation, baseEvaluation.environment.members)

})