import express from "express";
import { and, desc, eq, getTableColumns, ilike, or, sql, inArray } from "drizzle-orm";

import { db } from "../db/index.js";
import { classes, departments, subjects } from '../db/schema/app.js'
import { user } from '../db/schema/auth.js'
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

// Get all classes with optional search, filtering and pagination
router.get("/", async (req, res) => {
    try {
        const { search, subject, subjectId, teacher, page = 1, limit = 10 } = req.query;

        const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
        const limitPerPage = Math.min(Math.max(1, parseInt(String(limit), 10) || 10), 100); // Max 100 records per page

        const offset = (currentPage - 1) * limitPerPage;

        const filterConditions = [];

        // If search query exists, filter by class name OR invite code
        if (search) {
            filterConditions.push(
                or(
                    ilike(classes.name, `%${search}%`),
                    ilike(classes.inviteCode, `%${search}%`)
                )
            );
        }

        // If subject filter exists, match subject name
        if (subject) {
            const subjectPattern = `%${String(subject).replace(/[%_]/g, '\\$&')}%`;
            filterConditions.push(ilike(subjects.name, subjectPattern));
        }

        // If subjectId filter exists, match exact subjectId
        if (subjectId) {
            filterConditions.push(eq(classes.subjectId, parseInt(String(subjectId), 10)));
        }

        // If teacher filter exists, match teacher name
        if (teacher) {
            const teacherPattern = `%${String(teacher).replace(/[%_]/g, '\\$&')}%`;
            filterConditions.push(ilike(user.name, teacherPattern));
        }

        // Data Scoping: If user is a teacher, force filter by their own teacherId
        if (req.user?.role === 'teacher') {
            filterConditions.push(eq(classes.teacherId, req.user.id));
        }

        // Data Scoping: If user is a student, force filter by their enrollments
        if (req.user?.role === 'student') {
            const { enrollments } = await import('../db/schema/app.js');
            const studentEnrollments = await db.select({ classId: enrollments.classId })
                .from(enrollments)
                .where(eq(enrollments.studentId, req.user.id));
            
            const enrolledClassIds = studentEnrollments.map(e => e.classId);
            
            if (enrolledClassIds.length > 0) {
                filterConditions.push(inArray(classes.id, enrolledClassIds));
            } else {
                // Return an impossible condition so they get no classes
                filterConditions.push(eq(classes.id, -1)); 
            }
        }

        // Combine all filters using AND if any exist
        const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;

        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(classes)
            .leftJoin(subjects, eq(classes.subjectId, subjects.id))
            .leftJoin(user, eq(classes.teacherId, user.id))
            .where(whereClause);

        const totalCount = countResult[0]?.count ?? 0;

        const classesList = await db
            .select({
                ...getTableColumns(classes),
                subject: { ...getTableColumns(subjects) },
                teacher: { ...getTableColumns(user) }
            })
            .from(classes)
            .leftJoin(subjects, eq(classes.subjectId, subjects.id))
            .leftJoin(user, eq(classes.teacherId, user.id))
            .where(whereClause)
            .orderBy(desc(classes.createdAt))
            .limit(limitPerPage)
            .offset(offset);

        res.status(200).json({
            data: classesList,
            pagination: {
                page: currentPage,
                limit: limitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitPerPage),
            }
        })

    } catch (e) {
        console.error(`GET /classes error: ${e}`);
        res.status(500).json({ error: 'Failed to get classes' });
    }
})

// Get class details with teacher, subject, and department
router.get('/:id', async (req, res) => {
    const classId = Number(req.params.id);

    if (!Number.isFinite(classId)) return res.status(400).json({ error: 'No Class found.' });

    // Enforce scoping checks for teacher and student
    if (req.user?.role === 'teacher') {
        const [classToCheck] = await db.select({ teacherId: classes.teacherId }).from(classes).where(eq(classes.id, classId));
        if (!classToCheck || classToCheck.teacherId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied.' });
        }
    } else if (req.user?.role === 'student') {
        const { enrollments } = await import('../db/schema/app.js');
        const [enrollment] = await db.select({ id: enrollments.id })
            .from(enrollments)
            .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, req.user.id)));
        
        if (!enrollment) {
            return res.status(403).json({ error: 'Access denied.' });
        }
    }

    const [classDetails] = await db
        .select({
            ...getTableColumns(classes),
            subject: {
                ...getTableColumns(subjects),
            },
            department: {
                ...getTableColumns(departments),
            },
            teacher: {
                ...getTableColumns(user),
            }
        })
        .from(classes)
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .leftJoin(user, eq(classes.teacherId, user.id))
        .leftJoin(departments, eq(subjects.departmentId, departments.id))
        .where(eq(classes.id, classId))

    if (!classDetails) return res.status(404).json({ error: 'No Class found.' });

    res.status(200).json({ data: classDetails });
})

router.post('/', requireRole(['admin', 'teacher']), async (req, res) => {
    try {
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Force teacherId to be the logged in user if they are a teacher
        const body = { ...req.body };
        if (req.user?.role === 'teacher') {
            body.teacherId = req.user.id;
        }

        const [createdClass] = await db
            .insert(classes)
            .values({ ...body, inviteCode, schedules: [] })
            .returning({ id: classes.id });

        if (!createdClass) throw Error;

        res.status(201).json({ data: createdClass });
    } catch (e) {
        console.error(`POST /classes error ${e}`);
        res.status(500).json({ error: e })
    }
})

const updateHandler = async (req: express.Request, res: express.Response) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Scoping Check: Teachers can only edit their own classes
        if (req.user?.role === 'teacher') {
            const [classToUpdate] = await db.select().from(classes).where(eq(classes.id, id));
            if (!classToUpdate || classToUpdate.teacherId !== req.user.id) {
                return res.status(403).json({ error: "You can only edit your own classes." });
            }
        }

        // Prevent teachers from transferring class ownership
        const body = { ...req.body };
        if (req.user?.role === 'teacher') {
            delete body.teacherId;
        }

        const [updatedClass] = await db
            .update(classes)
            .set({
                ...body,
                updatedAt: new Date()
            })
            .where(eq(classes.id, id))
            .returning({ id: classes.id });

        if (!updatedClass) return res.status(404).json({ error: 'Class not found' });

        res.status(200).json({ data: updatedClass });
    } catch (e: any) {
        console.error(`PUT/PATCH /classes/:id error:`, e);
        if (e.code === '23505') {
            return res.status(400).json({ error: 'A class with this invite code already exists' });
        }
        res.status(500).json({ error: 'Failed to update class' });
    }
};

router.put("/:id", requireRole(['admin', 'teacher']), updateHandler);
router.patch("/:id", requireRole(['admin', 'teacher']), updateHandler);

// Delete a class (Admin only)
router.delete("/:id", requireRole(['admin']), async (req, res) => {
    try {
        const id = parseInt(req.params.id as string, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // SAFETY RESTRICTION: Check if there are related enrollments
        const { enrollments } = await import('../db/schema/app.js');
        const relatedEnrollments = await db.select().from(enrollments).where(eq(enrollments.classId, id));

        if (relatedEnrollments.length > 0) {
            return res.status(400).json({ error: 'Cannot delete class that has enrolled students. Please remove the students first.' });
        }

        const [deletedClass] = await db
            .delete(classes)
            .where(eq(classes.id, id))
            .returning({ id: classes.id });

        if (!deletedClass) return res.status(404).json({ error: 'Class not found' });

        res.status(200).json({ data: deletedClass });
    } catch (e) {
        console.error(`DELETE /classes/:id error:`, e);
        res.status(500).json({ error: 'Failed to delete class' });
    }
});

export default router;