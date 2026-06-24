import { and, eq, getTableColumns, ilike, or, sql, SQL } from "drizzle-orm";
import express from "express";
import { departments, subjects } from "../db/schema/app.js";
import { db } from "../db/index.js";
import { date } from "drizzle-orm/mysql-core";

const router = express.Router();

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
            limit: limitPerPage,
            total: totalCount,
            totalPages: Math.ceil(totalCount/limitPerPage)
        });
      



    } catch(e){
        console.error(`Get /subjects error: ${e}`);
        res.status(500).json({error: 'failed to get subjects'})

    }
})

export default router;

