import { Router } from 'express';
import { uploadImage } from '../controllers/uploadController';

const router = Router();

router.post('/upload', uploadImage);

export default router;
