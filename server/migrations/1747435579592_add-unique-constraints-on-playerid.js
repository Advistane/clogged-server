/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.addConstraint('player_items', 'player_items_playerid_itemid_unique', {
		unique: ['playerid', 'itemid'],
	});
	pgm.addConstraint('player_kc', 'player_kc_playerid_subcategoryid_unique', {
		unique: ['playerid', 'subcategoryid'],
	});
	pgm.addConstraint('group_members', 'group_members_playerid_groupid_unique', {
		unique: ['playerid', 'groupid'],
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropConstraint('player_items', 'player_items_playerid_itemid_unique');
	pgm.dropConstraint('player_kc', 'player_kc_playerid_subcategoryid_unique');
	pgm.dropConstraint('group_members', 'group_members_playerid_groupid_unique');
};
