/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.createTable('profiles', {
		id: {
			type: 'uuid',
			primaryKey: true,
			default: pgm.func('gen_random_uuid()'),
		},
		player_id: {
			type: 'uuid',
			notNull: true,
			references: 'players',
			onDelete: 'CASCADE',
		},
		game_mode: {
			type: 'text',
			notNull: true,
		},
		created_at: {
			type: 'timestamp with time zone',
			notNull: true,
			default: pgm.func('current_timestamp'),
		},
		updated_at: {
			type: 'timestamp with time zone',
			notNull: true,
			default: pgm.func('current_timestamp'),
		},
	});

	pgm.addConstraint(
		'profiles',
		'profiles_player_id_game_mode_key',
		'UNIQUE (player_id, game_mode)'
	);

	pgm.createIndex('profiles', 'player_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropTable('profiles');
	pgm.dropType('game_mode_enum');
};
