// server/src/worker.ts (New File)
import { Worker, Job } from 'bullmq';
import {Pool, PoolClient} from 'pg';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import logger from './utils/logger'; // Import your logger

dotenv.config();

// --- Reuse Redis Connection Logic (or import from queue.ts) ---
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
	max: 10, // Worker might need fewer connections than the API server
	connectionTimeoutMillis: 5000,
	idleTimeoutMillis: 10000,
	statement_timeout: 30000, // Give worker potentially more time for statements
});

pool.on('error', (err) => {
	logger.error('Worker DB pool error', err);
	// Maybe don't exit immediately, allow BullMQ retries?
});

pool.connect((err, client, release) => {
	if (err) {
		return logger.error('Worker failed to connect to DB on startup', err.stack);
	}
	logger.info('Worker connected to PostgreSQL database');
	release();
});

async function getOrCreateCategory(client: PoolClient, categoryName: string) {
	// 1. Attempt the insert with DO NOTHING
	const insertRes = await client.query(
		`INSERT INTO categories (name)
     VALUES ($1)
     ON CONFLICT (name) DO NOTHING
     RETURNING id;`,
		[categoryName]
	);

	// 2. Check if the insert happened and returned an ID
	if (insertRes.rows.length > 0) {
		return insertRes.rows[0].id; // Return the newly inserted ID
	} else {
		// 3. If DO NOTHING occurred, select the ID of the existing row
		const selectRes = await client.query(
			`SELECT id FROM categories WHERE name = $1;`,
			[categoryName]
		);
		if (selectRes.rows.length > 0) {
			return selectRes.rows[0].id; // Return the existing ID
		} else {
			// This case should ideally not happen if the logic is sound,
			// but handle potential race conditions or errors.
			throw new Error("Failed to get or create category ID.");
		}
	}
}


// --- Define the Job Processing Function ---
const processClogUpdate = async (job: Job) => {
	const { username, accountHash, collectedIds, categories } = job.data;
	const log = logger.child({ jobId: job.id, accountHash, username }); // Contextual logger

	log.info(`Processing clog update job started`);

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

		// 1. Process Categories and Subcategories
		log.info(`Processing ${categories.length} categories...`);
		const categoryIdMap = new Map(); // To store categoryName -> categoryId mapping

		for (const category of categories) {
			const categoryName = category.categoryName;
			if (!categoryName || !Array.isArray(category.subCategories)) {
				log.debug(`Skipping category due to missing name or subCategories: ${JSON.stringify(category)}`);
				continue;
			}

			try {
				const categoryId = await getOrCreateCategory(client, categoryName);

				categoryIdMap.set(categoryName, categoryId); // Store for subcategory insertion
				log.debug(`Upserted category '${categoryName}', ID: ${categoryId}`);

				// Insert subcategories for the current category
				for (const subCategory of category.subCategories) {
					const subcategoryIdFromJson = subCategory.subcategoryId; // ID from the JSON file
					const subcategoryName = subCategory.subcategoryName;
					const subcategoryKc = subCategory.kc || -1;

					if (typeof subcategoryIdFromJson !== 'number' || !subcategoryName) {
						log.warn(`Skipping subcategory due to missing id or name: ${JSON.stringify(subCategory)}`);
						continue;
					}

					// Insert subcategory using the ID from the JSON as the primary key
					// Assumes 'id' in subcategories table is the primary key and corresponds to subcategoryIdFromJson
					const subCategoryInsertQuery = `
                            INSERT INTO subcategories (id, categoryId, name)
                            VALUES ($1, $2, $3)
                            ON CONFLICT DO NOTHING; -- Ignore if subcategory ID already exists
						`;
					await client.query(subCategoryInsertQuery, [subcategoryIdFromJson, categoryId, subcategoryName]);

					const kcInsertQuery = `
							INSERT INTO player_kc (accountHash, subcategoryId, kc)
							VALUES ($1, $2, $3)
							ON CONFLICT (accountHash, subcategoryId) DO UPDATE SET kc = EXCLUDED.kc;
						`;
					await client.query(kcInsertQuery, [accountHash, subcategoryIdFromJson, subcategoryKc]);
				}
			} catch (catErr) {
				log.error(`Error processing category '${categoryName}':`, catErr);
				throw catErr; // Re-throw to trigger rollback
			}
		}
		log.info('Finished processing categories and subcategories.');

		// 2. Process Collected Items
		log.info(`Processing collected items for accountHash: ${accountHash}...`);
		const collectedItemsData = [];
		for (const subcategoryIdStr in collectedIds) {
			// Ensure the key is actually a property of the object
			if (Object.prototype.hasOwnProperty.call(collectedIds, subcategoryIdStr)) {
				const subcategoryId = parseInt(subcategoryIdStr, 10);
				const itemIds = collectedIds[subcategoryIdStr];

				if (isNaN(subcategoryId) || !Array.isArray(itemIds)) {
					log.warn(`Skipping invalid collectedIds entry. Key: ${subcategoryIdStr}, Value: ${JSON.stringify(itemIds)}`);
					continue;
				}

				for (const itemId of itemIds) {
					if (typeof itemId === 'number') {
						collectedItemsData.push({accountHash, subcategoryId, itemId});
					} else {
						log.warn(`Skipping invalid itemId for subcategoryId ${subcategoryId}: ${JSON.stringify(itemId)}`);
					}
				}
			}
		}

		// Bulk insert collected items using a single query for efficiency
		if (collectedItemsData.length > 0) {
			log.info(`Preparing to insert ${collectedItemsData.length} collected items...`);
			const valuesPlaceholders = collectedItemsData.map((_, index) =>
				`($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`
			).join(',');

			// Additional type validation
			const flatValues = collectedItemsData.flatMap(item => {
				// Ensure all values are numbers
				const accountHashNum = Number(item.accountHash);
				const subcategoryIdNum = Number(item.subcategoryId);
				const itemIdNum = Number(item.itemId);

				if (isNaN(accountHashNum) || isNaN(subcategoryIdNum) || isNaN(itemIdNum)) {
					throw new Error('Invalid numeric value in collected items data');
				}

				return [accountHashNum, subcategoryIdNum, itemIdNum];
			});

			const collectedItemsInsertQuery = `
					INSERT INTO collection_logs (accountHash, subcategoryId, itemId)
					VALUES
					${valuesPlaceholders}
					ON CONFLICT (accountHash, itemId)
					DO NOTHING;
				`;

			try {
				await client.query(collectedItemsInsertQuery, flatValues);
			} catch (itemErr) {
				log.error(`Error inserting collected items:`, itemErr);
				throw itemErr; // Re-throw to trigger rollback
			}

		} else {
			log.warn('No valid collected items found to insert.');
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
		// Re-throw the error so BullMQ knows the job failed and can retry
		throw err;
	} finally {
		client.release(); // ALWAYS release the client
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