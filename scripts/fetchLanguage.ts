import { existsSync, mkdirSync } from 'fs'
import gitClient from 'simple-git/promise'
import { ConsoleLogger, LogLevel } from '../src/interpreter/log'
import { wollokVersion } from '../package.json'

const WOLLOK_LANGUAGE_REPO = 'https://github.com/uqbar-project/wollok-language.git'
const WOLLOK_LANGUAGE_TAG = wollokVersion.includes(':') ? wollokVersion.split(':')[1] : `v${wollokVersion}`
const WOLLOK_LANGUAGE_FOLDER = 'language'

const log = new ConsoleLogger(LogLevel.INFO)

const fetchLanguage = async (): Promise<void> => {
  log.start('Obtaining the Wollok Language specification')
  if (existsSync(WOLLOK_LANGUAGE_FOLDER)) {
    log.info('\tFound local version of Wollok Language!')
  } else {
    log.info(`\tChecking out the Wollok Language project to ./${WOLLOK_LANGUAGE_FOLDER} from ${WOLLOK_LANGUAGE_REPO} at tag: ${WOLLOK_LANGUAGE_TAG}`)
    mkdirSync(WOLLOK_LANGUAGE_FOLDER)
    const client = gitClient(WOLLOK_LANGUAGE_FOLDER)
    await client.clone(WOLLOK_LANGUAGE_REPO, '.')
    await client.checkout(WOLLOK_LANGUAGE_TAG)
  }
  log.done('Obtaining the Wollok Language specification')
}

fetchLanguage()