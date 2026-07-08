import { and, eq, getTableColumns, ilike, or, sql, SQL, inArray } from "drizzle-orm";
import express from "express";
import { departments, subjects } from "../db/schema/app.js";
import { db } from "../db/index.js";
import { date } from "drizzle-orm/mysql-core";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

//Get all subjects with optional search, filter and pagination
router.get("/", async(req, res)=> {
    try{
        const { search, department, page = "1", limit = "10" } = req.query;
        const toSingleString = (v: unknown): string | undefined =>
            Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : undefined) : (typeof v === "string" ? v : undefined);

        const parsedPage = Number.parseInt(toSingleString(page) ?? "1", 10);
        const parsedLimit = Number.parseInt(toSingleString(limit) ?? "10", 10);

        const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
        const limitPerPage = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100): 10;
        const searchTerm = toSingleString(search);
        const departmentTerm = toSingleString(department);

        const offset = (currentPage - 1) * limitPerPage;
        const filterConditions = [];

        //If search query exist, filter by subject name or subject code

        if (searchTerm) {
            filterConditions.push(
                or(
                    ilike(subjects.name, `%${searchTerm}%`),
                    ilike(subjects.code, `%${searchTerm}%`)
                )
            );
        }

        //If department query exist, match department name
        if (departmentTerm) {
            filterConditions.push(
                    ilike(departments.name, `%${departmentTerm}%`));  
        }

        // Role-based data scoping
        if (req.user?.role === 'teacher') {
            const { classes } = await import('../db/schema/app.js');
            const teacherClasses = await db.select({ subjectId: classes.subjectId }).from(classes).where(eq(classes.teacherId, req.user.id));
            const allowedSubjectIds = teacherClasses.map(c => c.subjectId).filter(Boolean) as number[];
            if (allowedSubjectIds.length > 0) {
                filterConditions.push(inArray(subjects.id, allowedSubjectIds));
            } else {
                filterConditions.push(eq(subjects.id, -1));
            }
        }

        if (req.user?.role === 'student') {
            const { classes, enrollments } = await import('../db/schema/app.js');
            const studentClasses = await db.select({ classId: enrollments.classId }).from(enrollments).where(eq(enrollments.studentId, req.user.id));
            const classIds = studentClasses.map(e => e.classId);
            if (classIds.length > 0) {
                const allowedSubjects = await db.select({ subjectId: classes.subjectId }).from(classes).where(inArray(classes.id, classIds));
                const allowedSubjectIds = allowedSubjects.map(c => c.subjectId).filter(Boolean) as number[];
                if (allowedSubjectIds.length > 0) {
                    filterConditions.push(inArray(subjects.id, allowedSubjectIds));
                } else {
                    filterConditions.push(eq(subjects.id, -1));
                }
            } else {
                filterConditions.push(eq(subjects.id, -1));
            }
        }

          // Combine all filters using AND if any exist  
          const whereClause = filterConditions.length > 0 ? and(...filterConditions) : undefined;
         
          const countResult = await db
             .select({count: sql<number>`count(*)`})
             .from(subjects)
             .leftJoin(departments, eq(subjects.departmentId, departments.id))
             .where(whereClause);

          const totalCount = countResult[0]?.count ?? 0;

          const subjectList = await db
          .select({
            ...getTableColumns(subjects), 
            department: { ...getTableColumns(departments) }
          }).from(subjects).leftJoin(departments, eq(subjects.departmentId, departments.id))
          .where(whereClause)
          .orderBy(subjects.name)
          .limit(limitPerPage)
          .offset(offset);

    
 
        res.status(200).json({
            data: subjectList,
            pagination: {
                page: currentPage,
                limit: limitPerPage,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitPerPage)
            }
        });
      



    } catch(e){
        console.error(`Get /subjects error: ${e}`);
        res.status(500).json({error: 'failed to get subjects'})
    }
});

// Get a single subject by ID
router.get("/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const [subject] = await db
            .select({
                ...getTableColumns(subjects),
                department: { ...getTableColumns(departments) }
            })
            .from(subjects)
            .leftJoin(departments, eq(subjects.departmentId, departments.id))
            .where(eq(subjects.id, id));

        if (!subject) return res.status(404).json({ error: 'Subject not found' });

        res.status(200).json({ data: subject });
    } catch (e) {
        console.error(`GET /subjects/:id error:`, e);
        res.status(500).json({ error: 'Failed to fetch subject' });
    }
});

// Create a new subject
router.post("/", requireRole(['admin']), async (req, res) => {
    try {
        const { code, name, description, departmentId } = req.body;

        if (!code || !name || !departmentId) {
            return res.status(400).json({ error: 'Code, name, and departmentId are required' });
        }

        const [createdSubject] = await db
            .insert(subjects)
            .values({
                code,
                name,
                description,
                departmentId: parseInt(departmentId, 10)
            })
            .returning({ id: subjects.id });

        res.status(201).json({ data: createdSubject });
    } catch (e: any) {
        console.error(`POST /subjects error:`, e);
        if (e.code === '23505') {
            return res.status(400).json({ error: 'A subject with this code already exists' });
        }
        res.status(500).json({ error: 'Failed to create subject' });
    }
});

// Update a subject
const updateHandler = async (req: express.Request, res: express.Response) => {
    try {
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const { code, name, description, departmentId } = req.body;

        const [updatedSubject] = await db
            .update(subjects)
            .set({
                code,
                name,
                description,
                departmentId: departmentId ? parseInt(departmentId, 10) : undefined,
                updatedAt: new Date()
            })
            .where(eq(subjects.id, id))
            .returning({ id: subjects.id });

        if (!updatedSubject) return res.status(404).json({ error: 'Subject not found' });

        res.status(200).json({ data: updatedSubject });
    } catch (e: any) {
        console.error(`PUT/PATCH /subjects/:id error:`, e);
        if (e.code === '23505') {
            return res.status(400).json({ error: 'A subject with this code already exists' });
        }
        res.status(500).json({ error: 'Failed to update subject' });
    }
};

router.put("/:id", requireRole(['admin']), updateHandler);
router.patch("/:id", requireRole(['admin']), updateHandler);

// Delete a subject
router.delete("/:id", requireRole(['admin']), async (req, res) => {
    try {
        const id = parseInt(req.params.id as string);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // SAFETY RESTRICTION: Check if there are related classes
        const { classes } = await import('../db/schema/app.js');
        const relatedClasses = await db.select().from(classes).where(eq(classes.subjectId, id));

        if (relatedClasses.length > 0) {
            return res.status(400).json({ error: 'Cannot delete subject that has assigned classes. Please reassign or delete the classes first.' });
        }

        const [deletedSubject] = await db
            .delete(subjects)
            .where(eq(subjects.id, id))
            .returning({ id: subjects.id });

        if (!deletedSubject) return res.status(404).json({ error: 'Subject not found' });

        res.status(200).json({ data: deletedSubject });
    } catch (e) {
        console.error(`DELETE /subjects/:id error:`, e);
        res.status(500).json({ error: 'Failed to delete subject' });
    }
});

export default router;

