import { app } from '../src/app'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this'

async function testApiCall() {
  const token = jwt.sign(
    { userId: 1, role: 'employee', roles: ['employee'], name: 'Mohd Faraz', email: 'farazahmad280@gmail.com', sid: 'test-sid' },
    JWT_SECRET
  )

  const req = new Request('http://localhost/api/university-mails', {
    headers: { Authorization: `Bearer ${token}` },
  })

  const res = await app.request(req)
  const json: any = await res.json()

  console.log('API RESPONSE FOR FARAZ:', {
    status: res.status,
    total: json?.pagination?.total,
    itemsLength: json?.items?.length,
    items: json?.items?.map((i: any) => ({
      id: i.id,
      toEmail: i.toEmail,
      studentName: i.student?.name,
      studentId: i.studentId,
    })),
  })
}

testApiCall().catch(console.error)
