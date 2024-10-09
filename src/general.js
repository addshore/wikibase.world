import PQueue from 'p-queue';
import EventEmitter from 'node:events';

const CONCURRENCY = 10;
const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };
const queue = new PQueue({concurrency: CONCURRENCY});
const ee = new EventEmitter();

export { queue, ee, HEADERS };