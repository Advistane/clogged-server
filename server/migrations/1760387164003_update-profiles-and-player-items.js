/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	console.log('-> Populating profiles table from existing accounts...');
	pgm.sql(`
        INSERT INTO profiles (player_id, game_mode)
        SELECT id, 'STANDARD'
        FROM players;
	`);

	console.log('-> Adding profile_id column to player_items...');
	pgm.addColumn('player_items', {
		profile_id: {type: 'uuid', notNull: false}, // Initially allow nulls
	});

	console.log('-> Populating the new profile_id column...');
	pgm.sql(`
        UPDATE player_items
        SET profile_id = profiles.id
        FROM profiles
        WHERE player_items.playerid = profiles.player_id
          AND profiles.game_mode = 'STANDARD';
	`);

	console.log('-> Setting NOT NULL and adding foreign key to profile_id...');
	pgm.alterColumn('player_items', 'profile_id', {notNull: true});
	pgm.addConstraint('player_items', 'player_items_profile_id_fkey', {
		foreignKeys: {
			columns: 'profile_id',
			references: 'profiles(id)',
			onDelete: 'CASCADE',
		},
	});
	pgm.createIndex('player_items', 'profile_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	console.log('-> Dropping profile_id column...');
	pgm.dropConstraint('player_items', 'player_items_profile_id_fkey');
	pgm.dropColumn('player_items', 'profile_id');

	pgm.alterColumn('player_items', 'player_id', { notNull: true });
	pgm.addConstraint('player_items', 'player_items_player_id_fkey', {
		foreignKeys: {
			columns: 'player_id',
			references: 'accounts(id)',
			onDelete: 'CASCADE',
		},
	});

	console.log('-> Dropping profiles table and game_mode_enum...');
	pgm.dropTable('profiles');
	pgm.dropType('game_mode_enum');
};
