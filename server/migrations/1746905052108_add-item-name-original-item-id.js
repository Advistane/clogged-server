/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.addColumns('subcategory_items', {
		itemname: {
			type: 'text',
			notNull: false,
			default: null,
		},
		originalitemid: {
			type: 'integer',
			notNull: false,
			default: null,
		}
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropColumns('subcategory_items', ['itemname', 'originalitemid']);
};
