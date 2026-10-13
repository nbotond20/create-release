import { reportFailure } from './logger.js'
import { run } from './main.js'

run().catch(reportFailure)
