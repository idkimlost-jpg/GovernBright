import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { approvedUsers,launchEvents } from "../../../db/schema";
const destination="https://chatgpt.com/";
export async function POST(r:Request){const userId=r.headers.get("oai-authenticated-user-id"),email=r.headers.get("oai-authenticated-user-email")?.toLowerCase(),db=getDb(),now=new Date().toISOString();if(!userId||!email)return Response.json({error:"Authentication required"},{status:401});const rows=await db.select().from(approvedUsers).where(eq(approvedUsers.email,email)).limit(1),user=rows[0],allowed=user?.status==="approved";await db.insert(launchEvents).values({id:randomUUID(),organizationId:user?.organizationId||"unassigned",userId,email,destination,result:allowed?"allowed":"denied",createdAt:now});if(!allowed)return Response.json({error:"ChatGPT access has not been approved"},{status:403});return Response.json({url:destination})}
