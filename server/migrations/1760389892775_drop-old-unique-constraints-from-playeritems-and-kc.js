/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	console.log('Updating unique constraints for player_kc...');
	const oldConstraintName = 'player_kc_playerid_subcategoryid_unique';
	console.log(`-> Dropping old constraint: ${oldConstraintName}`);
	pgm.dropConstraint('player_kc', oldConstraintName);
	const newConstraintName = 'player_kc_profile_id_subcategoryid_key';
	console.log(`-> Adding new constraint: ${newConstraintName}`);
	pgm.addConstraint('player_kc', newConstraintName, {
		unique: ['profile_id', 'subcategoryid'],
	});

	console.log('Dropping old unique constraint: player_items_playerid_itemid_unique...');
	pgm.dropConstraint('player_items', 'player_items_playerid_itemid_unique');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	console.log('Reverting player_kc constraints...');

	// Reverse order: first drop the new constraint.
	const newConstraintName = 'player_kc_profile_id_subcategoryid_key';
	console.log(`-> Dropping new constraint: ${newConstraintName}`);
	pgm.dropConstraint('player_kc', newConstraintName);

	// Then re-add the old one.
	const oldConstraintName = 'player_kc_playerid_subcategoryid_unique';
	console.log(`-> Re-adding old constraint: ${oldConstraintName}`);
	pgm.addConstraint('player_kc', oldConstraintName, {
		unique: ['playerid', 'subcategoryid'],
	});

	console.log('Re-adding old unique constraint to player_items on (playerid, itemid)...');
	pgm.addConstraint('player_items', 'player_items_playerid_itemid_unique', {
		unique: ['playerid', 'itemid'],
	});
};
