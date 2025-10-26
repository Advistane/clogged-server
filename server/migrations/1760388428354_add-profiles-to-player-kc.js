/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	console.log("Starting migration for 'player_kc' table...");
	console.log('-> Adding profile_id column to player_kc...');
	pgm.addColumn('player_kc', {
		profile_id: {type: 'uuid', notNull: false}, // Initially allow nulls
	});

	console.log('-> Populating the new profile_id column...');
	pgm.sql(`
        UPDATE player_kc
        SET profile_id = profiles.id
        FROM profiles
        WHERE player_kc.playerid = profiles.player_id
          AND profiles.game_mode = 'STANDARD';
	`);

	console.log('-> Setting NOT NULL and adding foreign key to profile_id...');
	pgm.alterColumn('player_kc', 'profile_id', {notNull: true});
	pgm.addConstraint('player_kc', 'player_kc_profile_id_fkey', {
		foreignKeys: {
			columns: 'profile_id',
			references: 'profiles(id)',
			onDelete: 'CASCADE',
		},
	});
	pgm.createIndex('player_kc', 'profile_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	console.log('-> Dropping profile_id column...');
	pgm.dropConstraint('player_kc', 'player_kc_profile_id_fkey');
	pgm.dropColumn('player_kc', 'profile_id');

	// Step 4: Make the restored playerid column NOT NULL and add its FK.
	pgm.alterColumn('player_kc', 'playerid', { notNull: true });
	pgm.addConstraint('player_kc', 'player_kc_playerid_fkey', {
		foreignKeys: {
			columns: 'playerid',
			references: 'accounts(id)',
			onDelete: 'CASCADE',
		},
	});
};
