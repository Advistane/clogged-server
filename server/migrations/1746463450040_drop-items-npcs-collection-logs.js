/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.dropTable('items', {
		ifExists: true,
		cascade: true,
	});

	pgm.dropTable('npcs', {
		ifExists: true,
		cascade: true,
	});

	pgm.dropTable('collection_logs', {
		ifExists: true,
		cascade: true,
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.createTable('items', {
		id: {
			type: 'number',
			primaryKey: true,
			notNull: true,
		},
		name: {
			type: 'text',
			notNull: true,
		}
	});

	pgm.createTable('npcs', {
		id: {
			type: 'number',
			primaryKey: true,
			notNull: true,
		},
		name: {
			type: 'text',
			notNull: true,
		}
	});

	pgm.createTable('collection_logs', {
		id: {
			type: 'serial',
			primaryKey: true,
			notNull: true,
		},
		accounthash: {
			type: 'numeric',
			notNull: true,
		},
		itemid: {
			type: 'number',
			notNull: true,
		},
		subcategoryid: {
			type: 'number',
			notNull: true,
		},
	});
};
