/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.createType('groups_join_setting', ['public', 'apply', 'closed']);

	pgm.addColumn('groups', {
		joinsetting: {
			type: 'groups_join_setting',
			default: 'apply',
			notNull: true,
		},
	});
	pgm.dropColumn('groups', 'joincode');
	pgm.alterColumn('groups', 'name', {
		type: 'varchar(32)',
		notNull: true,
	})

	pgm.addConstraint('groups', 'unique_group_name', {
		unique: ['name'],
	});

	pgm.addColumn("group_members", {
		joined: {
			type: 'boolean',
			default: false,
			notNull: true,
		},
	})
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropColumn('groups', 'joinsetting');
	pgm.dropType('groups_join_setting');
	pgm.addColumn('groups', {
		joincode: {
			type: 'varchar(255)',
			notNull: false,
		},
	});
	pgm.alterColumn('groups', 'name', {
		type: 'varchar(255)',
		notNull: true,
	});
	pgm.dropConstraint('groups', 'unique_group_name');
	pgm.dropColumn("group_members", "joined");
};
