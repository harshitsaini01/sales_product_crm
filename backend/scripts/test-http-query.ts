import http from 'http'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this'

function testHttpWithToken(url: string, token: string) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url)
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }

    http.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          resolve(json)
        } catch (e) {
          resolve(data)
        }
      })
    })
  })
}

async function run() {
  const token = jwt.sign({ userId: 1, email: 'admin@example.com', role: 'admin' }, JWT_SECRET, {
    expiresIn: '1h',
  })

  console.log('--- TESTING HTTP WITH universityName=ABCD ---')
  const res1: any = await testHttpWithToken('http://localhost:3001/api/university-mails?universityName=ABCD', token)
  console.log('RES 1 (universityName=ABCD):', {
    total: res1?.pagination?.total,
    itemsCount: res1?.items?.length,
    items: res1?.items?.map((i: any) => ({ id: i.id, universityName: i.universityName })),
  })

  console.log('\n--- TESTING HTTP WITH universityName=AIIMS ---')
  const res2: any = await testHttpWithToken('http://localhost:3001/api/university-mails?universityName=AIIMS', token)
  console.log('RES 2 (universityName=AIIMS):', {
    total: res2?.pagination?.total,
    itemsCount: res2?.items?.length,
    items: res2?.items?.map((i: any) => ({ id: i.id, universityName: i.universityName })),
  })
}

run().catch(console.error)
