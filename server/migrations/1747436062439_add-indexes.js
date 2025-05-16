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
	pgm.sql(`
        CREATE INDEX idx_subcategories_categoryid ON subcategories (categoryid);
	`);

	pgm.sql(`
        CREATE INDEX idx_subcategory_items_subcategoryid ON subcategory_items (subcategoryid);
	`);

	pgm.sql(`
        CREATE INDEX idx_player_items_playerid ON player_items (playerid);
	`);

	pgm.sql(`
        CREATE INDEX idx_subcategory_items_itemid ON subcategory_items (itemid);
	`);

	pgm.sql(`
        CREATE INDEX idx_player_items_itemid ON player_items (itemid);
	`);

	pgm.sql(`
        CREATE INDEX idx_player_kc_playerid_subcategoryid ON player_kc (playerid, subcategoryid);
	`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.sql(`
        DROP INDEX idx_subcategories_categoryid;
	`);

	pgm.sql(`
        DROP INDEX idx_subcategory_items_subcategoryid;
	`);

	pgm.sql(`
        DROP INDEX idx_player_items_playerid;
	`);

	pgm.sql(`
        DROP INDEX idx_subcategory_items_itemid;
	`);

	pgm.sql(`
        DROP INDEX idx_player_items_itemid;
	`);

	pgm.sql(`
        DROP INDEX idx_player_kc_playerid_subcategoryid;
	`);
};
