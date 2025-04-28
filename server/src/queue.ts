import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import logger from './utils/logger';

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

// Reusable connection instance
export const redisConnection = new IORedis(redisPort, redisHost, {
	maxRetriesPerRequest: null // Prevent BullMQ from giving up easily on connection issues
});

redisConnection.on('connect', () => logger.info('Connected to Redis for BullMQ'));
redisConnection.on('error', (err) => logger.error('Redis connection error for BullMQ', err));

// Define the queue - name must match what the worker listens to
export const clogUpdateQueue = new Queue('clog-update', {
	connection: redisConnection,
	defaultJobOptions: {
		attempts: 3, // Retry failed jobs 3 times
		backoff: { // Exponential backoff strategy
			type: 'exponential',
			delay: 1000, // Initial delay 1s
		},
		removeOnComplete: true, // Keep queue clean
		removeOnFail: 1000 // Keep failed jobs for inspection (e.g., 1000 jobs)
	}
});

logger.info(`Clog update queue initialized on redis://${redisHost}:${redisPort}`);

// Optional: Graceful shutdown handling
export const closeQueue = async () => {
	await clogUpdateQueue.close();
	await redisConnection.quit();
	logger.info('BullMQ queue and Redis connection closed');
};