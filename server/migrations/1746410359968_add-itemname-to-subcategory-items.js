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
			notNull: true,
			default: '',
		},
	});

	pgm.sql(`
        UPDATE subcategory_items
        SET itemname = (SELECT name
                         FROM items
                         WHERE items.id = subcategory_items.itemid)
	`);

	pgm.dropConstraint('subcategory_items', 'subcategory_items_itemid_fkey');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.addConstraint('subcategory_items', 'subcategory_items_itemid_fkey', {
		foreignKeys: {
			columns: 'itemid',
			references: 'items(id)',
		},
	});

	pgm.dropColumns('subcategory_items', ['itemname']);
};
