import { Worker, Job } from 'bullmq';
import {Pool} from 'pg';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import logger from './utils/logger';
import {UserCollectionData} from "./models/UpdateCollectionLogRequest";

dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisConnection = new IORedis(redisPort, redisHost, {
	maxRetriesPerRequest: null
});

redisConnection.on('connect', () => logger.info('Worker connected to Redis'));
redisConnection.on('error', (err) => logger.error('Worker Redis connection error', err));

// --- Database Connection (Same as in index.ts) ---
const pool = new Pool({
	host: process.env.DB_HOST || 'db',
	port: parseInt(process.env.DB_PORT || '5432'),
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	max: 10,
	connectionTimeoutMillis: 5000,
	idleTimeoutMillis: 10000,
	statement_timeout: 10000,
});

pool.on('error', (err) => {
	logger.error('Worker DB pool error', err);
});

pool.connect((err, client, release) => {
	if (err) {
		return logger.error('Worker failed to connect to DB on startup', err.stack);
	}
	logger.info('Worker connected to PostgreSQL database');
	release();
});

const processClogUpdate = async (job: Job<UserCollectionData>) => {
	const { username, accountHash, collectedItems, subcategories } = job.data;
	const log = logger.child({ jobId: job.id, accountHash, username }); // Contextual logger
	log.info(`Processing clog update job started`, job.data);

	const client = await pool.connect();
	log.debug('Worker acquired DB client.');
	try {
		await client.query('BEGIN'); // Start transaction
		log.debug('Worker transaction started.');

		const playerInsertQuery = `
				INSERT INTO players (accountHash, username)
				VALUES ($1, $2)
				ON CONFLICT (accountHash) DO UPDATE SET username = EXCLUDED.username;
			`;
		await client.query(playerInsertQuery, [accountHash, username]);
		await client.query('COMMIT'); // Commit transaction

		log.info(`Processing collected items for accountHash: ${accountHash}...`);
		for (const collectedItem of collectedItems) {
			const itemId = collectedItem.id;
			let quantity = collectedItem.quantity;
			if (!itemId) {
				log.warn(`Skipping collected item due to missing id or quantity: ${JSON.stringify(collectedItem)}`);
				continue;
			}
			if (!quantity || quantity < 0) {
				quantity = -1;
			}
			const itemInsertQuery = `
					INSERT INTO player_items (accountHash, itemid, quantity)
					VALUES ($1, $2, $3)
					ON CONFLICT (accountHash, itemid) DO UPDATE SET quantity = EXCLUDED.quantity;
				`;
			await client.query(itemInsertQuery, [accountHash, itemId, quantity]);
		}

		log.info(`Processing subcategory ids for accountHash: ${accountHash}...`);
		for (const subcategory of subcategories) {
			const subcategoryId = subcategory.id;
			let kc = subcategory.kc;
			if (!subcategoryId) {
				log.warn(`Skipping collected item due to missing id: ${JSON.stringify(subcategory)}`);
				continue;
			}

			if (!kc || kc < 0) {
				kc = -1;
			}

			try {
				const itemInsertQuery = `
					INSERT INTO player_kc (accountHash, subcategoryid, kc)
					VALUES ($1, $2, $3)
					ON CONFLICT (accountHash, subcategoryid) DO UPDATE SET kc = EXCLUDED.kc;
				`;
				await client.query(itemInsertQuery, [accountHash, subcategoryId, kc]);
			} catch (err) {
				log.error(err, `Error inserting/updating player_kc for accountHash: ${accountHash}, subcategoryId: ${subcategoryId}`);
			}
		}

		await client.query('COMMIT'); // Commit transaction
		log.info('Transaction committed successfully.');

		// Optional: Add cache invalidation logic here if needed
		// const cacheKey = `${username}-${subcategoryId}`; // Need to figure out which keys to bust
		// cache.del(cacheKey); // Requires access to the cache instance or Redis

	} catch (err: any) {
		log.error(err, 'Error processing clog update job');
		try {
			await client.query('ROLLBACK'); // Rollback on error
			log.warn('Worker transaction rolled back.');
		} catch (rollbackErr) {
			log.error(rollbackErr, 'Failed to rollback worker transaction');
		}

		throw err;
	} finally {
		client.release();
		log.debug('Worker released DB client.');
	}
};


// --- Initialize and Start the Worker ---
logger.info('Initializing Clog Update Worker...');
const worker = new Worker('clog-update', processClogUpdate, { // Queue name must match Queue() in queue.ts
	connection: redisConnection,
	concurrency: 5, // Process up to 5 jobs concurrently (adjust based on resources)
	limiter: { // Optional: Rate limit jobs if needed
		max: 100, // Max 100 jobs
		duration: 1000 // per second
	}
});

worker.on('completed', (job: Job, result: any) => {
	logger.info(`Job ${job.id} completed successfully.`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
	// job might be undefined if connection failed, etc.
	logger.error(error, `Job ${job?.id} failed.`);
});

worker.on('error', (error: Error) => {
	logger.error(error, 'Worker encountered an error');
});

logger.info('Clog Update Worker started and waiting for jobs.');

// --- Graceful Shutdown ---
const gracefulShutdown = async () => {
	logger.info('Worker shutting down gracefully...');
	await worker.close();
	await redisConnection.quit();
	await pool.end();
	logger.info('Worker shutdown complete.');
	process.exit(0);
};

process.on('SIGTERM', gracefulShutdown); // Docker stop
process.on('SIGINT', gracefulShutdown);  // Ctrl+C