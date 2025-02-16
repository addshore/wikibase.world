import PQueue from 'p-queue';
import EventEmitter from 'node:events';

const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };
const queues = {
    // For now, while i hit lots of 429s, everything is 1
    // many : new PQueue({concurrency: 10}),
    // four : new PQueue({concurrency: 4}),
    many : new PQueue({concurrency: 4}),
    four : new PQueue({concurrency: 2}),
    one : new PQueue({concurrency: 1}),
}
const ee = new EventEmitter();

export { queues, ee, HEADERS };