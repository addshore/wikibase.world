import PQueue from 'p-queue';
import EventEmitter from 'node:events';
import process from 'node:process'; // Added import

// Helper function to get concurrency from environment variables
const getConcurrency = (envVar, defaultValue) => {
  const val = parseInt(process.env[envVar], 10);
  if (!isNaN(val) && val > 0) {
    console.log(`Queue concurrency for ${envVar} set to ${val} from environment.`);
    return val;
  }
  console.log(`Queue concurrency for ${envVar} not set or invalid, using default: ${defaultValue}.`);
  return defaultValue;
};

const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };

const queues = {
  many: new PQueue({ concurrency: getConcurrency('QUEUE_CONCURRENCY_MANY', 4) }), // Default 4, for highly parallelizable tasks
  four: new PQueue({ concurrency: getConcurrency('QUEUE_CONCURRENCY_FOUR', 2) }), // Default 2, for moderately parallelizable tasks
  one: new PQueue({ concurrency: getConcurrency('QUEUE_CONCURRENCY_ONE', 1) }),   // Default 1, for sequential tasks (e.g., Wikibase edits)
};

const ee = new EventEmitter();

export { queues, ee, HEADERS };