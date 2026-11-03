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

// The game mode a player last reported from their own client when sending a !clog lookup
const ACTIVE_GAME_MODE_TTL_SECONDS = 24 * 60 * 60;
// RuneLite RuneScapeProfileType names, e.g. STANDARD, DEADMAN, DEMONIC_PACTS_LEAGUE
const GAME_MODE_PATTERN = /^[A-Z_]{1,64}$/;

const activeGameModeKey = (username: string) => `active-game-mode:${username.toLowerCase()}`;

export const createUserRouter = (pool: Pool) => {
	const router = Router();

	// Update user's collection log
	router.put('/update', async (req, res): Promise<any> => {
		const requestBody: UserCollectionData = req.body;
		const accountHash = requestBody.accountHash;
		const gameMode = requestBody.gameMode || 'STANDARD';
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
			gameMode,
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

	// Store the game mode a player is currently on, so other players' clients look up the right profile
	router.put('/active-game-mode', async (req, res): Promise<any> => {
		const log = req.log;
		const {accountHash, gameMode} = req.body ?? {};

		if (!accountHash || typeof gameMode !== 'string' || !GAME_MODE_PATTERN.test(gameMode)) {
			log.warn({accountHash, gameMode}, 'Invalid active game mode request');
			return res.status(400).send('Invalid request body. accountHash and a valid gameMode are required.');
		}

		try {
			// Key on the username stored for this account hash, so a client can only set its own player's mode
			const playerResult = await pool.query('SELECT username FROM players WHERE accounthash = $1;', [accountHash]);
			if (playerResult.rowCount === 0 || !playerResult.rows[0].username) {
				log.debug({accountHash}, 'Active game mode reported for unknown player');
				return res.status(404).send('Player not found.');
			}

			const username: string = playerResult.rows[0].username;
			await redisConnection.set(activeGameModeKey(username), gameMode, 'EX', ACTIVE_GAME_MODE_TTL_SECONDS);
			log.info({username, gameMode}, 'Stored active game mode');

			return res.sendStatus(204);
		} catch (err) {
			log.error(err, 'Failed to store active game mode');
			return res.status(500).send('Server error');
		}
	});

	router.get('/:username/:subcategoryName', async (req, res): Promise<any> => {
		const log = req.log;

		const username: string = decodeURIComponent(req.params.username);
		const subcategoryName: string = req.params.subcategoryName;
		const mode: string = (req.query.mode as string) || 'owned';
		const otherLookup: boolean = (req.query.other as string) === 'true';
		const useActiveGameMode: boolean = (req.query.useActiveGameMode as string) === 'true';
		let gameMode: string = (req.query.gameMode as string) || 'STANDARD';

		if (mode !== 'owned' && mode !== 'missing') {
			log.warn({username, mode}, 'Invalid mode parameter');
			return res.status(400).send("Invalid 'mode' parameter. Must be 'owned' or 'missing'.");
		}

		let subcategoryAliased: string = getSubcategoryAlias(subcategoryName);

		log.info({username, subcategoryAliased, mode, otherLookup, profileMode: gameMode}, 'Fetching collection log data request');

		if (!username || !subcategoryAliased) {
			res.status(400).send('Invalid username or subcategory name');
			return;
		}

		// Prefer the game mode the player reported from their own client, over what the requesting client detected
		if (useActiveGameMode) {
			try {
				const activeGameMode = await redisConnection.get(activeGameModeKey(username));
				if (activeGameMode) {
					log.debug({username, requestedGameMode: gameMode, activeGameMode}, 'Using active game mode');
					gameMode = activeGameMode;
				}
			} catch (redisError) {
				log.error({username, redisError}, 'Failed to read active game mode, using requested game mode');
			}
		}

		// Check cache first
		const cacheKey = `clog:${username}:${subcategoryAliased}:${mode}:${otherLookup}:${gameMode}`;
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
			let finalMetadataQuery = `
                SELECT p.username          AS player_username,
                       pr.id               AS profile_id, -- This is the new ID we need
                       pr.game_mode        AS game_mode,
                       s.id                AS subcategory_id,
                       s.name              AS validated_subcategory_name,
                       s.total             AS total,
                       COALESCE(pkc.kc, 0) AS kc
                FROM players p
                         JOIN profiles pr ON p.id = pr.player_id
                         JOIN subcategories s ON s.name = $2
                         LEFT JOIN player_kc pkc ON pkc.profile_id = pr.id AND pkc.subcategoryId = s.id AND pkc.kc != -1
                WHERE p.username ILIKE $1
			`;

			if (otherLookup) {
				finalMetadataQuery += ' AND p.profile_visible_on_website = true';
			}

			// Failsafe: if the player has no profile for the requested game mode, fall back to their STANDARD
			// profile, then to their newest profile
			finalMetadataQuery += `
                ORDER BY (pr.game_mode = $3) DESC,
                         (pr.game_mode = 'STANDARD') DESC,
                         pr.created_at DESC
                LIMIT 1;
			`;

			const metadataResult = await client.query(finalMetadataQuery, [username, subcategoryAliased, gameMode]);

			if (metadataResult.rows.length === 0) {
				log.warn({
					username,
					subcategoryAliased,
					otherLookup
				}, 'Metadata not found: Player or Subcategory does not exist, or combination is invalid.');
				let responseMessage: string;
				if (otherLookup) {
					responseMessage = 'No data was found. Ensure the other account has a public profile and the clog name is correct.';
				} else {
					responseMessage = 'No data was found for this input.';
				}

				res.status(404).send(responseMessage);
				return;
			}

			const {
				profile_id: profileId,
				game_mode: resolvedGameMode,
				player_username: playerUsername,
				subcategory_id: subcategoryId,
				validated_subcategory_name: validatedSubcategoryName,
				total,
				kc
			} = metadataResult.rows[0];

			log.debug({
				username,
				subcategoryAliased,
				profileId,
				requestedGameMode: gameMode,
				resolvedGameMode,
				subcategoryId,
				validatedSubcategoryName,
				total,
				kc
			}, 'Metadata fetched');

			// --- Query 2: Fetch Items (Owned or Missing) ---
			let itemsResult;
			const items: CollectionLogItemOutput[] = [];

			if (mode === 'owned') {
				const ownedItemsQuery = `
                    SELECT pi.itemid, pi.quantity
                    FROM player_items pi
                    JOIN subcategory_items sci ON sci.itemid = pi.itemid
                    WHERE pi.profile_id = $1
                    AND sci.subcategoryid = $2
                    ORDER BY sci.displayorder;
				`;
				itemsResult = await client.query(ownedItemsQuery, [profileId, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({itemId: row.itemid, quantity: row.quantity});
				});
			} else { // mode === 'missing'
				const missingItemsQuery = `
                    SELECT sci.itemid
                    FROM subcategory_items sci
                    WHERE sci.subcategoryid = $2
                      AND NOT EXISTS (SELECT 1
                                      FROM player_items pi
                                      WHERE pi.profile_id = $1
                                        AND pi.itemid = sci.itemid)
                    ORDER BY sci.displayorder;
				`;
				itemsResult = await client.query(missingItemsQuery, [profileId, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({itemId: row.itemid, quantity: 1});
				});
			}
			log.debug({username, subcategoryAliased, mode, itemCount: items.length}, 'Items fetched');

			const response = {
				username: playerUsername,
				gameMode: resolvedGameMode,
				kc: Number(kc),
				subcategoryName: validatedSubcategoryName,
				total: Number(total),
				items,
			};

			try {
				const responseString = JSON.stringify(response);
				await redisConnection.set(cacheKey, responseString, 'EX', cacheTTLSeconds);
				log.debug({cacheKey, ttl: cacheTTLSeconds}, 'Result stored in Redis cache');
			} catch (redisSetError) {
				log.error({err: redisSetError, cacheKey}, 'Redis SET command failed');
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
		const requestedGameMode: string = (req.query.gameMode as string) || 'STANDARD';
		log.info({username, requestedGameMode}, 'Fetching collection log data request');
		if (!username) {
			res.status(400).send('Invalid username');
			return;
		}

		const client = await pool.connect();
		try {
			const profilesQuery = `
                SELECT p.username, pr.id AS profile_id, pr.game_mode
                FROM players p
                         JOIN profiles pr ON pr.player_id = p.id
                WHERE p.username ILIKE $1
                  AND p.profile_visible_on_website = true
                ORDER BY pr.id;
			`;
			const profilesResult = await client.query(profilesQuery, [username]);

			if (profilesResult.rowCount === 0) {
				log.warn({username}, 'Username not found, profile not visible, or no game mode profiles exist.');
				res.status(404).send('Username not found or profile not visible.');
				return;
			}

			const availableGameModes: string[] = profilesResult.rows.map(row => row.game_mode);
			// Fall back to the player's first profile if the requested mode doesn't exist for them
			const selectedProfile = profilesResult.rows.find(row => row.game_mode === requestedGameMode)
				|| profilesResult.rows[0];
			const profileId = selectedProfile.profile_id;
			const gameMode: string = selectedProfile.game_mode;
			const playerUsername: string = selectedProfile.username;

			log.debug({username, gameMode, profileId, availableGameModes}, 'Resolved profile for website lookup');

			const metadataQuery = `
                WITH all_items AS (
                    -- Step 1: Collect all items for each subcategory
                    SELECT si.id,
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
                             JOIN categories c ON c.id = s.categoryid),
                     owned_items AS (
                         -- Step 2: Collect items owned by the selected profile (one row per item)
                         SELECT pi.itemid,
                                pi.quantity
                         FROM player_items pi
                         WHERE pi.profile_id = $1),
                     items_by_subcategory AS (
                         -- Step 3: Aggregate both owned and missing items for each subcategory
                         SELECT ai.subcategoryid,
                                ai.subcategory_name,
                                ai.categoryid,
                                ai.category_name,
                                json_agg(
                                        json_build_object(
                                                'item_id', ai.originalitemid,
                                                'quantity', COALESCE(oi.quantity, 0), -- 0 for missing items
                                                'image_url', ai.image_url,
                                                'item_name', ai.itemname,
                                                'owned', oi.itemid IS NOT NULL
                                        ) ORDER BY (oi.itemid IS NOT NULL) DESC, ai.id
                                )                        AS items_json,
                                COUNT(oi.itemid)         AS owned_items_count,
                                COALESCE(MAX(pkc.kc), 0) AS kc -- Include player_kc.kc
                         FROM all_items ai
                                  LEFT JOIN owned_items oi ON ai.itemid = oi.itemid
                                  LEFT JOIN player_kc pkc ON pkc.subcategoryid = ai.subcategoryid
                             AND pkc.profile_id = $1 AND pkc.kc != -1
                         GROUP BY ai.subcategoryid, ai.subcategory_name, ai.categoryid, ai.category_name),
                     subcategories_by_category AS (
                         -- Step 4: Aggregate subcategories for each category
                         SELECT categoryid,
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
                         GROUP BY categoryid, category_name)
                -- Step 5: Final aggregation of categories
                SELECT json_agg(
                               json_build_object(
                                       'category_name', category_name,
                                       'subcategories', subcategories_json
                               ) ORDER BY category_name -- Consistent output order
                       ) AS categories
                FROM subcategories_by_category;
			`;
			const metadataResult = await client.query(metadataQuery, [profileId]);

			if (metadataResult.rows.length === 0 || !metadataResult.rows[0].categories) {
				log.warn({username, gameMode}, 'No data found for the user.');
				res.status(404).send('No data found for the user.');
				return;
			}

			const response = {
				username: playerUsername,
				gameMode,
				availableGameModes,
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
