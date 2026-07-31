import { Router } from 'express';
import { validate } from '../middleware/validate';
import {
  exportAutomobiles,
  getAutomobileById,
  listAutomobiles,
  searchAutomobiles,
} from '../controllers/automobile.controller';
import { exportQuerySchema, idParamSchema, searchQuerySchema } from '../models/automobile.model';

export const automobileRouter = Router();

// Static segments must be registered before the `/:id` catch-all. `/` and `/search` share the
// same schema and handler — see the doc comment on `listAutomobiles`.
automobileRouter.get('/search', validate({ query: searchQuerySchema }), searchAutomobiles);
automobileRouter.get('/export', validate({ query: exportQuerySchema }), exportAutomobiles);
automobileRouter.get('/:id', validate({ params: idParamSchema }), getAutomobileById);
automobileRouter.get('/', validate({ query: searchQuerySchema }), listAutomobiles);
