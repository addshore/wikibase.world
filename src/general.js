import PQueue from 'p-queue';
import EventEmitter from 'node:events';

const HEADERS = { 'User-Agent': 'Addshore Addbot wikibase.world' };

// Create wrapper queues that track job names
const createTrackedQueue = (name, concurrency) => {
    const queue = new PQueue({concurrency});
    const jobs = new Map(); // Track active and pending jobs
    
    queue.on('active', () => {
        const active = Array.from(jobs.values()).filter(j => j.active);
        if (active.length > 0) {
            console.log(`▶️  [${name}] Running: ${active.map(j => j.name).join(', ')}`);
        }
    });
    
    const originalAdd = queue.add.bind(queue);
    queue.add = function(fn, options) {
        const jobName = options?.jobName || 'unnamed';
        const jobId = Math.random().toString(36).substr(2, 9);
        
        jobs.set(jobId, { name: jobName, active: false });
        
        const wrappedFn = async () => {
            jobs.set(jobId, { name: jobName, active: true });
            try {
                return await fn();
            } finally {
                jobs.delete(jobId);
            }
        };
        
        return originalAdd(wrappedFn, options);
    };
    
    queue.getJobNames = () => {
        const active = Array.from(jobs.values()).filter(j => j.active).map(j => j.name);
        const pending = Array.from(jobs.values()).filter(j => !j.active).map(j => j.name);
        return { active, pending };
    };
    
    return queue;
};

const queues = {
    // For now, while i hit lots of 429s, everything is 1
    // many : new PQueue({concurrency: 10}),
    // four : new PQueue({concurrency: 4}),
    many : createTrackedQueue('many', 4),
    four : createTrackedQueue('four', 2),
    one : createTrackedQueue('one', 1),
}
const ee = new EventEmitter();

// Add queue monitoring
const queueStats = () => {
    const getJobs = (queue) => {
        if (queue.getJobNames) {
            return queue.getJobNames();
        }
        return { active: [], pending: [] };
    };
    
    return {
        many: { 
            pending: queues.many.pending, 
            size: queues.many.size,
            jobs: getJobs(queues.many)
        },
        four: { 
            pending: queues.four.pending, 
            size: queues.four.size,
            jobs: getJobs(queues.four)
        },
        one: { 
            pending: queues.one.pending, 
            size: queues.one.size,
            jobs: getJobs(queues.one)
        },
    };
};

// Log queue stats every 30 seconds if there are pending items
setInterval(() => {
    const stats = queueStats();
    const totalPending = stats.many.pending + stats.four.pending + stats.one.pending;
    const totalSize = stats.many.size + stats.four.size + stats.one.size;
    if (totalPending > 0 || totalSize > 0) {
        console.log(`📊 Queue Status`);
        console.log(`   many: ${stats.many.size}(${stats.many.pending}) - active: [${stats.many.jobs.active.join(', ') || 'none'}] pending: [${stats.many.jobs.pending.slice(0, 3).join(', ') || 'none'}${stats.many.jobs.pending.length > 3 ? ` +${stats.many.jobs.pending.length - 3} more` : ''}]`);
        console.log(`   four: ${stats.four.size}(${stats.four.pending}) - active: [${stats.four.jobs.active.join(', ') || 'none'}] pending: [${stats.four.jobs.pending.slice(0, 3).join(', ') || 'none'}${stats.four.jobs.pending.length > 3 ? ` +${stats.four.jobs.pending.length - 3} more` : ''}]`);
        console.log(`   one:  ${stats.one.size}(${stats.one.pending}) - active: [${stats.one.jobs.active.join(', ') || 'none'}] pending: [${stats.one.jobs.pending.slice(0, 3).join(', ') || 'none'}${stats.one.jobs.pending.length > 3 ? ` +${stats.one.jobs.pending.length - 3} more` : ''}]`);
    }
}, 30000);

export { queues, ee, HEADERS, queueStats };