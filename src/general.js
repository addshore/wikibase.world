import PQueue from 'p-queue';
import EventEmitter from 'node:events';

const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };
const queues = {
    many : new PQueue({concurrency: 10}),
    four : new PQueue({concurrency: 4}),
    one : new PQueue({concurrency: 1}),
}
const ee = new EventEmitter();

export { queues, ee, HEADERS };