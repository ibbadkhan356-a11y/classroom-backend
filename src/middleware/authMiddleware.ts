import { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers)
        });

        if (!session) {
            res.status(401).json({ message: "Unauthorized" });
            return;
        }

        req.user = session.user;
        next();
    } catch (error) {
        console.error("Auth Middleware Error:", error);
        res.status(500).json({ message: "Internal Server Error" });
        return;
    }
};

export const requireRole = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            res.status(403).json({ message: "Forbidden: You do not have permission to perform this action." });
            return;
        }
        next();
    };
};
