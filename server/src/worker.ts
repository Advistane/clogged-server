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
	const { username, accountHash, profileVisible, collectedItems, subcategories } = job.data;
	const log = logger.child({ jobId: job.id, accountHash, username }); // Contextual logger
	log.info(`Processing clog update job started`);

	const client = await pool.connect();
	log.debug('Worker acquired DB client.');

	try {
		await client.query('BEGIN');
		log.debug('Worker transaction started.');

		const playerInsertQuery = `
            INSERT INTO players (accountHash, username, profile_visible_on_website)
            VALUES ($1, $2, $3)
            ON CONFLICT (accountHash) DO UPDATE SET username = EXCLUDED.username, profile_visible_on_website = EXCLUDED.profile_visible_on_website
            RETURNING id;
        `;

		const playerInsertResult = await client.query(playerInsertQuery, [accountHash, username, profileVisible]);
		const playerId = playerInsertResult.rows[0].id; // Store the id
		if (!playerId) {
			log.warn(`Player ID not found for accountHash: ${accountHash}`);
			throw new Error(`Player ID not found for accountHash: ${accountHash}`);
		}

		log.debug(`Player info processed for accountHash: ${accountHash}, playerId: ${playerId}`);

		// Batch Insert/Update Collected Items
		if (collectedItems && collectedItems.length > 0) {
			log.info(`Processing ${collectedItems.length} collected items for accountHash: ${accountHash} using batch update.`);

			const itemValues: string[] = [];
			const itemParams: (string | number | boolean)[] = [];
			let paramIndex = 1;

			for (const collectedItem of collectedItems) {
				const itemId = collectedItem.id;
				let quantity = collectedItem.quantity;

				if (!itemId) {
					log.warn(`Skipping collected item due to missing id: ${JSON.stringify(collectedItem)}`);
					continue;
				}

				if (quantity === undefined || quantity === null || quantity < 0) {
					quantity = -1;
				}

				itemValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);

				itemParams.push(playerId);
				itemParams.push(itemId);
				itemParams.push(quantity);

				paramIndex += 3;
			}

			if (itemValues.length > 0) {
				const itemInsertQuery = `
                    INSERT INTO player_items (playerid, itemid, quantity)
                    VALUES ${itemValues.join(', ')}
                    ON CONFLICT (playerid, itemid) DO UPDATE SET quantity = EXCLUDED.quantity;
                `;

				await client.query(itemInsertQuery, itemParams);
				log.debug(`Batch item update completed for ${itemValues.length} items.`);
			} else {
				log.info('No valid collected items to process.');
			}

		} else {
			log.info('No collected items provided in job data.');
		}

		// Batch Insert/Update Subcategory KCs
		if (subcategories && subcategories.length > 0) {
			log.info(`Processing ${subcategories.length} subcategory KCs for accountHash: ${accountHash} using batch update.`);

			const kcValues: string[] = [];
			const kcParams: (string | number | boolean)[] = [];
			let paramIndex = 1;

			for (const subcategory of subcategories) {
				const subcategoryId = subcategory.id;
				let kc = subcategory.kc;

				if (!subcategoryId) {
					log.warn(`Skipping subcategory KC due to missing id: ${JSON.stringify(subcategory)}`);
					continue;
				}

				if (kc === undefined || kc === null || kc < 0) {
					kc = -1;
				}

				kcValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);

				kcParams.push(playerId);
				kcParams.push(subcategoryId);
				kcParams.push(kc);

				paramIndex += 3;
			}

			if (kcValues.length > 0) {
				const kcInsertQuery = `
                    INSERT INTO player_kc (playerid, subcategoryid, kc)
                    VALUES ${kcValues.join(', ')}
                    ON CONFLICT (playerid, subcategoryid) DO UPDATE SET kc = EXCLUDED.kc;
                `;
				await client.query(kcInsertQuery, kcParams);
				log.debug(`Batch KC update completed for ${kcValues.length} subcategories.`);
			} else {
				log.info('No valid subcategory KCs to process.');
			}

		} else {
			log.info('No subcategory KCs provided in job data.');
		}

		await client.query('COMMIT');
		log.info('Transaction committed successfully.');
	} catch (err: any) {
		log.error(err, 'Error processing clog update job');
		// Rollback transaction on any error
		try {
			await client.query('ROLLBACK');
			log.warn('Worker transaction rolled back.');
		} catch (rollbackErr) {
			log.error(rollbackErr, 'Failed to rollback worker transaction', rollbackErr); // Log rollback error details
		}

		throw err;
	} finally {
		client.release();
		log.debug('Worker released DB client.');
	}
};


logger.info('Initializing Clog Update Worker...');
const worker = new Worker('clog-update', processClogUpdate, {
	connection: redisConnection,
	concurrency: 5,
	limiter: {
		max: 100,
		duration: 1000
	}
});

worker.on('completed', (job: Job, result: any) => {
	logger.info(`Job ${job.id} completed successfully.`);
});

worker.on('failed', (job: Job | undefined, error: Error) => {
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