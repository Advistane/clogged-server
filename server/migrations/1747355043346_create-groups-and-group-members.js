/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.createTable('groups', {
		id: {
			type: 'uuid',
			primaryKey: true,
			default: pgm.func('gen_random_uuid()'),
		},
		name: {type: 'varchar(255)', notNull: true},
		description: {type: 'text'},
		ownerkey: {
			type: 'text',
			notNull: true,
		},
		joincode: {
			type: 'text',
			notNull: true,
			unique: true,
		},
		created_at: {type: 'timestamp', default: pgm.func('current_timestamp')},
		updated_at: {type: 'timestamp', default: pgm.func('current_timestamp')},
	});

	pgm.createTable('group_members', {
		id: {
			type: 'uuid',
			primaryKey: true,
			default: pgm.func('gen_random_uuid()'),
		},
		groupid: {
			type: 'uuid',
			references: 'groups',
			notNull: true,
		},
		accounthash: {
			type: 'numeric',
			references: 'players',
			notNull: true,
		},
		joined_at: {type: 'timestamp', default: pgm.func('current_timestamp')},
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropTable('group_members');
	pgm.dropTable('groups');
};
