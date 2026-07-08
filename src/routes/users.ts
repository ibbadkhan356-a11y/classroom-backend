import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { user } from "../db/schema/auth.js";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

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

        // Check role permissions
        if (req.user?.role === 'student') {
            return res.status(403).json({ error: 'Forbidden: Students do not have permission to view users list.' });
        }

        let roleFilterValue = roleTerm;
        if (req.user?.role === 'teacher') {
            roleFilterValue = 'student';
        }

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
        if (roleFilterValue) {
            filterConditions.push(
                eq(user.role, roleFilterValue as "student" | "teacher" | "admin")
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

// Get user by id
router.get("/:id", async (req, res) => {
    try {
        const [foundUser] = await db.select().from(user).where(eq(user.id, req.params.id));
        if (!foundUser) return res.status(404).json({ error: 'User not found' });
        res.status(200).json({ data: foundUser });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Create user
import { auth } from '../lib/auth.js';

router.post("/", requireRole(['admin']), async (req, res) => {
    try {
        const { name, email, role, imageCldPubId } = req.body;
        const password = req.body.password || 'Welcome123!';
        
        const response = await auth.api.signUpEmail({
            body: { email, password, name, role, imageCldPubId },
            headers: new Headers()
        });

        res.status(201).json({ data: response?.user });
    } catch (e: any) {
        console.error('Create user error', e);
        if (e?.body?.message) {
            return res.status(400).json({ error: e.body.message });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
const updateHandler = async (req: express.Request, res: express.Response) => {
    try {
        const id = req.params.id as string;
        // Don't update password through this route
        const { password, ...updateData } = req.body;

        const [updatedUser] = await db
            .update(user)
            .set({ ...updateData, updatedAt: new Date() })
            .where(eq(user.id, id))
            .returning();
            
        if (!updatedUser) return res.status(404).json({ error: 'User not found' });
        res.status(200).json({ data: updatedUser });
    } catch (e: any) {
        console.error('Update user error:', e);
        if (e.code === '23505') return res.status(400).json({ error: 'Email already exists' });
        res.status(500).json({ error: 'Failed to update user' });
    }
};

router.put("/:id", requireRole(['admin']), updateHandler);
router.patch("/:id", requireRole(['admin']), updateHandler);

// Delete user
router.delete("/:id", requireRole(['admin']), async (req, res) => {
    try {
        const id = req.params.id as string;
        const [deletedUser] = await db.delete(user).where(eq(user.id, id)).returning();
        
        if (!deletedUser) return res.status(404).json({ error: 'User not found' });
        res.status(200).json({ data: deletedUser });
    } catch (e) {
        console.error('Delete user error:', e);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

export default router;
