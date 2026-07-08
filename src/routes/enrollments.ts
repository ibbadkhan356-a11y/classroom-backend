import express from 'express';
import { db } from '../db/index.js';
import { enrollments, classes } from '../db/schema/app.js';
import { user } from '../db/schema/auth.js';
import { eq, and, desc, count, ilike } from 'drizzle-orm';
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

// Get enrollments (filtered by classId or studentId)
router.get("/", async (req, res) => {
    try {
        const { _start, _end, _sort, _order, classId, studentId } = req.query;

        const start = _start ? parseInt(_start as string, 10) : 0;
        const end = _end ? parseInt(_end as string, 10) : 10;
        const limit = end - start;

        const sortField = _sort ? (_sort as string) : "createdAt";
        const orderDirection = _order === "asc" ? "asc" : "desc";

        const conditions = [];

        if (classId) {
            conditions.push(eq(enrollments.classId, parseInt(classId as string, 10)));
        }

        if (studentId) {
            conditions.push(eq(enrollments.studentId, studentId as string));
        }

        const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

        const dataQuery = db
            .select({
                enrollment: enrollments,
                student: user,
            })
            .from(enrollments)
            .leftJoin(user, eq(enrollments.studentId, user.id))
            .where(whereCondition)
            .limit(limit)
            .offset(start);

        // Sorting
        if (sortField === "createdAt") {
             dataQuery.orderBy(desc(enrollments.createdAt));
        } else {
             dataQuery.orderBy(desc(enrollments.id));
        }

        const rawData = await dataQuery;
        
        // Map data to match standard Refine flat structure
        const data = rawData.map((row) => ({
            ...row.enrollment,
            student: row.student,
        }));

        const totalQuery = await db
            .select({ count: count() })
            .from(enrollments)
            .where(whereCondition);

        const total = totalQuery[0]?.count || 0;

        res.set("x-total-count", total.toString());
        res.status(200).json({ data, total });
    } catch (e) {
        console.error("GET /enrollments error:", e);
        res.status(500).json({ error: "Failed to fetch enrollments" });
    }
});

// Enroll a student
router.post("/", async (req, res) => {
    try {
        const { classId, studentId } = req.body;

        if (!classId || !studentId) {
            return res.status(400).json({ error: 'classId and studentId are required' });
        }

        const [newEnrollment] = await db
            .insert(enrollments)
            .values({
                classId: parseInt(classId, 10),
                studentId,
            })
            .returning();

        res.status(201).json({ data: newEnrollment });
    } catch (e: any) {
        console.error("POST /enrollments error:", e);
        if (e.code === '23505') { // Postgres Unique Violation
            return res.status(400).json({ error: 'Student is already enrolled in this class' });
        }
        res.status(500).json({ error: "Failed to create enrollment" });
    }
});
// Join a class using an invite code
router.post("/join", async (req, res) => {
    try {
        const { inviteCode, studentId } = req.body;

        if (!inviteCode || !studentId) {
            return res.status(400).json({ error: 'inviteCode and studentId are required' });
        }

        // Find class by invite code
        const targetClassRes = await db
            .select({ id: classes.id })
            .from(classes)
            .where(ilike(classes.inviteCode, inviteCode))
            .limit(1);

        const targetClass = targetClassRes[0];

        if (!targetClass) {
            return res.status(404).json({ error: 'Invalid invite code' });
        }

        // Enroll the student
        const [newEnrollment] = await db
            .insert(enrollments)
            .values({
                classId: targetClass.id,
                studentId,
            })
            .returning();

        res.status(201).json({ data: newEnrollment });
    } catch (e: any) {
        console.error("POST /enrollments/join error:", e);
        if (e.code === '23505') { // Postgres Unique Violation
            return res.status(400).json({ error: 'Student is already enrolled in this class' });
        }
        res.status(500).json({ error: "Failed to join class" });
    }
});
// Delete an enrollment
router.delete("/:id", requireRole(['admin', 'teacher']), async (req, res) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const [deletedEnrollment] = await db
            .delete(enrollments)
            .where(eq(enrollments.id, id))
            .returning({ id: enrollments.id });

        if (!deletedEnrollment) {
            return res.status(404).json({ error: 'Enrollment not found' });
        }

        res.status(200).json({ data: deletedEnrollment });
    } catch (e) {
        console.error("DELETE /enrollments/:id error:", e);
        res.status(500).json({ error: "Failed to delete enrollment" });
    }
});

export default router;
