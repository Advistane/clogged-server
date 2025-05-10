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
	pgm.addColumns('subcategory_items', {
		image_url: {
			type: 'text',
			notNull: false,
			default: null,
		},
	});

	pgm.addColumns('players', {
		profile_visible_on_website: {
			type: 'boolean',
			notNull: true,
			default: false,
		},
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropColumns('subcategory_items', ['image_url']);
	pgm.dropColumns('players', ['profile_visible_on_website']);
};
