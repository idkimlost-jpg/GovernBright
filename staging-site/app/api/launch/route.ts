import { randomUUID } from "node:crypto";
import { and,eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { approvedUsers,launchEvents,toolRequests } from "../../../db/schema";
import { accessFor,routeError } from "../../../lib/access";
const destination="https://chatgpt.com/";
export async function POST(r:Request){try{const access=await accessFor(r),db=getDb(),now=new Date().toISOString(),requests=await db.select().from(toolRequests).where(and(eq(toolRequests.organizationId,access.organizationId),eq(toolRequests.requesterUserId,access.viewer.userId),eq(toolRequests.toolKey,"chatgpt"),eq(toolRequests.status,"approved"))).limit(1),allowed=access.user?.status==="approved"&&!!requests[0];await db.insert(launchEvents).values({id:randomUUID(),organizationId:access.organizationId,userId:access.viewer.userId,email:access.viewer.email,destination,result:allowed?"allowed":"denied",createdAt:now});if(!allowed)return Response.json({error:"Your account and ChatGPT request must both be approved"},{status:403});return Response.json({url:destination})}catch(e){return routeError(e,"Unable to open ChatGPT")}}
