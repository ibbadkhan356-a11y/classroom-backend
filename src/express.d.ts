declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role: string;
                name: string;
                email: string;
                [key: string]: any;
            }
        }
    }
}
export {};