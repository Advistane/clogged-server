import {Router} from "express";
import {Pool} from "pg";

enum JoinSetting {
	Public = "public",
	Apply = "apply",
	Closed = "closed",
}

interface GroupResponse {
	joined: boolean;
	message: string;
}

export const createGroupsRouter = (pool: Pool) => {
	const router = Router();

	router.get("/", (req, res) => {
		res.json({message: "Groups"});
	});

	router.delete("/:groupName", async (req, res): Promise<any> => {
		const response: GroupResponse = {
			joined: false,
			message: "Group deletion is not implemented yet.",
		}
		return res.status(200).send(response);
	});

	router.post("/:groupName", async (req, res): Promise<any> => {
		const log = req.log; // Assuming req.log is available
		const {accountHash} = req.body;
		const groupName = req.params.groupName;
		log.info(`Received request to join group with username: ${accountHash} and group name: ${groupName}`);
		log.debug(`Request body: ${JSON.stringify(req.body)}`);

		if (!accountHash || !groupName) {
			log.warn("Account hash or group name is missing");
			return res.status(400).json({error: "Account hash and group name are required"});
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			log.debug("Transaction started");

			// 1. Get Group Info
			const groupCheckQuery = `
                SELECT id, joinsetting
                FROM groups
                WHERE name = $1;
			`;
			const groupCheckResult = await client.query(groupCheckQuery, [groupName]);
			if (groupCheckResult.rowCount === 0) {
				log.warn(`Group with name ${groupName} not found`);
				await client.query("ROLLBACK"); // Rollback before returning
				const response: GroupResponse = {
					joined: false,
					message: "Group not found. Try again.",
				}
				return res.status(404).json(response);
			}

			const groupId = groupCheckResult.rows[0].id;
			const joinSetting: JoinSetting = groupCheckResult.rows[0].joinsetting;

			log.debug(`Group found with ID: ${groupId} and joinSetting: ${joinSetting}`);

			const playerQuery = `
                SELECT id
                FROM players
                WHERE accounthash = $1;
			`;

			const playerResult = await client.query(playerQuery, [accountHash]);
			if (playerResult.rowCount === 0) {
				log.warn(`Player with account hash ${accountHash} not found`);
				await client.query("ROLLBACK"); // Rollback before returning
				return res.status(400).json({error: "Player not found"});
			}
			const playerId = playerResult.rows[0].id;
			log.debug(`Player found with ID: ${playerId}`);

			const isPlayerInGroupQuery = `
                SELECT id, joined
                FROM group_members
                WHERE playerid = $1
                  AND groupid = $2;
			`;
			const isPlayerInGroupResult = await client.query(isPlayerInGroupQuery, [playerId, groupId]);

			// Player is already in the group (whether joined or not)
			if (isPlayerInGroupResult.rowCount && isPlayerInGroupResult.rowCount > 0) {
				const isPlayerInGroup = isPlayerInGroupResult.rows[0].joined;
				if (isPlayerInGroup) {
					log.info(`Player ${playerId} is already a member of group ${groupName}`);
					await client.query("ROLLBACK");
					return res.status(200).json({joined: true, message: "You are already a member of this group."});
				} else {
					log.info(`Player ${playerId} has applied to group ${groupName}`);
					await client.query("ROLLBACK");
					return res.status(200).json({joined: false, message: "You have already applied to this group."});
				}
			}

			const isGroupClosed = (joinSetting === JoinSetting.Closed);

			// Group is closed and player is not in the group
			if (isGroupClosed) {
				log.info(`Group ${groupName} is closed`);
				await client.query("ROLLBACK");
				const response: GroupResponse = {
					joined: false,
					message: "Group is not accepting new members at this time.",
				}
				return res.status(403).json(response);
			}

			const insertGroupMemberQuery = `
				INSERT INTO group_members (playerid, groupid, joined)
				VALUES ($1, $2, $3)
				ON CONFLICT (playerid, groupid) DO NOTHING 
				RETURNING id;
			`;
			const joined = (joinSetting === JoinSetting.Public);
			const insertGroupMemberResult = await client.query(insertGroupMemberQuery, [playerId, groupId, joined]);

			if (insertGroupMemberResult.rowCount === 0) {
				log.warn(`Player ${playerId} could not be added to group ${groupName}`);
				await client.query("ROLLBACK");
				return res.status(400).json({error: "Could not add player to group"});
			}

			const groupMemberId = insertGroupMemberResult.rows[0].id;
			log.debug(`Player ${playerId} added to group ${groupName} with member ID: ${groupMemberId}`);
			await client.query("COMMIT");
			log.debug("Transaction committed");

			if (joined) {
				log.info(`Player ${playerId} joined group ${groupName}`);
				return res.status(200).json({joined: true, message: "You have successfully joined the group!"});
			} else {
				log.info(`Player ${playerId} applied to group ${groupName}`);
				return res.status(200).json({joined: false, message: "You have successfully applied to the group! A group admin must approve your request."});
			}

		} catch (error) {
			log.error(`Error processing request: ${error}`);
			await client.query("ROLLBACK");
			log.debug("Transaction rolled back");
			return res.status(500).json({error: "Internal server error"});
		} finally {
			client.release();
		}
	});

	return router;
}