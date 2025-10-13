/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	console.log('Adding unique constraint to player_items on (profile_id, itemid)...');
	pgm.addConstraint('player_items', 'player_items_profile_id_itemid_key', {
		unique: ['profile_id', 'itemid'],
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	console.log('Dropping unique constraint from player_items...');
	pgm.dropConstraint('player_items', 'player_items_profile_id_itemid_key');
};
