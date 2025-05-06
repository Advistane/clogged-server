/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.addColumns('subcategories', {
		total: {
			type: 'integer',
			notNull: true,
			default: 0,
		},
	});
	pgm.sql(`
        UPDATE subcategories
        SET total = (SELECT COUNT(*)
                     FROM subcategory_items
                     WHERE subcategory_items.subcategoryid = subcategories.id)
        WHERE total = 0;
	`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropColumns('subcategories', ['total']);
};
