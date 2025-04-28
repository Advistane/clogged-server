import { Router } from 'express';
import { Pool } from 'pg';

// Define NPC interface
export interface NPC {
  id: number;
  name: string;
}

export const createNpcsRouter = (pool: Pool) => {
  const router = Router();

  // Get all NPCs
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query<NPC>('SELECT * FROM npcs');
      res.json(result.rows);
    } catch (err) {
      console.error('Error querying NPCs:', err);
      res.status(500).send('Server error');
    }
  });

  // Get a specific NPC by ID
  router.get('/:id', async (req, res) => {
    const npcId = parseInt(req.params.id, 10);
    if (isNaN(npcId)) {
      res.status(400).send('Invalid NPC ID');
      return;
    }

    try {
      const result = await pool.query<NPC>('SELECT * FROM npcs WHERE id = $1', [npcId]);
      if (result.rows.length === 0) {
        res.status(404).send('NPC not found');
      } else {
        res.json(result.rows[0]);
      }
    } catch (err) {
      console.error('Error querying NPC:', err);
      res.status(500).send('Server error');
    }
  });

  return router;
};
