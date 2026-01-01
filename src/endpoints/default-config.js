import express from 'express';
import storage from 'node-persist';

import { requireAdminMiddleware, normalizeHandle, getUserDirectories, toKey } from '../users.js';
import {
    getDefaultTemplateInfo,
    snapshotDefaultTemplateFromUser,
    clearDefaultTemplate,
    listDefaultTemplateCategories,
} from '../default-template.js';

export const router = express.Router();

router.get('/status', requireAdminMiddleware, (_request, response) => {
    return response.json(getDefaultTemplateInfo());
});

router.get('/categories', requireAdminMiddleware, (_request, response) => {
    return response.json({ categories: listDefaultTemplateCategories() });
});

router.post('/snapshot', requireAdminMiddleware, async (request, response) => {
    try {
        const { handle, categories } = request.body || {};

        if (!handle) {
            return response.status(400).json({ error: 'Missing user handle' });
        }

        const normalizedHandle = normalizeHandle(handle);
        if (!normalizedHandle) {
            return response.status(400).json({ error: 'Invalid handle format' });
        }

        const user = await storage.getItem(toKey(normalizedHandle));
        if (!user) {
            return response.status(404).json({ error: 'User not found' });
        }

        const directories = getUserDirectories(normalizedHandle);
        const result = snapshotDefaultTemplateFromUser(directories, normalizedHandle, categories);

        return response.json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Default template snapshot failed:', error);
        return response.status(500).json({ error: 'Failed to create default template' });
    }
});

router.post('/clear', requireAdminMiddleware, (_request, response) => {
    try {
        clearDefaultTemplate();
        return response.json({ success: true });
    } catch (error) {
        console.error('Default template clear failed:', error);
        return response.status(500).json({ error: 'Failed to clear default template' });
    }
});
