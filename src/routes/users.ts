import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { user } from "../db/schema/auth.js";
import { db } from "../db/index.js";

const router = express.Router();

// Get all users with optional search, filter and pagination
router.get("/", async (req, res) => {
    try {
        const { search, role, page = "1", limit = "10" } = req.query;
        const toSingleString = (v: unknown): string | undefined =>
            Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : undefined) : (typeof v === "string" ? v : undefined);

        const parsedPage = Number.parseInt(toSingleString(page) ?? "1", 10);
        const parsedLimit = Number.parseInt(toSingleString(limit) ?? "10", 10);

        const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limitPerPage = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 10;
        const searchTerm = toSingleString(search);
        const roleTerm = toSingleString(role);

        const offset = (currentPage - 1) * limitPerPage;
        const filterConditions = [];

        // If search query exist, filter by user name or user email
        if (searchTerm) {
            filterConditions.push(
                or(
                    ilike(user.name, `%${searchTerm}%`),
                    ilike(user.email, `%${searchTerm}%`)
                )
            );
        }

        // If role query exist, match role exactly
        if (roleTerm) {
            filterConditions.push(
                eq(user.role, roleTerm as "student" | "teacher" | "admin")
            );
        }

        // Combine all filters using AND if any exist  
        const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;
         
        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(user)
            .where(whereClause);

        const totalCount = countResult[0]?.count ?? 0;

        const userList = await db
            .select({
                ...getTableColumns(user)
            })
            .from(user)
            .where(whereClause)
            .orderBy(desc(user.createdAt))
            .limit(limitPerPage)
            .offset(offset);

        res.status(200).json({
            data: userList,
            pagination: {
                page: currentPage,
                limit: limitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitPerPage)
            }
        });

    } catch (e) {
        console.error(`Get /users error: ${e}`);
        res.status(500).json({ error: 'failed to get users' });
    }
});

export default router;
