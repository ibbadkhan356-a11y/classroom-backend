import { and, eq, getTableColumns, ilike, or, sql, inArray } from "drizzle-orm";
import express from "express";
import { departments, subjects } from "../db/schema/app.js";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Protect all routes in this router
router.use(requireAuth);

// Get all departments with optional search and pagination
router.get("/", async (req, res) => {
    try {
        const { search, page = "1", limit = "10" } = req.query;
        const toSingleString = (v: unknown): string | undefined =>
            Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : undefined) : (typeof v === "string" ? v : undefined);

        const parsedPage = Number.parseInt(toSingleString(page) ?? "1", 10);
        const parsedLimit = Number.parseInt(toSingleString(limit) ?? "10", 10);

        const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limitPerPage = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 10;
        const searchTerm = toSingleString(search);

        const offset = (currentPage - 1) * limitPerPage;
        const filterConditions = [];

        if (searchTerm) {
            filterConditions.push(
                or(
                    ilike(departments.name, `%${searchTerm}%`),
                    ilike(departments.code, `%${searchTerm}%`)
                )
            );
        }

        // Role-based data scoping
        if (req.user?.role === 'teacher') {
            const { classes, subjects } = await import('../db/schema/app.js');
            const teacherClasses = await db.select({ subjectId: classes.subjectId }).from(classes).where(eq(classes.teacherId, req.user.id));
            const subjectIds = teacherClasses.map(c => c.subjectId).filter(Boolean) as number[];
            
            if (subjectIds.length > 0) {
                const taughtSubjects = await db.select({ departmentId: subjects.departmentId }).from(subjects).where(inArray(subjects.id, subjectIds));
                const allowedDeptIds = taughtSubjects.map(s => s.departmentId).filter(Boolean) as number[];
                if (allowedDeptIds.length > 0) {
                    filterConditions.push(inArray(departments.id, allowedDeptIds));
                } else {
                    filterConditions.push(eq(departments.id, -1));
                }
            } else {
                filterConditions.push(eq(departments.id, -1));
            }
        }

        if (req.user?.role === 'student') {
            const { classes, enrollments, subjects } = await import('../db/schema/app.js');
            const studentClasses = await db.select({ classId: enrollments.classId }).from(enrollments).where(eq(enrollments.studentId, req.user.id));
            const classIds = studentClasses.map(e => e.classId);
            
            if (classIds.length > 0) {
                const enrolledSubjects = await db.select({ subjectId: classes.subjectId }).from(classes).where(inArray(classes.id, classIds));
                const subjectIds = enrolledSubjects.map(c => c.subjectId).filter(Boolean) as number[];
                
                if (subjectIds.length > 0) {
                    const subjList = await db.select({ departmentId: subjects.departmentId }).from(subjects).where(inArray(subjects.id, subjectIds));
                    const allowedDeptIds = subjList.map(s => s.departmentId).filter(Boolean) as number[];
                    if (allowedDeptIds.length > 0) {
                        filterConditions.push(inArray(departments.id, allowedDeptIds));
                    } else {
                        filterConditions.push(eq(departments.id, -1));
                    }
                } else {
                    filterConditions.push(eq(departments.id, -1));
                }
            } else {
                filterConditions.push(eq(departments.id, -1));
            }
        }

        const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;

        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(departments)
            .where(whereClause);

        const totalCount = countResult[0]?.count ?? 0;

        const departmentList = await db
            .select({ ...getTableColumns(departments) })
            .from(departments)
            .where(whereClause)
            .orderBy(departments.name)
            .limit(limitPerPage)
            .offset(offset);

        res.status(200).json({
            data: departmentList,
            pagination: {
                page: currentPage,
                limit: limitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitPerPage)
            }
        });

    } catch (e) {
        console.error(`Get /departments error: ${e}`);
        res.status(500).json({ error: 'failed to get departments' });
    }
});

// Get one department
router.get("/:id", async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: 'invalid id' });
        }

        const department = await db
            .select()
            .from(departments)
            .where(eq(departments.id, id))
            .limit(1);

        if (department.length === 0) {
            return res.status(404).json({ error: 'department not found' });
        }

        const relatedSubjects = await db
            .select()
            .from(subjects)
            .where(eq(subjects.departmentId, id));

        res.status(200).json({
            data: {
                ...department[0],
                subjects: relatedSubjects
            }
        });

    } catch (e) {
        console.error(`Get /departments/:id error: ${e}`);
        res.status(500).json({ error: 'failed to get department' });
    }
});

// Create a new department
router.post("/", requireRole(['admin']), async (req, res) => {
    try {
        const [created] = await db
            .insert(departments)
            .values(req.body)
            .returning({ id: departments.id });

        res.status(201).json({ data: created });
    } catch (e) {
        console.error(`Post /departments error: ${e}`);
        res.status(500).json({ error: 'failed to create department' });
    }
});

// Update department
const updateDepartment = async (req: express.Request, res: express.Response): Promise<any> => {
    try {
        const id = Number.parseInt(req.params.id as string, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: 'invalid id' });
        }

        const [updated] = await db
            .update(departments)
            .set(req.body)
            .where(eq(departments.id, id))
            .returning({ id: departments.id });

        if (!updated) {
            return res.status(404).json({ error: 'department not found' });
        }

        res.status(200).json({ data: updated });
    } catch (e) {
        console.error(`Put/Patch /departments/:id error: ${e}`);
        res.status(500).json({ error: 'failed to update department' });
    }
};

router.put("/:id", requireRole(['admin']), updateDepartment);
router.patch("/:id", requireRole(['admin']), updateDepartment);

// Delete a department
router.delete("/:id", requireRole(['admin']), async (req, res) => {
    try {
        const id = Number.parseInt(req.params.id as string, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ error: 'invalid id' });
        }

        // Check for related subjects first to provide a friendly error message
        const relatedSubjects = await db
            .select({ id: subjects.id })
            .from(subjects)
            .where(eq(subjects.departmentId, id))
            .limit(1);

        if (relatedSubjects.length > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete department. There are subjects assigned to it.' 
            });
        }

        const [deleted] = await db
            .delete(departments)
            .where(eq(departments.id, id))
            .returning({ id: departments.id });

        if (!deleted) {
            return res.status(404).json({ error: 'department not found' });
        }

        res.status(200).json({ data: deleted });
    } catch (e) {
        console.error(`Delete /departments/:id error: ${e}`);
        res.status(500).json({ error: 'failed to delete department' });
    }
});

export default router;
