/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	// Drop foreign key constraints referencing players.accounthash
	pgm.dropConstraint('player_items', 'player_items_accounthash_fkey');
	pgm.dropConstraint('player_kc', 'player_kc_accounthash_fkey');
	pgm.dropConstraint('group_members', 'group_members_accounthash_fkey');

	// Create new column for players table
	pgm.addColumns('players', {
		id: {
			type: 'uuid',
			notNull: true,
			default: pgm.func('gen_random_uuid()'),
		},
	});
	pgm.dropConstraint('players', 'players_pkey');
	pgm.addConstraint('players', 'players_id_pkey', {
		primaryKey: 'id',
	});

	pgm.addConstraint('players', 'players_accounthash_unique', {
		unique: 'accounthash',
	});

	pgm.addColumns('player_items', {
		playerid: {
			type: 'uuid',
		},
	});

	pgm.sql(`
        UPDATE player_items
        SET playerid = p.id
        FROM players p
        WHERE player_items.accounthash = p.accounthash
	`);
	pgm.alterColumn('player_items', 'playerid', {notNull: true});
	pgm.addConstraint('player_items', 'player_items_playerid_fkey', {
		foreignKeys: {
			columns: 'playerid',
			references: 'players(id)',
		},
	});
	pgm.dropColumns('player_items', ['accounthash']);

	pgm.addColumns('player_kc', {
		playerid: {
			type: 'uuid',
		},
	});
	pgm.sql(`
        UPDATE player_kc
        SET playerid = p.id
        FROM players p
        WHERE player_kc.accounthash = p.accounthash
	`);
	pgm.alterColumn('player_kc', 'playerid', {notNull: true});
	pgm.addConstraint('player_kc', 'player_kc_playerid_fkey', {
		foreignKeys: {
			columns: 'playerid',
			references: 'players(id)',
		},
	});
	pgm.dropColumns('player_kc', ['accounthash']);

	pgm.addColumns('group_members', {
		playerid: {
			type: 'uuid',
			notNull: true
		},
	});

	pgm.sql(`
        UPDATE group_members
        SET playerid = p.id
        FROM players p
        WHERE group_members.accounthash = p.accounthash
	`);

	pgm.dropColumns('group_members', ['accounthash']);
	pgm.addConstraint('group_members', 'group_members_playerid_fkey', {
		foreignKeys: {
			columns: 'playerid',
			references: 'players(id)',
		},
	});
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	// ======================================================================
	// STEP 1: REVERT DEPENDENT TABLES
	// ----------------------------------------------------------------------
	// Revert player_items table
	pgm.dropConstraint('player_items', 'player_items_playerid_fkey');
	pgm.addColumns('player_items', { accounthash: { type: 'numeric' } }); // Assuming original type was numeric
	pgm.sql(`
  UPDATE player_items pi
  SET accounthash = p.accounthash
  FROM players p
  WHERE pi.playerid = p.id;
  `);
	pgm.alterColumn('player_items', 'accounthash', { notNull: true }); //Or keep the old nullability
	pgm.dropColumns('player_items', ['playerid']);
	pgm.addConstraint('player_items', 'player_items_accounthash_fkey', {
		foreignKeys: {
			columns: 'accounthash',
			references: 'players(accounthash)',
		},
	});

	// Revert player_kc table
	pgm.dropConstraint('player_kc', 'player_kc_playerid_fkey');
	pgm.addColumns('player_kc', { accounthash: { type: 'numeric' } }); // Assuming original type was numeric
	pgm.sql(`
  UPDATE player_kc pk
  SET accounthash = p.accounthash
  FROM players p
  WHERE pk.playerid = p.id
  `);
	pgm.alterColumn('player_kc', 'accounthash', { notNull: true });  //Or keep the old nullability

	pgm.dropColumns('player_kc', ['playerid']);
	pgm.addConstraint('player_kc', 'player_kc_accounthash_fkey', {
		foreignKeys: {
			columns: 'accounthash',
			references: 'players(accounthash)',
		},
	});


	//Revert group_members
	pgm.dropConstraint('group_members', 'group_members_playerid_fkey');
	pgm.addColumns('group_members', { accounthash: { type: 'numeric', notNull:true } });
	pgm.sql(`
        UPDATE group_members gm
        SET accounthash = p.accounthash
        FROM players p
        WHERE gm.playerid = p.id;
    `);
	pgm.dropColumns('group_members', ['playerid']);
	pgm.addConstraint('group_members', 'group_members_accounthash_fkey', {
		foreignKeys: {
			columns: 'accounthash',
			references: 'players(accounthash)',
		},
	});


	// ======================================================================
	// STEP 2: REVERT THE 'players' TABLE
	// ----------------------------------------------------------------------
	// Drop unique constraint on accounthash
	pgm.dropConstraint('players', 'players_accounthash_unique');
	// Drop primary key on id
	pgm.dropConstraint('players', 'players_id_pkey');
	// Add primary key back to accounthash
	pgm.addConstraint('players', 'players_pkey', {
		primaryKey: 'accounthash',
	});
	// Drop the new id column
	pgm.dropColumns('players', ['id']);
};
