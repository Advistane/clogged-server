/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
	pgm.addColumns('player_items', {
		lastupdated: {
			type: 'TIMESTAMP WITHOUT TIME ZONE',
			notNull: true, // Assuming you want this column to always have a value
			default: pgm.func('CURRENT_TIMESTAMP'), // Use pgm.func for database functions
		},
	});

	// Create a function to update the lastupdated timestamp
	// This function will be triggered before an update on player_items
	pgm.createFunction(
		'update_player_items_timestamp', // Function name
		[], // No arguments
		{
			returns: 'TRIGGER', // Function returns a trigger
			language: 'plpgsql', // Language is PL/pgSQL
			replace: true, // Replace if function already exists
		},
		`
    BEGIN
        -- Check if the quantity column has changed
        IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
            -- Set the lastupdated column to the current timestamp
            NEW.lastupdated = CURRENT_TIMESTAMP;
        END IF;
        -- Return the new row
        RETURN NEW;
    END;
    `
	);

	pgm.createTrigger('player_items', 'set_player_items_lastupdated', {
		when: 'BEFORE',
		operation: 'UPDATE',
		level: 'ROW',
		function: {
			name: 'update_player_items_timestamp',
			args: [],
		},
	});

};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
	pgm.dropTrigger('player_items', 'set_player_items_lastupdated');

	pgm.dropFunction('update_player_items_timestamp', []);

	pgm.dropColumns('player_items', ['lastupdated']);
};
