import { UserDirectoryList, User } from '../users.js';

declare global {
    namespace Express {
        interface Request {
            user: {
                profile: User;
                directories: UserDirectoryList;
            };
            file?: any;
        }
    }
}

export {};

