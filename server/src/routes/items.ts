import {Router} from 'express';
import {Pool} from 'pg';

// Define NPC interface
export interface Item {
	id: number;
	name: string;
}

export const createItemsRouter = (pool: Pool) => {
	const router = Router();

	// Get all items
	router.get('/', async (req, res) => {
		try {
			const result = await pool.query<Item>('SELECT * FROM items');
			res.json(result.rows);
		} catch (err) {
			console.error('Error querying items:', err);
			res.status(500).send('Server error');
		}
	});

	// Get a specific item by ID
	router.get('/id/:id', async (req, res) => {
		const itemId = parseInt(req.params.id, 10);
		if (isNaN(itemId)) {
			res.status(400).send('Invalid item ID');
			return;
		}

		try {
			const result = await pool.query<Item>('SELECT * FROM items WHERE id = $1', [itemId]);
			if (result.rows.length === 0) {
				res.status(404).send('Item not found' + itemId);
			} else {
				res.json(result.rows[0]);
			}
		} catch (err) {
			console.error('Error querying items:', err);
			res.status(500).send('Server error');
		}
	});

	router.get('/name/:name', async (req, res) => {
		const itemName = req.params.name;
		if (!itemName) {
			res.status(400).send('Invalid item name' + itemName);
			return;
		}
		try {
			const result = await pool.query<Item>('SELECT * FROM items WHERE name ilike $1', [itemName]);
			if (result.rows.length === 0) {
				res.status(404).send('Item not found' + itemName);
			} else {
				res.json(result.rows[0]);
			}
		} catch (err) {
			console.error('Error querying items:', err);
			res.status(500).send('Server error');
		}
	})

	return router;
};
