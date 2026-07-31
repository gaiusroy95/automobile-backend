import { Router } from 'express';
import { automobileRouter } from './automobile.routes';
import { healthRouter } from './health.routes';

export const router = Router();

router.use('/health', healthRouter);
router.use('/cars', automobileRouter);

// Mount additional feature routers here, e.g.:
// router.use('/users', usersRouter);
