import {Router} from 'express';
import {Pool} from 'pg';
import {clogUpdateQueue, redisConnection} from "../queue";
import {Job} from "bullmq";
import {UserCollectionData} from "../models/UpdateCollectionLogRequest";
import {getSubcategoryAlias} from "../utils/alias";

export interface Kc {
	kc: number;
}

export interface CollectionLogItem {
	quantity: number;
	itemid: number;
	kc: number | null;
	name: string;
}

interface CollectionLogItemOutput {
	itemId: number;
	quantity: number;
}

export const createUserRouter = (pool: Pool) => {
	const router = Router();

	// Update user's collection log
	router.put('/update', async (req, res): Promise<any> => {
		const requestBody: UserCollectionData = req.body;
		const accountHash = requestBody.accountHash;
		const username = requestBody.username;
		const profileVisible = requestBody.profileVisible;
		const collectedItems = requestBody.collectedItems;
		const subcategories = requestBody.subcategories;

		req.log.info({accountHash, username, profileVisible}, 'Received clog update request');

		if (typeof collectedItems !== 'object' || collectedItems === null) {
			req.log.warn('Invalid request body structure or types for clog update');
			return res.status(400).json({error: 'Invalid request body. Ensure username (string), accountHash (number), collectedIds (object), and categories (array) are provided with correct types.'});
		}

		if (Object.keys(collectedItems).length === 0) {
			req.log.warn('Received request with empty collectedIds or categories.');
			return res.status(400).json({error: 'collectedIds or categories cannot be empty.'});
		}

		const jobPayload: UserCollectionData = {
			username,
			accountHash,
			collectedItems,
			subcategories,
			profileVisible: profileVisible || false,
		};
		req.log.info({jobPayload}, 'Clog update job payload');

		try {
			const job: Job<UserCollectionData> = await clogUpdateQueue.add('clog-update-job', jobPayload); // Job name + payload
			const generatedJobId = job.id;

			req.log.info({generatedJobId, accountHash}, 'Clog update job added to queue');

			return res.status(202).json({
				message: 'Update request received and queued for processing.',
				jobId: generatedJobId
			});

		} catch (queueError) {
			req.log.error(queueError, 'Failed to add clog update job to queue');
			return res.status(500).json({error: 'Failed to queue update request.'});
		}
	});

	router.get('/:username/:subcategoryName', async (req, res): Promise<any> => {
		const log = req.log;
		const username: string = decodeURIComponent(req.params.username);
		const subcategoryName: string = req.params.subcategoryName;
		const mode: string = (req.query.mode as string) || 'owned';
		const otherLookup: boolean = (req.query.other as string) === 'true' || false;

		if (mode !== 'owned' && mode !== 'missing') {
			log.warn({username, mode}, 'Invalid mode parameter');
			return res.status(400).send("Invalid 'mode' parameter. Must be 'owned' or 'missing'.");
		}

		let subcategoryAliased: string = getSubcategoryAlias(subcategoryName);

		log.info({username, subcategoryAliased}, 'Fetching collection log data request');

		if (!username || !subcategoryAliased) {
			res.status(400).send('Invalid username or subcategory name');
			return;
		}

		// Check cache first
		const cacheKey = `clog:${username}:${subcategoryAliased}:${mode}:${otherLookup}`;
		const cacheTTLSeconds = 10;
		try {
			const cachedDataString = await redisConnection.get(cacheKey);
			if (cachedDataString) {
				log.debug({username, cacheKey}, 'Redis cache hit');
				try {
					const cachedData = JSON.parse(cachedDataString);
					return res.json(cachedData);
				} catch (parseError) {
					log.error({username, parseError, cacheKey}, "Failed to parse cached data from Redis");
				}
			} else {
				log.debug({username, cacheKey}, 'Redis cache miss');
			}
		} catch (redisError) {
			log.error({username, redisError, cacheKey}, 'Redis GET command failed, falling back to DB');
		}

		const client = await pool.connect();
		try {
			let metadataQuery = `
            SELECT
                p.id AS playerid,
                p.username AS player_username,
                s.id AS subcategory_id,
                s.name AS validated_subcategory_name,
                s.total AS total,
                COALESCE(pkc.kc, 0) AS kc
            FROM
                players p
            JOIN
                subcategories s ON s.name = $2 -- Use subcategoryAliased
            LEFT JOIN
                player_kc pkc ON pkc.playerid = p.id AND pkc.subcategoryId = s.id AND pkc.kc != -1
            WHERE
                p.username ILIKE $1
        `;
			if (otherLookup) {
				metadataQuery += ' AND p.profile_visible_on_website = true';
			}
			metadataQuery += ';';

			const metadataResult = await client.query(metadataQuery, [username, subcategoryAliased]);

			if (metadataResult.rows.length === 0) {
				log.warn({ username, subcategoryAliased, otherLookup }, 'Metadata not found: Player or Subcategory does not exist, or combination is invalid.');
				let responseMessage: string;
				if (otherLookup) {
					responseMessage = 'No data was found. Ensure the other account has a public profile and the clog name is correct.';
				} else {
					responseMessage = 'No data was found for this input.';
				}

				res.status(404).send(responseMessage);
				return;
			}

			const { playerid: playerid, player_username: playerUsername, subcategory_id: subcategoryId, validated_subcategory_name: validatedSubcategoryName, total, kc } = metadataResult.rows[0];
			log.debug({ username, subcategoryAliased, playerid, subcategoryId, validatedSubcategoryName, total, kc }, 'Metadata fetched');

			// --- Query 2: Fetch Items (Owned or Missing) ---
			let itemsResult;
			const items: CollectionLogItemOutput[] = [];

			if (mode === 'owned') {
				const ownedItemsQuery = `
                    SELECT pi.itemid, pi.quantity
                    FROM player_items pi
                             JOIN subcategory_items sci ON sci.itemid = pi.itemid
                    WHERE pi.playerid = $1
                      AND sci.subcategoryid = $2
                    ORDER BY sci.id;
				`;
				itemsResult = await client.query(ownedItemsQuery, [playerid, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({ itemId: row.itemid, quantity: row.quantity });
				});
			} else { // mode === 'missing'
				const missingItemsQuery = `
	                SELECT sci.itemid
	                FROM subcategory_items sci
	                WHERE sci.subcategoryid = $2
	                AND NOT EXISTS (
	                    SELECT 1
	                    FROM player_items pi
	                    WHERE pi.playerid = $1
	                    AND pi.itemid = sci.itemid
	                ) 
	                ORDER BY sci.id;
            	`;
				itemsResult = await client.query(missingItemsQuery, [playerid, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({ itemId: row.itemid, quantity: 1 }); // Missing items have quantity 0
				});
			}
			log.debug({ username, subcategoryAliased, mode, itemCount: items.length }, 'Items fetched');

			const response = {
				username: playerUsername,
				kc: Number(kc),
				subcategoryName: validatedSubcategoryName,
				total: Number(total),
				items,
			};

			try {
				const responseString = JSON.stringify(response);
				await redisConnection.set(cacheKey, responseString, 'EX', cacheTTLSeconds);
				log.debug({ cacheKey, ttl: cacheTTLSeconds }, 'Result stored in Redis cache');
			} catch (redisSetError) {
				log.error({ err: redisSetError, cacheKey }, 'Redis SET command failed');
			}

			res.json(response);
		} catch (err) {
			log.error(err, 'Error querying items');
			res.status(500).send('Server error');
		} finally {
			if (client) {
				client.release();
				log.debug('Database client released');
			}
		}
	});

	router.get('/:username', async (req, res): Promise<any> => {
		const log = req.log;
		const username: string = decodeURIComponent(req.params.username);
		log.info({username}, 'Fetching collection log data request');
		if (!username) {
			res.status(400).send('Invalid username');
			return;
		}

		const client = await pool.connect();
		try {
			const userExistsQuery = `
                SELECT 1
                FROM players
                WHERE username ILIKE $1 AND profile_visible_on_website = true;
			`;
			const userExistsResult = await client.query(userExistsQuery, [username]);

			if (userExistsResult.rowCount === 0) {
				log.warn({ username }, 'Username not found or profile not visible.');
				res.status(404).send('Username not found or profile not visible.');
				return;
			}

			const metadataQuery = `
                WITH player_acc AS (
                    -- Step 1: Get the accounthash for the target player
                    SELECT id
                    FROM players
                    WHERE username ILIKE $1 AND profile_visible_on_website = true
                ),
                     all_items AS (
                         -- Step 2: Collect all items for each subcategory
                         SELECT
                             si.id,
                             si.itemid,
                             si.originalitemid,
                             si.subcategoryid,
                             si.image_url,
                             si.itemname,
                             s.categoryid,
                             s.name AS subcategory_name,
                             c.name AS category_name
                         FROM subcategory_items si
                                  JOIN subcategories s ON s.id = si.subcategoryid
                                  JOIN categories c ON c.id = s.categoryid
                         ORDER BY si.id
                     ),
                     player_items AS (
                         -- Step 3: Collect items owned by the player
                         SELECT
                             pi.itemid,
                             pi.quantity,
                             si.subcategoryid
                         FROM player_acc pa
                                  JOIN player_items pi ON pi.playerid = pa.id
                                  JOIN subcategory_items si ON si.itemid = pi.itemid
                         ORDER BY si.id
                     ),
                     items_by_subcategory AS (
                         -- Step 4: Aggregate both owned and missing items for each subcategory
                         SELECT
                             ai.subcategoryid,
                             ai.subcategory_name,
                             ai.categoryid,
                             ai.category_name,
                             json_agg(
                                     json_build_object(
                                             'item_id', ai.originalitemid,
                                             'quantity', COALESCE(pi.quantity, 0), -- 0 for missing items
                                             'image_url', ai.image_url,
                                             'item_name', ai.itemname,
                                             'owned', CASE WHEN pi.itemid IS NOT NULL THEN true ELSE false END
                                     ) ORDER BY (COALESCE(pi.quantity, 0) > 0) DESC, ai.id
                             ) AS items_json,
                             COUNT(CASE WHEN pi.quantity > 0 THEN 1 END) as owned_items_count,
                             COALESCE(MAX(pkc.kc), 0) AS kc -- Include player_kc.kc
                         FROM all_items ai
                                  LEFT JOIN player_items pi ON ai.itemid = pi.itemid
                                  LEFT JOIN player_kc pkc ON pkc.subcategoryid = ai.subcategoryid
                             AND pkc.playerid = (SELECT player_acc.id FROM player_acc)
                         GROUP BY ai.subcategoryid, ai.subcategory_name, ai.categoryid, ai.category_name
                     ),
                     subcategories_by_category AS (
                         -- Step 5: Aggregate subcategories for each category
                         SELECT
                             categoryid,
                             category_name,
                             json_agg(
                                     json_build_object(
                                             'name', subcategory_name,
                                             'items', items_json,
                                             'owned_items_count', owned_items_count,
                                             'kc', kc -- Add kc to the subcategory
                                     ) ORDER BY subcategory_name -- Consistent output order
                             ) AS subcategories_json
                         FROM items_by_subcategory
                         GROUP BY categoryid, category_name
                     )
                -- Step 6: Final aggregation of categories
                SELECT
                    json_agg(
                            json_build_object(
                                    'category_name', category_name,
                                    'subcategories', subcategories_json
                            ) ORDER BY category_name -- Consistent output order
                    ) AS categories
                FROM subcategories_by_category;
			`;
			const metadataResult = await client.query(metadataQuery, [username]);

			if (metadataResult.rows.length === 0 || !metadataResult.rows[0].categories) {
				log.warn({ username }, 'No data found for the user.');
				res.status(404).send('No data found for the user.');
				return;
			}

			const response = {
				categories: metadataResult.rows[0].categories,
			};

			res.json(response);
		} catch (err) {
			log.error(err, 'Error querying data');
			res.status(500).send('Server error');
		} finally {
			client.release();
			log.debug('Database client released');
		}

	})

	return router;
};
